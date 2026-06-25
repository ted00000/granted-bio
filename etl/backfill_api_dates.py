"""
Backfill project_start, project_end, and award_date for projects ingested
via etl/sync_projects_via_api.py before the parse_date fix landed
(2026-06-25). The original ingest left these three fields NULL on all
17K projects from windows 1 + 2 because parse_date couldn't parse the
RePORTER API's ISO datetime format ('2026-03-19T00:00:00').

Strategy: pull the API by appl_ids (250 per call — the API supports
this), extract only the three date fields, write them back via UPDATE.
No classification, no abstract, no re-ingest of other fields.

Default scope:
  - project_start IS NULL on a project that has a non-null pi_names
    (rules out completely-missing rows; new awards from the catch-up
    have pi_names set even when dates are null).

Override with --since / --limit / --dry-run for flexibility.

Rate limit: 1 req/sec per NIH guidance.
"""

import argparse
import os
import sys
import time
from typing import Dict, Any, List
from dotenv import load_dotenv

load_dotenv('.env.local')

import requests
from supabase import create_client, Client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from process_projects import parse_date


API_URL = 'https://api.reporter.nih.gov/v2/projects/search'
APPL_IDS_PER_CALL = 250
RATE_LIMIT_SLEEP_SEC = 1.0


def get_supabase() -> Client:
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise ValueError('Missing SUPABASE env vars in .env.local')
    return create_client(url, key)


def fetch_target_rows(supabase: Client, since: str = None, limit: int = None) -> Dict[str, str]:
    """Pull (application_id → project_number) for projects that need date
    backfill. Returns a dict so we can include project_number in the upsert
    payload (PostgREST's INSERT clause requires it even when ON CONFLICT
    routes to UPDATE)."""
    out: Dict[str, str] = {}
    offset = 0
    page = 1000
    while True:
        q = supabase.table('projects').select('application_id, project_number').is_('project_start', 'null')
        if since:
            q = q.gte('created_at', since)
        rows = q.range(offset, offset + page - 1).execute().data or []
        if not rows:
            break
        for r in rows:
            aid = r.get('application_id')
            pn = r.get('project_number')
            if aid is None or pn is None:
                continue
            out[str(aid)] = pn
        offset += page
        if len(rows) < page:
            break
        if limit and len(out) >= limit:
            # Trim down to the requested cap (sorted for determinism)
            keys = sorted(out.keys())[:limit]
            out = {k: out[k] for k in keys}
            break
    return out


def chunked(seq: List[int], n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def fetch_api_batch(appl_ids: List[int]) -> List[Dict[str, Any]]:
    resp = requests.post(
        API_URL,
        json={
            'criteria': {'appl_ids': appl_ids},
            'limit': len(appl_ids),
            'offset': 0,
        },
        headers={'Accept': 'application/json'},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json().get('results') or []


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--since', default=None, help='Only backfill projects with created_at >= YYYY-MM-DD (default: all NULL dates)')
    parser.add_argument('--limit', type=int, default=None, help='Cap number of projects processed')
    parser.add_argument('--dry-run', action='store_true', help='Skip DB writes')
    parser.add_argument('--yes', action='store_true', help='Skip confirmation prompt')
    args = parser.parse_args()

    print('=' * 64)
    print('Backfill project dates from RePORTER API')
    print('=' * 64)

    supabase = get_supabase()
    appl_to_pn = fetch_target_rows(supabase, since=args.since, limit=args.limit)
    appl_ids = [int(a) for a in appl_to_pn.keys()]
    print(f'  Projects with NULL project_start: {len(appl_ids):,}')
    if args.since:
        print(f'  Filter: created_at >= {args.since}')
    if args.limit:
        print(f'  Limit: {args.limit:,}')
    if args.dry_run:
        print('  DRY RUN — no DB writes')

    if not appl_ids:
        print('Nothing to backfill. Done.')
        return

    n_calls = (len(appl_ids) + APPL_IDS_PER_CALL - 1) // APPL_IDS_PER_CALL
    eta_min = n_calls * RATE_LIMIT_SLEEP_SEC / 60
    print(f'  Will make {n_calls:,} API calls ({APPL_IDS_PER_CALL} appl_ids each).')
    print(f'  ETA at 1 req/sec: {eta_min:.0f} min')
    print()

    if not args.yes and not args.dry_run and len(appl_ids) > 200:
        resp = input(f'Backfill {len(appl_ids):,} projects? [y/N] ').strip().lower()
        if resp != 'y':
            print('Aborted.')
            return

    total_fetched = 0
    total_with_dates = 0
    total_updated = 0
    total_errors = 0

    for i, batch in enumerate(chunked(appl_ids, APPL_IDS_PER_CALL)):
        try:
            results = fetch_api_batch(batch)
        except Exception as e:
            total_errors += 1
            print(f'  [{i + 1}/{n_calls}] FETCH ERROR — {str(e)[:120]}')
            time.sleep(RATE_LIMIT_SLEEP_SEC)
            continue

        total_fetched += len(results)
        # Per-row UPDATE: PostgREST upsert builds an INSERT statement that
        # would have to satisfy every NOT NULL constraint on projects
        # (project_number, title, ...). UPDATE doesn't have that problem —
        # it just changes the specified columns on the matched row.
        for r in results:
            aid = r.get('appl_id')
            if aid is None:
                continue
            aid_str = str(aid)
            if aid_str not in appl_to_pn:
                continue
            project_start = parse_date(r.get('project_start_date') or '')
            project_end = parse_date(r.get('project_end_date') or '')
            award_date = parse_date(r.get('award_notice_date') or '')
            if not any([project_start, project_end, award_date]):
                continue
            total_with_dates += 1
            patch: Dict[str, Any] = {}
            if project_start:
                patch['project_start'] = project_start
            if project_end:
                patch['project_end'] = project_end
            if award_date:
                patch['award_date'] = award_date
            if not args.dry_run:
                try:
                    supabase.table('projects').update(patch).eq('application_id', aid_str).execute()
                    total_updated += 1
                except Exception as e:
                    total_errors += 1
                    if total_errors <= 5:
                        print(f'  Update error on appl_id={aid_str}: {str(e)[:120]}')

        if (i + 1) % 5 == 0 or i == n_calls - 1:
            print(f'  [{i + 1}/{n_calls}] fetched={total_fetched:,} updated={total_updated:,} errors={total_errors}')

        time.sleep(RATE_LIMIT_SLEEP_SEC)

    print()
    print('=' * 64)
    print('Done.')
    print(f'  API rows returned:    {total_fetched:,}')
    print(f'  Rows with any dates:  {total_with_dates:,}')
    print(f'  Rows updated in DB:   {total_updated:,}')
    print(f'  Errors:               {total_errors}')
    print('=' * 64)


if __name__ == '__main__':
    main()
