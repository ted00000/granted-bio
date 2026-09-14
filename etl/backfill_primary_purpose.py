"""
Backfill clinical_studies.primary_purpose from stored api_raw_data and
re-classify the legacy is_therapeutic_trial / is_diagnostic_trial booleans
under the corrected keyword rule (no default-to-therapeutic).

Why: migration 20260914_clinical_trial_primary_purpose.sql adds the
primary_purpose column. This script populates it for existing rows
using the CT.gov response already stashed in api_raw_data — no calls
to ClinicalTrials.gov required.

Also corrects historical over-attribution: process_clinical.py used to
default is_therapeutic_trial to TRUE when neither diagnostic nor
therapeutic keywords hit the title. That default is now removed
(both flags become FALSE for unclassified titles). This script re-runs
the corrected classifier against every row's stored study_title so the
historical booleans stop lying.

Usage:
    python etl/backfill_primary_purpose.py --dry-run     # report counts, no writes
    python etl/backfill_primary_purpose.py               # write updates
    python etl/backfill_primary_purpose.py --limit 100   # small test batch
"""

import os
import sys
import argparse
from typing import Any, Dict, List, Optional
from collections import Counter

from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

# Reuse the corrected classifier so backfill and delta loader agree.
from process_clinical import classify_clinical_study


BATCH_SIZE = 500


def extract_primary_purpose(api_raw_data: Optional[Dict[str, Any]]) -> Optional[str]:
    """Pull primaryPurpose from CT.gov v2 response shape."""
    if not api_raw_data:
        return None
    protocol = api_raw_data.get('protocolSection', {}) or {}
    design = protocol.get('designModule', {}) or {}
    design_info = design.get('designInfo', {}) or {}
    value = design_info.get('primaryPurpose')
    if not value:
        return None
    # CT.gov emits UPPER_SNAKE_CASE values but be defensive against odd
    # legacy records.
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
        print('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local',
              file=sys.stderr)
        return 1

    supabase = create_client(url, key)

    print('=' * 60)
    print('BACKFILL: clinical_studies.primary_purpose + booleans')
    print('=' * 60)
    if args.dry_run:
        print('MODE: dry-run (no writes)')
    print()

    # Pull rows page by page. We select the minimum set needed to
    # decide the update. api_raw_data is heavy — pull only when needed.
    total_seen = 0
    total_purpose_set = 0
    total_purpose_already = 0
    total_purpose_missing_source = 0
    total_bool_changed = 0
    purpose_distribution: Counter[str] = Counter()
    bool_change_reasons: Counter[str] = Counter()

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
                .select('id, study_title, is_diagnostic_trial, '
                        'is_therapeutic_trial, primary_purpose, api_raw_data')
                .order('id')
                .range(start, end)
                .execute())

        rows: List[Dict[str, Any]] = resp.data or []
        if not rows:
            break

        for row in rows:
            total_seen += 1
            row_id = row['id']
            existing_purpose = row.get('primary_purpose')
            api_raw = row.get('api_raw_data')

            updates: Dict[str, Any] = {}

            # 1. primary_purpose backfill
            source_purpose = extract_primary_purpose(api_raw)
            if source_purpose:
                if existing_purpose == source_purpose:
                    total_purpose_already += 1
                else:
                    updates['primary_purpose'] = source_purpose
                    total_purpose_set += 1
                purpose_distribution[source_purpose] += 1
            else:
                if existing_purpose:
                    # Row previously had a value but api_raw_data is
                    # empty. Leave as-is; don't clobber.
                    pass
                else:
                    total_purpose_missing_source += 1

            # 2. Re-run the corrected keyword classifier on the stored
            #    title so historical booleans stop reflecting the old
            #    default-to-therapeutic rule.
            corrected = classify_clinical_study(row.get('study_title') or '')
            new_diag = corrected['is_diagnostic_trial']
            new_therap = corrected['is_therapeutic_trial']
            old_diag = bool(row.get('is_diagnostic_trial'))
            old_therap = bool(row.get('is_therapeutic_trial'))

            if new_diag != old_diag or new_therap != old_therap:
                updates['is_diagnostic_trial'] = new_diag
                updates['is_therapeutic_trial'] = new_therap
                total_bool_changed += 1
                # Categorize the change for the summary.
                if old_therap and not new_therap and not new_diag:
                    # The classic historical bug: was TRUE by default,
                    # now honestly unclassified.
                    bool_change_reasons['therapeutic_default_removed'] += 1
                elif not old_diag and new_diag:
                    bool_change_reasons['now_diagnostic'] += 1
                elif not old_therap and new_therap:
                    bool_change_reasons['now_therapeutic'] += 1
                else:
                    bool_change_reasons['other'] += 1

            if updates and not args.dry_run:
                (supabase
                 .from_('clinical_studies')
                 .update(updates)
                 .eq('id', row_id)
                 .execute())

        page += 1
        if args.limit is not None and total_seen >= args.limit:
            break
        if len(rows) < BATCH_SIZE:
            break

    # Summary
    print(f'Rows examined:                        {total_seen:,}')
    print()
    print('primary_purpose:')
    print(f'  Set from api_raw_data:              {total_purpose_set:,}')
    print(f'  Already correct (no update):        {total_purpose_already:,}')
    print(f'  Missing source (no api_raw_data     {total_purpose_missing_source:,}')
    print(f'    or field absent from response):')
    print()
    print('primary_purpose distribution (populated rows only):')
    for purpose, count in purpose_distribution.most_common():
        print(f'  {purpose:35s} {count:>7,}')
    print()
    print('legacy booleans re-classified:')
    print(f'  Rows changed:                       {total_bool_changed:,}')
    for reason, count in bool_change_reasons.most_common():
        print(f'    {reason:32s} {count:>7,}')
    if args.dry_run:
        print()
        print('DRY-RUN: no rows were written.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
