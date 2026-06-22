"""
Fetch publication metadata from PubMed E-utilities and upsert into
the publications table.

Per docs/DATA_REFRESH_SOP.md, this is step 3 of the refresh
sequence. It runs after etl/sync_publication_links.py populates
project_publications with new (project_number, pmid) rows. Any
pmid present in project_publications but missing from publications
is fetched via PubMed esummary, normalized to our schema, and
upserted.

Fields populated from esummary:
  title             -> pub_title
  fulljournalname   -> journal_title
  source            -> journal_abbr
  pubdate           -> pub_year (parsed) + pub_date (ISO)
  authors[].name    -> author_list (joined with '; ')
  articleids        -> pmc_id (where idtype=pmc)
  issn / essn       -> issn

Derived flags set via etl/process_publications.classify_journal:
  is_methods_journal
  is_therapeutic_journal
  is_computational_journal

NOT populated here (per SOP):
  abstract     — runtime-lazy via PubMed efetch (existing behavior)
  affiliation  — could be added via efetch later if needed
  pi_email     — separate enrichment script

Filter modes:

  # Default: pmids in project_publications missing from publications
  python3 etl/fetch_pubmed_metadata.py --missing

  # Specific pmids for testing
  python3 etl/fetch_pubmed_metadata.py --pmids 29627333,40110744

  # Safety knobs
  python3 etl/fetch_pubmed_metadata.py --missing --limit 1000 --dry-run

Rate limits: 3 req/sec without an NCBI API key, 10 req/sec with one
(set NCBI_API_KEY in .env.local). Each esummary call accepts up to
200 pmids — for ~300K new pmids that's ~1,500 calls, well under
an hour at the no-key limit.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from typing import Dict, Any, List, Optional, Iterable
from dotenv import load_dotenv

load_dotenv('.env.local')

import requests
from supabase import create_client, Client

# Reuse the same flag-setting + date-parsing logic the bulk loader uses
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from process_publications import classify_journal, parse_pub_date


PUBMED_ESUMMARY_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi'
PMIDS_PER_CALL = 200
DB_PAGE = 1000

# Rate limits per NCBI policy
SLEEP_NO_KEY = 0.34   # 3 req/sec
SLEEP_WITH_KEY = 0.1  # 10 req/sec


def get_supabase_client() -> Client:
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise ValueError('Missing SUPABASE env vars in .env.local')
    return create_client(url, key)


def chunked(seq: List[str], n: int) -> Iterable[List[str]]:
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def parse_pub_year(pubdate: Optional[str]) -> Optional[int]:
    """Pull a 4-digit year out of '2018 Aug', '2018-08-15', '2018', etc."""
    if not pubdate:
        return None
    m = re.search(r'(\d{4})', pubdate)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def extract_pmc_id(article_ids: List[Dict[str, Any]]) -> Optional[str]:
    for a in article_ids or []:
        if a.get('idtype') == 'pmc':
            return a.get('value')
    return None


def parse_esummary_record(rec: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Convert one PubMed esummary record to our publications row shape."""
    pmid = rec.get('uid')
    if not pmid:
        return None

    journal_title = rec.get('fulljournalname') or ''
    journal_abbr = rec.get('source') or ''
    pubdate_str = rec.get('pubdate') or rec.get('epubdate') or ''

    authors = rec.get('authors') or []
    author_names = [a.get('name') for a in authors if isinstance(a, dict) and a.get('name')]
    author_list = '; '.join(author_names) if author_names else None

    flags = classify_journal(journal_abbr, journal_title)

    return {
        'pmid': str(pmid),
        'pub_title': rec.get('title') or None,
        'journal_title': journal_title or None,
        'journal_abbr': journal_abbr or None,
        'pub_year': parse_pub_year(pubdate_str),
        'pub_date': parse_pub_date(pubdate_str),
        'author_list': author_list,
        'pmc_id': extract_pmc_id(rec.get('articleids') or []),
        'issn': rec.get('issn') or rec.get('essn') or None,
        **flags,
    }


