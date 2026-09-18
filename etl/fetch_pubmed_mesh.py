"""
Fetch MeSH descriptors from PubMed efetch for publications missing them.

Companion to fetch_pubmed_metadata.py. That script uses esummary (JSON,
fast, but no MeSH). This script uses efetch (XML, slower per record,
carries MeSH). Two-pass ETL by design: esummary handles the bulk
metadata for every new PMID; efetch runs later for the specific field
esummary lacks.

Populates publications.mesh_terms with Major-topic MeSH descriptors.
Minor-topic MeSH is intentionally NOT stored (noisy — most articles
carry 10-20 minor headings covering background material).

Usage:
    # Default: missing pmids (has pub_title, NULL mesh_terms)
    python3 etl/fetch_pubmed_mesh.py --missing

    # Test with a small batch
    python3 etl/fetch_pubmed_mesh.py --missing --limit 100 --dry-run

    # Specific pmids (testing)
    python3 etl/fetch_pubmed_mesh.py --pmids 29627333,40110744

    # Skip prompt when running from cron / background
    python3 etl/fetch_pubmed_mesh.py --missing --yes

Rate limits: 3 req/sec without NCBI_API_KEY, 10 req/sec with one.
efetch accepts up to 200 pmids per call. For ~500K pubs at 200/batch
= ~2,500 calls = ~15 min (with key) or ~14 min (without, uses the same
batch shape). Backfill is fully idempotent — re-runs are safe.
"""

import argparse
import os
import sys
import time
from typing import Dict, Any, List, Optional, Iterable
from xml.etree import ElementTree as ET

from dotenv import load_dotenv
load_dotenv('.env.local')

import requests
from supabase import create_client, Client


PMIDS_PER_CALL = 200
SLEEP_NO_KEY = 0.34   # ~3 req/sec
SLEEP_WITH_KEY = 0.11 # ~10 req/sec
DB_PAGE = 1000
DB_UPSERT_BATCH = 200


def get_supabase_client() -> Client:
    return create_client(
        os.environ['NEXT_PUBLIC_SUPABASE_URL'],
        os.environ['SUPABASE_SERVICE_KEY'],
    )


def chunked(seq: List[str], n: int) -> Iterable[List[str]]:
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def parse_efetch_xml_for_mesh(xml_bytes: bytes) -> Dict[str, List[str]]:
    """Parse a PubMed efetch XML response and return {pmid: [mesh_term, ...]}.

    Only descriptors with MajorTopicYN="Y" are captured. This matches the
    stored-column semantics (see migration 20260918_publications_mesh.sql).
    """
    result: Dict[str, List[str]] = {}
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        print(f'  XML parse error: {e}')
        return result

    for article in root.findall('.//PubmedArticle'):
        # PMID sits in MedlineCitation/PMID.
        pmid_el = article.find('.//MedlineCitation/PMID')
        if pmid_el is None or not pmid_el.text:
            continue
        pmid = pmid_el.text.strip()

        # MeSH headings — only Major-topic descriptors.
        mesh: List[str] = []
        for heading in article.findall('.//MeshHeadingList/MeshHeading'):
            descriptor = heading.find('DescriptorName')
            if descriptor is None or not descriptor.text:
                continue
            major = descriptor.get('MajorTopicYN', 'N')
            if major == 'Y':
                mesh.append(descriptor.text.strip())
        # Dedup within a single article — same descriptor can appear twice
        # with different qualifiers.
        result[pmid] = list(dict.fromkeys(mesh))
    return result


def fetch_mesh_batch(pmids: List[str], api_key: Optional[str]) -> Dict[str, List[str]]:
    """Call PubMed efetch for up to PMIDS_PER_CALL pmids. Returns
    {pmid: [mesh_terms, ...]}. Empty dict on any request failure.
    """
    params: Dict[str, str] = {
        'db': 'pubmed',
        'id': ','.join(pmids),
        'retmode': 'xml',
        'rettype': 'abstract',
    }
    if api_key:
        params['api_key'] = api_key
    try:
        r = requests.get(
            'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi',
            params=params,
            timeout=60,
        )
        r.raise_for_status()
        return parse_efetch_xml_for_mesh(r.content)
    except Exception as e:
        print(f'  efetch error for {len(pmids)} pmids: {e}')
        return {}


