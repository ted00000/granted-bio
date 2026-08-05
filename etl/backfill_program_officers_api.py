"""
Backfill program_officer for projects synced via the RePORTER API.

Root cause: etl/sync_projects_via_api.py (used for every weekly sync
since 2026-02-01) didn't extract program_officers[] from the API
response until commit landed on 2026-08-05. Every project inserted
via the API path since 2026-02-01 has program_officer = null.

Not to be confused with etl/backfill_program_officer.py (older, singular)
which backfills from ExPORTER CSV files. This one uses the RePORTER API
directly and targets rows inserted via the API sync path.

Approach:
  1. SELECT DISTINCT project_number FROM projects
       WHERE program_officer IS NULL AND created_at >= '2026-02-01'
     Deduping by core project_number means many application_id rows
     (multi-period awards, supplements, renewals) share the same PO
     and only need one API call each.
  2. For each batch of 50 project_numbers, POST to the RePORTER API
     /v2/projects/search with the batch. Rate-limited at 1 req/sec
     per NIH guidance.
  3. Extract the first program_officers[].full_name for each core
     (POs are stable across renewals for the same core).
  4. UPDATE projects SET program_officer = <po>
       WHERE project_number = <core> AND program_officer IS NULL.
     Filtering on IS NULL again ensures we don't accidentally clobber
     values that were populated in a concurrent process.

Usage:
    python3 etl/backfill_program_officers_api.py [--from-date YYYY-MM-DD] [--dry-run] [--limit N]

Defaults to --from-date 2026-02-01 (the last ExPORTER bulk load).
"""

import argparse
import os
import sys
import time
from typing import Any, Dict, List, Set

import requests
from dotenv import load_dotenv

# Load env early so supabase client picks up creds.
load_dotenv('.env.local')

from supabase import Client, create_client  # noqa: E402


RATE_LIMIT_SEC = 1.0
BATCH_SIZE = 50  # project_nums per API call
API_URL = 'https://api.reporter.nih.gov/v2/projects/search'
DEFAULT_FROM_DATE = '2026-02-01'