def fetch_esummary_batch(pmids: List[str], api_key: Optional[str]) -> List[Dict[str, Any]]:
    """Call PubMed esummary for up to PMIDS_PER_CALL pmids. Returns list of parsed records."""
    params = {
        'db': 'pubmed',
        'id': ','.join(pmids),
        'retmode': 'json',
    }
    if api_key:
        params['api_key'] = api_key

    resp = requests.get(PUBMED_ESUMMARY_URL, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    result = (data.get('result') or {})
    uids = result.get('uids') or []

    out: List[Dict[str, Any]] = []
    for uid in uids:
        rec = result.get(uid)
        if not rec or rec.get('error'):
            continue
        parsed = parse_esummary_record(rec)
        if parsed:
            out.append(parsed)
    return out


def select_missing_pmids(supabase: Client) -> List[str]:
    """All pmids in project_publications that don't yet exist in publications."""
    # Step 1: pmids in project_publications
    linked: set = set()
    offset = 0
    while True:
        page = supabase.table('project_publications').select('pmid').range(offset, offset + DB_PAGE - 1).execute()
        rows = page.data or []
        if not rows:
            break
        for r in rows:
            if r.get('pmid'):
                linked.add(str(r['pmid']))
        offset += DB_PAGE
        if len(rows) < DB_PAGE:
            break
    print(f'  pmids in project_publications: {len(linked):,}')

    # Step 2: pmids already in publications
    existing: set = set()
    offset = 0
    while True:
        page = supabase.table('publications').select('pmid').range(offset, offset + DB_PAGE - 1).execute()
        rows = page.data or []
        if not rows:
            break
        for r in rows:
            if r.get('pmid'):
                existing.add(str(r['pmid']))
        offset += DB_PAGE
        if len(rows) < DB_PAGE:
            break
    print(f'  pmids already in publications:  {len(existing):,}')

    missing = sorted(linked - existing)
    print(f'  pmids to fetch:                 {len(missing):,}')
    return missing


def batch_upsert(supabase: Client, rows: List[Dict[str, Any]], batch: int = 500) -> int:
    if not rows:
        return 0
    written = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        try:
            supabase.table('publications').upsert(chunk, on_conflict='pmid').execute()
            written += len(chunk)
        except Exception as e:
            print(f'  Upsert error on batch starting at {i}: {str(e)[:200]}')
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    grp = parser.add_mutually_exclusive_group(required=True)
    grp.add_argument('--missing', action='store_true', help='Pmids in project_publications missing from publications')
    grp.add_argument('--pmids', help='Comma-separated pmids (testing)')

    parser.add_argument('--limit', type=int, default=None, help='Cap total pmids processed')
    parser.add_argument('--dry-run', action='store_true', help='Skip DB writes')
    parser.add_argument('--yes', action='store_true', help='Skip confirmation prompt')
    args = parser.parse_args()

    api_key = os.environ.get('NCBI_API_KEY')
    sleep = SLEEP_WITH_KEY if api_key else SLEEP_NO_KEY

    print('=' * 72)
    print('PubMed metadata fetch')
    print('=' * 72)
    print(f'  NCBI API key: {"yes" if api_key else "no (3 req/sec limit)"}')
    print()

    supabase = get_supabase_client()

    if args.pmids:
        pmids = [p.strip() for p in args.pmids.split(',') if p.strip()]
        print(f'  Pmids supplied: {len(pmids):,}')
    else:
        pmids = select_missing_pmids(supabase)

    if not pmids:
        print('Nothing to fetch. Done.')
        return

    if args.limit:
        pmids = pmids[:args.limit]
        print(f'  Limit applied: {len(pmids):,}')

    n_calls = (len(pmids) + PMIDS_PER_CALL - 1) // PMIDS_PER_CALL
    eta_sec = n_calls * sleep
    print(f'  Will make {n_calls:,} esummary calls ({PMIDS_PER_CALL} pmids/call).')
    print(f'  Estimated wall time: {eta_sec:.0f}s ({eta_sec / 60:.1f} min).')
    if args.dry_run:
        print('  DRY RUN — no DB writes.')
    print()

    if not args.yes and not args.dry_run and len(pmids) > 1000:
        resp = input(f'Fetch + upsert {len(pmids):,} publications? [y/N] ').strip().lower()
        if resp != 'y':
            print('Aborted.')
            return

    total_fetched = 0
    total_parsed = 0
    total_written = 0
    total_errors = 0
    buffer: List[Dict[str, Any]] = []

    for i, batch in enumerate(chunked(pmids, PMIDS_PER_CALL)):
        try:
            recs = fetch_esummary_batch(batch, api_key)
        except Exception as e:
            total_errors += 1
            print(f'  [{i + 1}/{n_calls}] FETCH ERROR — {str(e)[:120]}')
            time.sleep(sleep)
            continue

        total_fetched += len(batch)
        total_parsed += len(recs)
        buffer.extend(recs)

        # Flush every ~500 records
        if len(buffer) >= 500:
            if not args.dry_run:
                total_written += batch_upsert(supabase, buffer)
            buffer = []

        if (i + 1) % 10 == 0 or i == n_calls - 1:
            print(f'  [{i + 1}/{n_calls}] fetched={total_fetched:,}, parsed={total_parsed:,}, written={total_written:,}')

        time.sleep(sleep)

    # Final flush
    if buffer and not args.dry_run:
        total_written += batch_upsert(supabase, buffer)

    print()
    print('=' * 72)
    print('Done.')
    print(f'  Pmids requested:  {total_fetched:,}')
    print(f'  Records parsed:   {total_parsed:,}')
    print(f'  Records upserted: {total_written:,}')
    print(f'  Fetch errors:     {total_errors}')
    print('=' * 72)
    print()
    print('Next: run etl/generate_embeddings_batched.py (NULL-only mode)')
    print('to embed the newly-inserted publication titles.')


if __name__ == '__main__':
    main()
