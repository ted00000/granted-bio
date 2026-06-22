"""
Sync project-publication links from the RePORTER API.

For each project_number selected by the caller's filter, call
/v2/publications/search with sort_field=pmid+desc and limit=50 to
fetch the 50 most-recent PMIDs linked to that core project, then
upsert (project_number, pmid) rows into project_publications.

Per docs/DATA_REFRESH_SOP.md, this is step 2 of the refresh
sequence. Step 3 (etl/fetch_pubmed_metadata.py) fills the
publications table for any new PMIDs.

The API only returns three fields per row: (coreproject, pmid,
applid). No pub_date — but PMIDs are roughly chronological, so
sort_field=pmid + sort_order=desc is a close-enough proxy for
"most recent first" when capping at 50 per project.

Filter modes:

  # New awards only (no existing pub links)
  python3 etl/sync_publication_links.py --missing

  # Projects added since a date
  python3 etl/sync_publication_links.py --since 2026-03-09

  # Specific project (testing)
  python3 etl/sync_publication_links.py --project U01DA041022

  # Cap the run for safety
  python3 etl/sync_publication_links.py --missing --limit 100

  # Full historical backfill (~43h at the rate limit)
  python3 etl/sync_publication_links.py --all

  # Dry-run: no DB writes, print what would change
  python3 etl/sync_publication_links.py --missing --limit 50 --dry-run

Rate limit: 1 req/sec per NIH guidance.
"""

import argparse
import os
import re
import sys
import time
from typing import Dict, Any, List, Optional, Set
from dotenv import load_dotenv

load_dotenv('.env.local')

import requests
from supabase import create_client, Client


API_URL = 'https://api.reporter.nih.gov/v2/publications/search'
RATE_LIMIT_SLEEP_SEC = 1.0
PER_PROJECT_CAP = 50  # Per docs/DATA_REFRESH_SOP.md — matches UI display cap
DB_PAGE = 1000


def get_supabase_client() -> Client:
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise ValueError(
            'Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_KEY '
            '(or SUPABASE_SERVICE_ROLE_KEY) in environment / .env.local'
        )
    return create_client(url, key)


# Convert a full NIH project_number to its core form.
# Format: <funding_type_digit><activity_code><serial>-<year>[<amendment>]
# Examples:
#   5U01DA041022-12  -> U01DA041022
#   1R01HG011711-01A1 -> R01HG011711
#   R01HG011711      -> R01HG011711  (already core)
#   ZIABC011090      -> ZIABC011090  (intramural, no prefix or suffix)
#   5N93024D00032    -> N93024D00032 (contracts) — keep as-is shape
_FUNDING_TYPE_PREFIX = re.compile(r'^[1-9]')
_YEAR_AMENDMENT_SUFFIX = re.compile(r'-.+$')


def to_core_project_num(full: str) -> str:
    if not full:
        return ''
    s = _FUNDING_TYPE_PREFIX.sub('', full)
    s = _YEAR_AMENDMENT_SUFFIX.sub('', s)
    return s


def post_publications_search(core_project_num: str, limit: int = PER_PROJECT_CAP) -> List[Dict[str, Any]]:
    """Fetch up to `limit` most-recent (by pmid desc) publications for a core project."""
    payload = {
        'criteria': {'core_project_nums': [core_project_num]},
        'limit': limit,
        'offset': 0,
        'sort_field': 'pmid',
        'sort_order': 'desc',
    }
    resp = requests.post(
        API_URL,
        json=payload,
        headers={'Accept': 'application/json'},
        timeout=60,
    )
    resp.raise_for_status()
    return (resp.json().get('results') or [])


