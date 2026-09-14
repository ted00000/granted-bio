"""
Backfill clinical_studies.lead_sponsor_class from stored api_raw_data.

Same pattern as backfill_primary_purpose.py. Reads the CT.gov response
already stashed in api_raw_data, extracts
protocolSection.sponsorCollaboratorsModule.leadSponsor.class, writes to
the new column. Zero CT.gov API calls.

Usage:
    python3 etl/backfill_lead_sponsor_class.py --dry-run     # counts, no writes
    python3 etl/backfill_lead_sponsor_class.py --limit 500   # smoke test
    python3 etl/backfill_lead_sponsor_class.py               # commit
"""

import os
import sys
import argparse
from typing import Any, Dict, List, Optional
from collections import Counter

from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client


BATCH_SIZE = 500


def extract_lead_sponsor_class(api_raw_data: Optional[Dict[str, Any]]) -> Optional[str]:
    """Pull leadSponsor.class from a CT.gov v2 response."""
    if not api_raw_data:
        return None
    protocol = api_raw_data.get('protocolSection', {}) or {}
    sponsors = protocol.get('sponsorCollaboratorsModule', {}) or {}
    lead = sponsors.get('leadSponsor', {}) or {}
    value = lead.get('class')
    if not value:
        return None
    value = str(value).strip().upper()
    return value or None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                        help='Report what would change without writing.')
    parser.add_argument('--limit', type=int, default=None,
                        help='Cap total rows processed (for a smoke test).')
    args = parser.parse_args()

    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        print('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY must be set',
              file=sys.stderr)
        return 1

    supabase = create_client(url, key)

    print('=' * 60)
    print('BACKFILL: clinical_studies.lead_sponsor_class')
    print('=' * 60)
    if args.dry_run:
        print('MODE: dry-run (no writes)')
    print()

    total_seen = 0
    total_set = 0
    total_already = 0
    total_missing_source = 0
    class_distribution: Counter[str] = Counter()

    page = 0
    while True:
        start = page * BATCH_SIZE
        end = start + BATCH_SIZE - 1
        if args.limit is not None:
            remaining = args.limit - total_seen
            if remaining <= 0:
                break
            if remaining < BATCH_SIZE:
                end = start + remaining - 1

        resp = (supabase
                .from_('clinical_studies')
                .select('id, lead_sponsor_class, api_raw_data')
                .order('id')
                .range(start, end)
                .execute())

        rows: List[Dict[str, Any]] = resp.data or []
        if not rows:
            break

        for row in rows:
            total_seen += 1
            row_id = row['id']
            existing = row.get('lead_sponsor_class')
            api_raw = row.get('api_raw_data')

            source_value = extract_lead_sponsor_class(api_raw)
            if source_value:
                class_distribution[source_value] += 1
                if existing == source_value:
                    total_already += 1
                else:
                    total_set += 1
                    if not args.dry_run:
                        (supabase
                         .from_('clinical_studies')
                         .update({'lead_sponsor_class': source_value})
                         .eq('id', row_id)
                         .execute())
            else:
                if not existing:
                    total_missing_source += 1

        page += 1
        if args.limit is not None and total_seen >= args.limit:
            break
        if len(rows) < BATCH_SIZE:
            break

    print(f'Rows examined:                        {total_seen:,}')
    print()
    print('lead_sponsor_class:')
    print(f'  Set from api_raw_data:              {total_set:,}')
    print(f'  Already correct (no update):        {total_already:,}')
    print(f'  Missing source (no api_raw_data     {total_missing_source:,}')
    print(f'    or field absent from response):')
    print()
    print('lead_sponsor_class distribution (populated rows only):')
    for value, count in class_distribution.most_common():
        print(f'  {value:35s} {count:>7,}')
    if args.dry_run:
        print()
        print('DRY-RUN: no rows were written.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
