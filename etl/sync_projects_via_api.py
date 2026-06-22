"""
Sync new bio-related projects from the RePORTER API into the projects + abstracts
DB tables. This is the catch-up + ongoing-cron path for new awards.

What this DOES:
- Pulls projects with date_added >= <floor> AND fiscal_year in retention window
- Maps API JSON shape → process_projects dict shape
- Applies the bio-boundary filter
- Classifies via the existing biotools classifier
- Upserts projects (on application_id) and abstracts (on application_id)
- Does NOT regenerate embeddings — run etl/generate_embeddings_batched.py
  (default NULL-only mode) after this completes

What this DOESN'T do (and why ExPORTER bulk is still needed):
- The API has no last_modified_date filter, so MODIFICATIONS to existing
  awards (PI moves, no-cost extensions, total_cost revisions) are not
  captured. For those, wait for the next ExPORTER bulk refresh.

Usage:
    python3 etl/sync_projects_via_api.py [--from-date YYYY-MM-DD] [--dry-run]

Defaults:
    --from-date: 2026-03-09 (our last bulk snapshot date)
    --dry-run: false; pass to skip all DB writes

Rate-limit aware: 1 req/sec per the NIH RePORTER guidance.
"""

import os
import sys
import json
import time
import argparse
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

load_dotenv('.env.local')

import requests
from supabase import create_client, Client

from process_projects import (
    is_bio_related,
    determine_org_type,
    parse_date,
    parse_cost,
)
from classifier import classify_projects as run_classifier


API_URL = 'https://api.reporter.nih.gov/v2/projects/search'

# Retention window today. Update on each Sep 30 FY rollover.
FISCAL_YEARS = [2024, 2025, 2026]

# Default snapshot floor (our last bulk ExPORTER projects date).
DEFAULT_FROM_DATE = '2026-03-09'

PAGE_SIZE = 500
RATE_LIMIT_SLEEP_SEC = 1.0  # Respect NIH's "no more than 1 req/sec" guidance


def get_supabase_client() -> Client:
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise ValueError(
            'Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_KEY '
            '(or SUPABASE_SERVICE_ROLE_KEY) in environment / .env.local'
        )
    return create_client(url, key)