def fetch_project_numbers(supabase: Client, args) -> List[str]:
    """Pull the list of project_numbers to refresh, deduped, per the caller's filter."""
    # Single-project mode
    if args.project:
        # Accept either full or core; we'll convert below
        return [args.project]

    # Build the projects query
    if args.missing:
        # Projects with no row in project_publications.
        # Two-step: get all project_numbers, get all linked project_numbers,
        # return the set difference. Simpler than a NOT EXISTS at this layer.
        all_pn = _all_project_numbers(supabase)
        linked = _linked_project_numbers(supabase)
        out = sorted(all_pn - linked)
        print(f'  Filter: projects with no existing link rows. {len(out):,} / {len(all_pn):,} match.')
        if args.limit:
            out = out[:args.limit]
        return out

    if args.since:
        out: Set[str] = set()
        offset = 0
        while True:
            page = supabase.table('projects').select('project_number').gte('created_at', args.since).not_.is_('project_number', 'null').range(offset, offset + DB_PAGE - 1).execute()
            rows = page.data or []
            if not rows:
                break
            for r in rows:
                if r.get('project_number'):
                    out.add(r['project_number'])
            offset += DB_PAGE
            if len(rows) < DB_PAGE:
                break
        sorted_out = sorted(out)
        print(f'  Filter: projects with created_at >= {args.since}. {len(sorted_out):,} match.')
        if args.limit:
            sorted_out = sorted_out[:args.limit]
        return sorted_out

    if args.all:
        out_set = _all_project_numbers(supabase)
        out = sorted(out_set)
        print(f'  Filter: ALL projects. {len(out):,} match.')
        if args.limit:
            out = out[:args.limit]
        return out

    # No filter — sanity error
    raise SystemExit('Must specify --missing, --since, --project, or --all. See --help.')


def _all_project_numbers(supabase: Client) -> Set[str]:
    out: Set[str] = set()
    offset = 0
    while True:
        page = supabase.table('projects').select('project_number').not_.is_('project_number', 'null').range(offset, offset + DB_PAGE - 1).execute()
        rows = page.data or []
        if not rows:
            break
        for r in rows:
            if r.get('project_number'):
                out.add(r['project_number'])
        offset += DB_PAGE
        if len(rows) < DB_PAGE:
            break
    return out


def _linked_project_numbers(supabase: Client) -> Set[str]:
    out: Set[str] = set()
    offset = 0
    while True:
        page = supabase.table('project_publications').select('project_number').range(offset, offset + DB_PAGE - 1).execute()
        rows = page.data or []
        if not rows:
            break
        for r in rows:
            if r.get('project_number'):
                out.add(r['project_number'])
        offset += DB_PAGE
        if len(rows) < DB_PAGE:
            break
    return out


def upsert_publication_stubs(supabase: Client, pmids: List[str]) -> int:
    """Insert minimal publications rows (pmid only) so the FK on
    project_publications.pmid passes. Existing rows are left untouched
    (ON CONFLICT DO NOTHING). The PubMed metadata fetcher (step 3 of
    the SOP) then fills in title/journal/dates for these stubs."""
    if not pmids:
        return 0
    stubs = [{'pmid': str(p)} for p in pmids]
    try:
        supabase.table('publications').upsert(
            stubs,
            on_conflict='pmid',
            ignore_duplicates=True,
        ).execute()
        return len(stubs)
    except Exception as e:
        print(f'    Stub upsert error: {str(e)[:200]}')
        return 0


