"""
Backfill clinical_studies.condition_mesh + intervention_mesh from stored
api_raw_data.

Reads the CT.gov response already stashed in api_raw_data, extracts the
MeSH descriptor terms from derivedSection.conditionBrowseModule.meshes[]
and derivedSection.interventionBrowseModule.meshes[], writes to the two
new columns. Zero CT.gov API calls.

Same pattern as backfill_primary_purpose.py and
backfill_lead_sponsor_class.py.

Usage:
    python3 etl/backfill_mesh.py --dry-run     # counts, no writes
    python3 etl/backfill_mesh.py --limit 500   # smoke test
    python3 etl/backfill_mesh.py               # commit
"""

import os
import sys
import argparse
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter

from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client


BATCH_SIZE = 500


def extract_mesh(api_raw_data: Optional[Dict[str, Any]]) -> Tuple[List[str], List[str]]:
    """Return (condition_mesh, intervention_mesh) lists from a CT.gov v2 response."""
    if not api_raw_data:
        return [], []
    derived = api_raw_data.get('derivedSection', {}) or {}
    condition_browse = derived.get('conditionBrowseModule', {}) or {}
    intervention_browse = derived.get('interventionBrowseModule', {}) or {}
    condition_mesh = [
        m['term'].strip()
        for m in (condition_browse.get('meshes') or [])
        if m.get('term') and m['term'].strip()
    ]
    intervention_mesh = [
        m['term'].strip()
        for m in (intervention_browse.get('meshes') or [])
        if m.get('term') and m['term'].strip()
    ]
    return condition_mesh, intervention_mesh


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
    print('BACKFILL: clinical_studies.condition_mesh + intervention_mesh')
    print('=' * 60)
    if args.dry_run:
        print('MODE: dry-run (no writes)')
    print()

    total_seen = 0
    rows_with_condition = 0
    rows_with_intervention = 0
    rows_with_any_mesh = 0
    rows_missing_source = 0
    condition_term_counts: Counter[str] = Counter()
    intervention_term_counts: Counter[str] = Counter()
    condition_len_dist: Counter[int] = Counter()
    intervention_len_dist: Counter[int] = Counter()

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
                .select('id, condition_mesh, intervention_mesh, api_raw_data')
                .order('id')
                .range(start, end)
                .execute())

        rows: List[Dict[str, Any]] = resp.data or []
        if not rows:
            break

        for row in rows:
            total_seen += 1
            row_id = row['id']
            api_raw = row.get('api_raw_data')

            cond, interv = extract_mesh(api_raw)
            has_any = bool(cond) or bool(interv)
            if not api_raw:
                rows_missing_source += 1
                continue

            if cond:
                rows_with_condition += 1
                for term in cond:
                    condition_term_counts[term] += 1
            if interv:
                rows_with_intervention += 1
                for term in interv:
                    intervention_term_counts[term] += 1
            if has_any:
                rows_with_any_mesh += 1
            condition_len_dist[len(cond)] += 1
            intervention_len_dist[len(interv)] += 1

            update: Dict[str, Any] = {}
            if cond and row.get('condition_mesh') != cond:
                update['condition_mesh'] = cond
            if interv and row.get('intervention_mesh') != interv:
                update['intervention_mesh'] = interv

            if update and not args.dry_run:
                (supabase
                 .from_('clinical_studies')
                 .update(update)
                 .eq('id', row_id)
                 .execute())

        page += 1
        if args.limit is not None and total_seen >= args.limit:
            break
        if len(rows) < BATCH_SIZE:
            break

    def pct(n: int) -> str:
        return f'{100 * n / max(1, total_seen):.1f}%'

    print(f'Rows examined:                        {total_seen:,}')
    print(f'  with any MeSH:                      {rows_with_any_mesh:,}  ({pct(rows_with_any_mesh)})')
    print(f'  with condition_mesh:                {rows_with_condition:,}  ({pct(rows_with_condition)})')
    print(f'  with intervention_mesh:             {rows_with_intervention:,}  ({pct(rows_with_intervention)})')
    print(f'  missing api_raw_data:               {rows_missing_source:,}')
    print()
    print('condition_mesh terms per trial (distribution):')
    for length in sorted(condition_len_dist.keys())[:10]:
        print(f'  {length:>2} terms: {condition_len_dist[length]:>6,}')
    if len(condition_len_dist) > 10:
        long_tail = sum(v for k, v in condition_len_dist.items() if k >= 10)
        print(f'  10+ terms: {long_tail:>6,}')
    print()
    print('Top 15 condition MeSH terms:')
    for term, count in condition_term_counts.most_common(15):
        print(f'  {count:>6,}  {term}')
    print()
    print('Top 15 intervention MeSH terms:')
    for term, count in intervention_term_counts.most_common(15):
        print(f'  {count:>6,}  {term}')
    if args.dry_run:
        print()
        print('DRY-RUN: no rows were written.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