def get_supabase_client() -> Client:
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        print('ERROR: Supabase env vars not set', file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def fetch_missing_project_numbers(supabase: Client, from_date: str) -> List[str]:
    """
    Get all distinct project_numbers that need PO backfill. Paginated
    because Supabase caps a single response at 1000 rows.
    """
    seen: Set[str] = set()
    offset = 0
    page = 1000
    while True:
        result = (
            supabase.table('projects')
            .select('project_number')
            .is_('program_officer', 'null')
            .gte('created_at', from_date)
            .range(offset, offset + page - 1)
            .execute()
        )
        if not result.data:
            break
        for row in result.data:
            pn = row.get('project_number')
            if pn:
                seen.add(pn)
        if len(result.data) < page:
            break
        offset += page
    return sorted(seen)


def fetch_program_officers(project_nums: List[str]) -> Dict[str, str]:
    """
    Call RePORTER API for a batch of project_numbers, return a
    { core_project_num -> program_officer full name } map.

    Multiple PO entries per project (rare) are joined with ';' matching
    the pi_names convention. Multiple result rows per core (renewals,
    versions) are deduped — the first one wins.
    """
    payload = {
        'criteria': {'project_nums': project_nums},
        'limit': 500,  # generous — each core can have ~5-10 renewals
        'offset': 0,
    }
    r = requests.post(API_URL, json=payload, timeout=30)
    r.raise_for_status()
    body = r.json()
    results = body.get('results') or []
    out: Dict[str, str] = {}
    for row in results:
        core = row.get('core_project_num')
        if not core or core in out:
            continue
        pos = row.get('program_officers') or []
        names = ';'.join(p.get('full_name') for p in pos if p.get('full_name'))
        if names:
            out[core] = names
    return out


def apply_updates(
    supabase: Client,
    po_map: Dict[str, str],
    dry_run: bool,
) -> int:
    """
    For each (core, po) pair, UPDATE projects SET program_officer = po
    WHERE project_number = core AND program_officer IS NULL. The IS NULL
    guard avoids clobbering values populated by a concurrent process.
    Returns rows updated.
    """
    if not po_map:
        return 0
    if dry_run:
        print(f'    (dry-run) would apply {len(po_map)} PO assignments')
        return 0
    total_updated = 0
    for core, po in po_map.items():
        try:
            result = (
                supabase.table('projects')
                .update({'program_officer': po})
                .eq('project_number', core)
                .is_('program_officer', 'null')
                .execute()
            )
            n = len(result.data) if result.data else 0
            total_updated += n
        except Exception as e:  # noqa: BLE001
            print(f'    UPDATE failed for {core}: {e}')
    return total_updated


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--from-date',
        default=DEFAULT_FROM_DATE,
        help=f'Backfill projects created since this date (default: {DEFAULT_FROM_DATE})',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Skip DB writes; show what would happen',
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help='Cap the number of unique project_numbers processed (for testing)',
    )
    args = parser.parse_args()

    print('=' * 72)
    print('Backfill program_officer via RePORTER API')
    print('=' * 72)
    print(f'  from-date: {args.from_date}')
    print(f'  dry-run:   {args.dry_run}')
    print(f'  limit:     {args.limit or "(none)"}')
    print()

    supabase = get_supabase_client()

    print('Fetching missing project_numbers from DB...')
    project_nums = fetch_missing_project_numbers(supabase, args.from_date)
    print(f'  {len(project_nums):,} unique core project_numbers need PO backfill')
    if args.limit:
        project_nums = project_nums[: args.limit]
        print(f'  (limited to first {len(project_nums)} for this run)')
    print()

    if not project_nums:
        print('Nothing to backfill. Done.')
        return

    total_batches = (len(project_nums) + BATCH_SIZE - 1) // BATCH_SIZE
    est_wall_sec = total_batches * RATE_LIMIT_SEC
    print(f'Will fetch in {total_batches} batches of ≤{BATCH_SIZE} at {RATE_LIMIT_SEC}s/batch')
    print(f'  Estimated wall time: ~{est_wall_sec:.0f} sec = {est_wall_sec/60:.1f} min')
    print()

    total_po_found = 0
    total_rows_updated = 0
    for batch_idx in range(total_batches):
        batch = project_nums[batch_idx * BATCH_SIZE : (batch_idx + 1) * BATCH_SIZE]
        try:
            po_map = fetch_program_officers(batch)
        except Exception as e:  # noqa: BLE001
            print(f'  Batch {batch_idx+1}/{total_batches}: FAILED — {e}')
            time.sleep(RATE_LIMIT_SEC)
            continue

        rows_updated = apply_updates(supabase, po_map, args.dry_run)
        total_po_found += len(po_map)
        total_rows_updated += rows_updated

        print(
            f'  Batch {batch_idx+1}/{total_batches}: '
            f'queried {len(batch)} cores → {len(po_map)} POs found → '
            f'{rows_updated} rows updated'
        )
        # Rate limit before the next call (skip on the last batch).
        if batch_idx < total_batches - 1:
            time.sleep(RATE_LIMIT_SEC)

    print()
    print('=' * 72)
    print('Done')
    print('=' * 72)
    print(f'  Cores queried:            {len(project_nums):,}')
    print(f'  Cores with PO returned:   {total_po_found:,}')
    print(
        f'  Cores with NO PO in API:  {len(project_nums) - total_po_found:,} '
        '(genuinely missing from RePORTER — accept as null)'
    )
    print(f'  application_id rows updated: {total_rows_updated:,}')
    print()
    print('Verify with:')
    print(
        "  SELECT count(*) FROM projects WHERE program_officer IS NULL "
        f"AND created_at >= '{args.from_date}';"
    )


if __name__ == '__main__':
    main()