def upsert_links(supabase: Client, rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    # FK requirement: every pmid in project_publications must exist in
    # publications first. Insert minimal stubs so the link write succeeds;
    # metadata fills in later (step 3).
    pmids = list({r['pmid'] for r in rows})
    upsert_publication_stubs(supabase, pmids)
    try:
        supabase.table('project_publications').upsert(
            rows,
            on_conflict='project_number,pmid',
        ).execute()
        return len(rows)
    except Exception as e:
        print(f'    Upsert error: {str(e)[:200]}')
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    grp = parser.add_mutually_exclusive_group(required=True)
    grp.add_argument('--missing', action='store_true', help='Only projects with no existing link rows')
    grp.add_argument('--since', help='Projects with created_at >= YYYY-MM-DD')
    grp.add_argument('--project', help='A single project_number (full or core form)')
    grp.add_argument('--all', action='store_true', help='ALL projects (historical backfill, ~43h at rate limit)')

    parser.add_argument('--limit', type=int, default=None, help='Cap the number of projects to process')
    parser.add_argument('--dry-run', action='store_true', help='Skip DB writes; print what would change')
    parser.add_argument('--yes', action='store_true', help='Skip confirmation prompt')
    args = parser.parse_args()

    print('=' * 72)
    print('Publication link sync')
    print('=' * 72)
    print()

    supabase = get_supabase_client()
    project_numbers = fetch_project_numbers(supabase, args)
    if not project_numbers:
        print('No projects match. Done.')
        return

    # Dedupe core forms to avoid hitting the API multiple times for the same
    # core project across renewals (e.g. 5U01...-12 and 5U01...-11 both
    # resolve to the same core).
    full_to_core = {pn: to_core_project_num(pn) for pn in project_numbers}
    core_set = sorted(set(full_to_core.values()))
    if len(core_set) < len(project_numbers):
        print(f'  Deduped to {len(core_set):,} unique core project_nums (from {len(project_numbers):,} full).')

    # Estimate runtime
    eta_min = (len(core_set) * RATE_LIMIT_SLEEP_SEC) / 60
    print(f'  Will fetch up to {PER_PROJECT_CAP} most-recent pmids per project.')
    print(f'  Estimated wall time at 1 req/sec: {eta_min:.0f} min ({eta_min / 60:.1f} h).')
    if args.dry_run:
        print('  DRY RUN — no DB writes.')
    print()

    if not args.yes and not args.dry_run and len(core_set) > 50:
        resp = input(f'Process {len(core_set):,} projects? [y/N] ').strip().lower()
        if resp != 'y':
            print('Aborted.')
            return

    # We need to know which (project_number, pmid) pairs ALREADY exist so we
    # only write new ones. Pre-fetching everything is heavy; instead we'll
    # upsert with on_conflict and rely on Postgres to no-op duplicates.
    # We still report new-vs-existing approximately via the count returned.

    total_projects = 0
    total_pmids_seen = 0
    total_rows_written = 0
    total_errors = 0

    for i, core in enumerate(core_set):
        try:
            results = post_publications_search(core, limit=PER_PROJECT_CAP)
        except Exception as e:
            total_errors += 1
            print(f'  [{i + 1}/{len(core_set)}] {core}: FETCH ERROR — {str(e)[:120]}')
            time.sleep(RATE_LIMIT_SLEEP_SEC)
            continue

        # The API returns rows like {coreproject, pmid, applid}. We map each
        # pmid back to ALL the full project_numbers in our set that share
        # this core, because both 5U01...-12 and 5U01...-11 should get the
        # link (each year-renewal in our DB is its own project_number).
        full_numbers_for_core = [full for full, c in full_to_core.items() if c == core]
        rows_to_upsert: List[Dict[str, Any]] = []
        pmids_this_proj: Set[str] = set()
        for r in results:
            pmid = str(r.get('pmid') or '')
            if not pmid:
                continue
            pmids_this_proj.add(pmid)
            for full_pn in full_numbers_for_core:
                rows_to_upsert.append({'project_number': full_pn, 'pmid': pmid})

        total_pmids_seen += len(pmids_this_proj)
        if not args.dry_run and rows_to_upsert:
            written = upsert_links(supabase, rows_to_upsert)
            total_rows_written += written

        total_projects += 1
        if (i + 1) % 25 == 0 or i == len(core_set) - 1:
            print(f'  [{i + 1}/{len(core_set)}] core={core}: {len(pmids_this_proj)} pmids → {len(rows_to_upsert)} link rows (across {len(full_numbers_for_core)} project_number renewals)')

        time.sleep(RATE_LIMIT_SLEEP_SEC)

    print()
    print('=' * 72)
    print('Done.')
    print(f'  Projects processed:    {total_projects:,}')
    print(f'  Unique pmids seen:     {total_pmids_seen:,} (cap {PER_PROJECT_CAP}/project)')
    print(f'  Link rows written:     {total_rows_written:,}')
    print(f'  Fetch errors:          {total_errors}')
    print('=' * 72)
    print()
    print('Next: run etl/fetch_pubmed_metadata.py to fill publication metadata')
    print('for any new pmids that landed in project_publications.')


if __name__ == '__main__':
    main()
