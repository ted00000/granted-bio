"""
Read-only scope probe for the RePORTER API.

Asks: how many projects have been added to NIH RePORTER since our last bulk
snapshot (2026-03-09), within our retention window (FY2024-FY2026)?

Sends one tiny request to learn the total, then one page (≤500 rows) to
sample what's in there. Reports:
  - Total matching the filter
  - Estimated bio-related share (via process_projects.is_bio_related on
    the sample)
  - Top funding ICs, activity codes, org types from the sample
  - 5 sample project titles
  - Approximate cost projection for a full pull

No DB writes. No paid API calls. Two HTTP requests total against the free
public RePORTER endpoint.

Usage:
    python3 scripts/probe_reporter_api.py
"""

import os
import sys
import json
import time
from collections import Counter
from urllib import request, error

# Use the etl/ bio-boundary check on the sample
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'etl'))
from process_projects import is_bio_related


API_URL = 'https://api.reporter.nih.gov/v2/projects/search'

# Our retention window today (2026-06-19). Shifts at next FY close.
FISCAL_YEARS = [2024, 2025, 2026]

# Date floor = our current bulk snapshot. Anything newer than this is content
# we don't yet have.
DATE_FLOOR = '2026-03-09'


def post(payload: dict) -> dict:
    body = json.dumps(payload).encode('utf-8')
    req = request.Request(
        API_URL,
        data=body,
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST',
    )
    with request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def map_to_csv_shape(api_row: dict) -> dict:
    """
    Map a small subset of API response fields to the column names that
    process_projects.is_bio_related expects (which were originally
    designed for ExPORTER CSV column headers).
    """
    org = api_row.get('organization') or {}
    return {
        'FUNDING_ICs': (
            ';'.join(
                [
                    agency.get('abbreviation') or agency.get('name') or ''
                    for agency in (api_row.get('agency_ic_fundings') or [])
                ]
            )
            or api_row.get('agency_ic_admin', {}).get('abbreviation')
            or ''
        ),
        'ACTIVITY': api_row.get('activity_code') or '',
        'PROJECT_TITLE': api_row.get('project_title') or '',
        'PHR': api_row.get('phr_text') or '',
        'ORG_NAME': org.get('org_name') or '',
    }


def main() -> None:
    print('=' * 72)
    print('RePORTER API scope probe (read-only, free)')
    print('=' * 72)
    print(f"Filter:")
    print(f"  date_added.from_date = {DATE_FLOOR}")
    print(f"  fiscal_years         = {FISCAL_YEARS}")
    print()

    base_criteria = {
        'criteria': {
            'fiscal_years': FISCAL_YEARS,
            'date_added': {'from_date': DATE_FLOOR},
        },
    }

    # Request 1: just the count.
    print('Request 1: fetching total count...')
    try:
        meta_only = post({**base_criteria, 'limit': 1, 'offset': 0})
    except error.HTTPError as e:
        print(f'  HTTP {e.code}: {e.read().decode("utf-8", errors="replace")[:500]}')
        sys.exit(1)
    except Exception as e:
        print(f'  Error: {e}')
        sys.exit(1)

    meta = meta_only.get('meta') or {}
    total = meta.get('total')
    if total is None:
        print('  Unexpected response (no meta.total). Raw meta:')
        print(json.dumps(meta, indent=2)[:1000])
        sys.exit(1)

    print(f'  Total matching: {total:,}')
    print()

    if total == 0:
        print('Nothing new since the snapshot. No sync work needed today.')
        return

    # Request 2: pull a sample page for content reconnaissance. Sleep 1s to
    # respect the documented 1 req/sec rate-limit guidance.
    sample_size = min(500, total)
    print(f'Request 2 (after 1s pause): fetching sample of {sample_size}...')
    time.sleep(1)
    try:
        sample_resp = post({**base_criteria, 'limit': sample_size, 'offset': 0})
    except error.HTTPError as e:
        print(f'  HTTP {e.code}: {e.read().decode("utf-8", errors="replace")[:500]}')
        sys.exit(1)
    except Exception as e:
        print(f'  Error: {e}')
        sys.exit(1)

    sample = sample_resp.get('results') or []
    if not sample:
        print('  Unexpected response (no results). Raw response sample:')
        print(json.dumps(sample_resp, indent=2)[:2000])
        sys.exit(1)

    print(f'  Sample returned: {len(sample):,} rows')
    print()

    # Bio share
    bio_count = 0
    activity_codes = Counter()
    ics = Counter()
    org_types_raw = Counter()  # org_type isn't directly in API, use a proxy

    for row in sample:
        mapped = map_to_csv_shape(row)
        if is_bio_related(mapped):
            bio_count += 1
        activity_codes[mapped['ACTIVITY']] += 1
        ic_string = mapped['FUNDING_ICs']
        for ic in ic_string.split(';'):
            if ic:
                ics[ic] += 1
        org_types_raw[(row.get('organization') or {}).get('org_country') or '–'] += 1

    bio_pct = (bio_count / len(sample)) * 100 if sample else 0
    estimated_bio_total = round(total * bio_count / len(sample)) if sample else 0

    print('-' * 72)
    print('Sample analysis')
    print('-' * 72)
    print(f'Bio-related (per process_projects.is_bio_related): {bio_count:,} / {len(sample):,} ({bio_pct:.1f}%)')
    print(f'Estimated bio-related total (extrapolated):        ~{estimated_bio_total:,}')
    print()

    print('Top 10 funding ICs in sample:')
    for ic, n in ics.most_common(10):
        print(f'  {ic:8}  {n:,}')
    print()

    print('Top 10 activity codes in sample:')
    for code, n in activity_codes.most_common(10):
        print(f'  {code:8}  {n:,}')
    print()

    # Sample titles for a sniff test
    print('Sample project titles (first 5):')
    for row in sample[:5]:
        title = (row.get('project_title') or '').strip()
        org = ((row.get('organization') or {}).get('org_name') or '').strip()
        fy = row.get('fiscal_year') or '–'
        print(f'  [{fy}] {title[:80]}')
        if org:
            print(f'        org: {org}')
    print()

    # Cost projection for a full pull
    # No paid API cost — but downstream embedding + classification cost matters.
    # Per docs/DATA_SOURCE_PLAYBOOKS.md: ~$0.00002 embedding + ~$0.0001 classify
    # per project, so ~$0.00012 per bio project.
    embed_classify_cost = estimated_bio_total * 0.00012
    print('-' * 72)
    print('Cost projection if we ingest everything matching the filter:')
    print(f'  API calls:           ~{(total + 499) // 500} pages @ 1 req/sec = {(total + 499) // 500} seconds')
    print(f'  Embedding + classify: ~${embed_classify_cost:.2f} (only on the ~{estimated_bio_total:,} bio rows)')
    print(f'  Non-bio rows dropped: ~{total - estimated_bio_total:,}')
    print('-' * 72)
    print()
    print('No DB writes were made. This is a read-only scope probe.')


if __name__ == '__main__':
    main()