def select_missing_pmids(supabase: Client) -> List[str]:
    """PubMed IDs that have a title but no mesh_terms yet."""
    missing: set = set()
    offset = 0
    while True:
        page = (
            supabase.table('publications')
            .select('pmid, mesh_terms')
            .not_.is_('pub_title', 'null')
            .neq('pub_title', '')
            .is_('mesh_terms', 'null')
            .range(offset, offset + DB_PAGE - 1)
            .execute()
        )
        rows = page.data or []
        if not rows:
            break
        for r in rows:
            if r.get('pmid'):
                missing.add(str(r['pmid']))
        offset += DB_PAGE
        if offset % 20_000 == 0:
            print(f'    …scanned {offset:,} rows, {len(missing):,} pending')
        if len(rows) < DB_PAGE:
            break
    return sorted(missing)


def batch_upsert(supabase: Client, rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    written = 0
    for chunk in chunked(rows, DB_UPSERT_BATCH):
        try:
            supabase.table('publications').upsert(chunk, on_conflict='pmid').execute()
            written += len(chunk)
        except Exception as e:
            print(f'    Upsert error on {len(chunk)}-row chunk: {str(e)[:200]}')
    return written


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    grp = parser.add_mutually_exclusive_group(required=True)
    grp.add_argument('--missing', action='store_true',
                     help='Publications with pub_title populated but mesh_terms NULL')
    grp.add_argument('--pmids',
                     help='Comma-separated pmids (testing)')
    parser.add_argument('--limit', type=int, default=None,
                        help='Cap total pmids processed')
    parser.add_argument('--dry-run', action='store_true',
                        help='Skip DB writes; print what would change')
    parser.add_argument('--yes', action='store_true',
                        help='Skip confirmation prompt')
    args = parser.parse_args()

    api_key = os.environ.get('NCBI_API_KEY')
    sleep_between = SLEEP_WITH_KEY if api_key else SLEEP_NO_KEY

    print('=' * 72)
    print('PubMed MeSH backfill (efetch)')
    print('=' * 72)
    print(f'  NCBI API key: {"yes" if api_key else "no (3 req/sec limit)"}')

    supabase = get_supabase_client()

    if args.pmids:
        pmids = [p.strip() for p in args.pmids.split(',') if p.strip()]
        print(f'  PMIDs supplied: {len(pmids):,}')
    else:
        print('  Scanning publications for rows without mesh_terms...')
        pmids = select_missing_pmids(supabase)
        print(f'  Found {len(pmids):,} publications needing MeSH')

    if args.limit is not None:
        pmids = pmids[:args.limit]
        print(f'  Limit applied: {len(pmids):,}')

    if not pmids:
        print('Nothing to fetch. Done.')
        return

    est_calls = (len(pmids) + PMIDS_PER_CALL - 1) // PMIDS_PER_CALL
    est_seconds = est_calls * sleep_between
    print(f'  ~{est_calls:,} efetch calls, ~{int(est_seconds // 60)} min wall time')

    if not args.yes and not args.dry_run:
        resp = input(f'Fetch + upsert {len(pmids):,} publications? [y/N] ').strip().lower()
        if resp != 'y':
            print('  Aborted.')
            return

    print()
    fetched_total = 0
    upserted_total = 0
    started = time.time()
    for batch_num, batch in enumerate(chunked(pmids, PMIDS_PER_CALL), start=1):
        mesh_by_pmid = fetch_mesh_batch(batch, api_key)
        fetched_total += len(batch)

        # Even PMIDs with no MeSH major topics are written back as
        # empty arrays so we don't re-fetch them on the next --missing
        # pass. The GIN index treats {} and NULL differently, and the
        # backfill script uses the NULL predicate.
        rows: List[Dict[str, Any]] = []
        for pmid in batch:
            rows.append({
                'pmid': pmid,
                'mesh_terms': mesh_by_pmid.get(pmid, []),
            })

        if not args.dry_run:
            upserted_total += batch_upsert(supabase, rows)

        if batch_num % 10 == 0 or fetched_total == len(pmids):
            elapsed = time.time() - started
            rate = fetched_total / max(elapsed, 0.01)
            with_mesh = sum(1 for v in mesh_by_pmid.values() if v)
            print(
                f'  [{fetched_total:,}/{len(pmids):,}] batch {batch_num}, '
                f'{with_mesh}/{len(batch)} had MeSH, upserted={upserted_total:,}, '
                f'rate={rate:.1f}/s'
            )
        time.sleep(sleep_between)

    print()
    print('=' * 72)
    print('Done.')
    print(f'  Pmids requested:  {len(pmids):,}')
    print(f'  Records upserted: {upserted_total:,}')
    print('=' * 72)


if __name__ == '__main__':
    main()