def post(payload: Dict[str, Any]) -> Dict[str, Any]:
    resp = requests.post(
        API_URL,
        json=payload,
        headers={'Accept': 'application/json'},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def api_row_to_process_dict(api: Dict[str, Any]) -> Dict[str, Any]:
    """
    Map a RePORTER API V2 project response to the dict shape that
    process_projects.is_bio_related and load_to_supabase expect (which
    were originally designed for ExPORTER CSV column names).
    """
    org = api.get('organization') or {}
    pi_profile = api.get('contact_pi_name') or ''
    other_pis = [
        p.get('full_name')
        for p in (api.get('principal_investigators') or [])
        if p.get('full_name')
    ]
    pi_names = ';'.join(filter(None, [pi_profile, *other_pis]))

    agency_ics = api.get('agency_ic_fundings') or []
    ic_string = ';'.join(
        [
            a.get('abbreviation') or a.get('name') or ''
            for a in agency_ics
            if a.get('abbreviation') or a.get('name')
        ]
    )
    if not ic_string:
        admin = api.get('agency_ic_admin') or {}
        ic_string = admin.get('abbreviation') or admin.get('name') or ''

    return {
        # ExPORTER-style raw column names — used by the bio filter
        'FUNDING_ICs': ic_string,
        'ACTIVITY': api.get('activity_code') or '',
        'PROJECT_TITLE': api.get('project_title') or '',
        'PHR': api.get('phr_text') or '',
        'ORG_NAME': org.get('org_name') or '',
        # The fields the loader's classify_biotools_confidence consumes
        'application_id': str(api.get('appl_id') or ''),
        'project_number': api.get('core_project_num') or api.get('project_num') or '',
        'full_project_num': api.get('project_num') or '',
        'activity_code': api.get('activity_code') or '',
        'funding_mechanism': api.get('funding_mechanism') or '',
        'title': api.get('project_title') or '',
        'terms': (api.get('project_terms') or ''),
        'phr': api.get('phr_text') or '',
        'org_name': org.get('org_name') or '',
        'org_type': determine_org_type(
            org.get('org_name') or '',
            api.get('funding_mechanism') or '',
        ),
        'org_city': org.get('org_city') or '',
        'org_state': org.get('org_state') or '',
        'org_country': org.get('org_country') or '',
        'org_zip': org.get('org_zipcode') or '',
        'total_cost': parse_cost(str(api.get('award_amount') or 0)),
        'award_date': parse_date(api.get('award_notice_date') or ''),
        'project_start': parse_date(api.get('project_start_date') or ''),
        'project_end': parse_date(api.get('project_end_date') or ''),
        'fiscal_year': api.get('fiscal_year'),
        'pi_names': pi_names,
        'funding_agency': 'NIH',
        # Abstract gets stored separately; keep it next to the project here for now
        '_abstract_text': (api.get('abstract_text') or '').strip(),
    }


def fetch_all_pages(from_date: str, to_date: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Paginate through all matching projects, respecting the rate limit.
    Returns the raw API rows; mapping + filtering happens in the caller.
    """
    date_added: Dict[str, str] = {'from_date': from_date}
    if to_date:
        date_added['to_date'] = to_date
    criteria = {
        'criteria': {
            'fiscal_years': FISCAL_YEARS,
            'date_added': date_added,
        },
    }

    # Probe for total
    first = post({**criteria, 'limit': PAGE_SIZE, 'offset': 0})
    total = (first.get('meta') or {}).get('total') or 0
    results = list(first.get('results') or [])
    print(f'  Page 1: total={total:,}, fetched={len(results):,}')

    if total <= PAGE_SIZE:
        return results

    offset = PAGE_SIZE
    page_num = 2
    while offset < total and offset < 15000:  # API max offset
        time.sleep(RATE_LIMIT_SLEEP_SEC)
        resp = post({**criteria, 'limit': PAGE_SIZE, 'offset': offset})
        page_rows = resp.get('results') or []
        results.extend(page_rows)
        print(f'  Page {page_num}: offset={offset:,}, fetched={len(page_rows):,}, running={len(results):,}')
        if not page_rows:
            break
        offset += PAGE_SIZE
        page_num += 1

    if total > 15000:
        print(
            f'  WARNING: total ({total:,}) exceeds API max offset (15,000). '
            f'Pulled {len(results):,}; remainder needs date-chunking.'
        )

    return results


def batch_upsert(
    supabase: Client,
    table: str,
    rows: List[Dict[str, Any]],
    on_conflict: str,
    batch_size: int = 100,
) -> int:
    """Same shape as the delta loaders we already shipped."""
    if not rows:
        return 0
    total_batches = (len(rows) + batch_size - 1) // batch_size
    upserted = 0
    print(f'  Upserting {len(rows):,} rows to {table} ({total_batches} batches of ≤{batch_size})...')
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        batch_num = (i // batch_size) + 1
        try:
            supabase.table(table).upsert(batch, on_conflict=on_conflict).execute()
            upserted += len(batch)
            print(f'    Batch {batch_num}/{total_batches}: upserted {len(batch)} rows')
        except Exception as e:
            print(f'    Batch {batch_num}/{total_batches} FAILED: {e}')
            raise
    return upserted


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--from-date',
        default=DEFAULT_FROM_DATE,
        help=f'date_added.from_date filter (default: {DEFAULT_FROM_DATE})',
    )
    parser.add_argument(
        '--to-date',
        default=None,
        help='Optional date_added.to_date filter (inclusive). Used for date-chunking when total exceeds the 15k API offset cap.',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Skip all DB writes; print what would be written',
    )
    args = parser.parse_args()

    print('=' * 72)
    print('RePORTER API → projects sync')
    print('=' * 72)
    print(f'  date_added.from_date = {args.from_date}')
    print(f'  date_added.to_date   = {args.to_date or "(none)"}')
    print(f'  fiscal_years         = {FISCAL_YEARS}')
    print(f'  dry-run              = {args.dry_run}')
    print()

    # 1. Pull every matching project from the API
    print('Fetching from RePORTER API...')
    api_rows = fetch_all_pages(args.from_date, args.to_date)
    print(f'  Total fetched: {len(api_rows):,}')
    print()

    if not api_rows:
        print('No new projects to ingest. Done.')
        return

    # 2. Map + bio-filter
    print('Mapping + bio-filtering...')
    bio_rows: List[Dict[str, Any]] = []
    non_bio_dropped = 0
    for row in api_rows:
        mapped = api_row_to_process_dict(row)
        if is_bio_related(mapped):
            bio_rows.append(mapped)
        else:
            non_bio_dropped += 1
    print(f'  Bio-related kept: {len(bio_rows):,}')
    print(f'  Non-bio dropped : {non_bio_dropped:,}')
    print()

    if not bio_rows:
        print('No bio-related projects in the API response. Done.')
        return

    # 3. Pull abstracts out for separate abstract upsert later, and build
    # the per-project payload the canonical classifier expects.
    abstracts_to_load: List[Dict[str, Any]] = []
    abstracts_map: Dict[str, str] = {}
    for row in bio_rows:
        abstract_text = row.pop('_abstract_text', '')
        if abstract_text:
            abstracts_to_load.append({
                'application_id': row['application_id'],
                'abstract_text': abstract_text,
                'abstract_length': len(abstract_text),
            })
            abstracts_map[row['application_id']] = abstract_text

    # 4. Classify via the canonical classifier (Python Pass 1 + Haiku Pass 2).
    print(f'Classifying {len(bio_rows):,} new projects (Pass 1 in code + Haiku for content)...')
    classifications = run_classifier(bio_rows, abstracts_map)
    print(f'  Classified: {len(classifications):,} / {len(bio_rows):,}')

    # Merge classifications back into the bio_rows by application_id.
    class_by_id = {str(c['application_id']): c for c in classifications}
    classified: List[Dict[str, Any]] = []
    for row in bio_rows:
        app_id = str(row.get('application_id'))
        c = class_by_id.get(app_id)
        if c:
            row['primary_category'] = c['primary_category']
            row['primary_category_confidence'] = c['category_confidence']
            row['org_type'] = c['org_type']
        # If classifier failed for a row we still ingest it; primary_category
        # stays NULL and the row surfaces in the admin review queue.
        classified.append(row)
    print()

    if args.dry_run:
        print('DRY RUN — skipping all DB writes.')
        print(f'  Would upsert {len(classified):,} projects')
        print(f'  Would upsert {len(abstracts_to_load):,} abstracts')
        return

    # 4. Upsert projects, then abstracts
    supabase = get_supabase_client()
    print('Upserting to DB...')
    projects_written = batch_upsert(supabase, 'projects', classified, on_conflict='application_id')
    abstracts_written = batch_upsert(supabase, 'abstracts', abstracts_to_load, on_conflict='application_id')

    print()
    print('=' * 72)
    print('Done')
    print('=' * 72)
    print(f'  projects upserted:  {projects_written:,}')
    print(f'  abstracts upserted: {abstracts_written:,}')
    print()
    print('Embeddings: run `python3 etl/generate_embeddings_batched.py` next.')
    print('Default NULL-only mode will embed only the newly inserted projects.')


if __name__ == '__main__':
    main()
