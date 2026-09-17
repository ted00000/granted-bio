"""
Backfill the trial-quality pack columns on clinical_studies from stored
api_raw_data:

  allocation, intervention_model, masking, why_stopped,
  is_fda_regulated_drug, is_fda_regulated_device, has_dmc,
  collaborators, overall_officials, primary_outcomes, secondary_outcomes

See migration 20260914_clinical_trial_quality_pack.sql. Zero CT.gov API
calls — extracts from raw responses already stashed by
etl/enrich_clinical_trials.py.

Usage:
    python3 etl/backfill_trial_quality_pack.py --dry-run       # counts + samples
    python3 etl/backfill_trial_quality_pack.py --limit 500     # smoke test
    python3 etl/backfill_trial_quality_pack.py                 # commit
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


def truncate_desc(text: Optional[str], limit: int = 500) -> Optional[str]:
    if not text:
        return None
    t = text.strip()
    if len(t) > limit:
        return t[:limit] + '...'
    return t or None


def extract_pack(api_raw_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Extract all trial-quality pack fields from a CT.gov v2 response."""
    empty = {
        'allocation': None, 'intervention_model': None, 'masking': None,
        'why_stopped': None,
        'is_fda_regulated_drug': None, 'is_fda_regulated_device': None,
        'has_dmc': None,
        'collaborators': None, 'overall_officials': None,
        'primary_outcomes': None, 'secondary_outcomes': None,
    }
    if not api_raw_data:
        return empty

    protocol = api_raw_data.get('protocolSection', {}) or {}

    design_info = (protocol.get('designModule', {}) or {}).get('designInfo', {}) or {}
    masking_info = design_info.get('maskingInfo') or {}

    status = protocol.get('statusModule', {}) or {}
    oversight = protocol.get('oversightModule', {}) or {}
    sponsor = protocol.get('sponsorCollaboratorsModule', {}) or {}
    contacts = protocol.get('contactsLocationsModule', {}) or {}
    outcomes = protocol.get('outcomesModule', {}) or {}

    collaborators = [
        {'name': c.get('name'), 'class': c.get('class')}
        for c in (sponsor.get('collaborators') or [])
        if c.get('name')
    ]

    overall_officials = [
        {
            'name': o.get('name'),
            'role': o.get('role'),
            'affiliation': o.get('affiliation'),
        }
        for o in (contacts.get('overallOfficials') or [])
        if o.get('name')
    ]

    def _norm_outcome(o):
        return {
            'measure': o.get('measure'),
            'time_frame': o.get('timeFrame'),
            'description': truncate_desc(o.get('description')),
        }
    primary_outcomes = [_norm_outcome(o) for o in (outcomes.get('primaryOutcomes') or [])]
    secondary_outcomes = [_norm_outcome(o) for o in (outcomes.get('secondaryOutcomes') or [])]

    return {
        'allocation': design_info.get('allocation'),
        'intervention_model': design_info.get('interventionModel'),
        'masking': masking_info.get('masking'),
        'why_stopped': status.get('whyStopped'),
        'is_fda_regulated_drug': oversight.get('isFdaRegulatedDrug'),
        'is_fda_regulated_device': oversight.get('isFdaRegulatedDevice'),
        'has_dmc': oversight.get('oversightHasDmc'),
        'collaborators': collaborators or None,
        'overall_officials': overall_officials or None,
        'primary_outcomes': primary_outcomes or None,
        'secondary_outcomes': secondary_outcomes or None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--limit', type=int, default=None)
    args = parser.parse_args()

    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        print('ERROR: env vars missing', file=sys.stderr)
        return 1

    supabase = create_client(url, key)

    print('=' * 60)
    print('BACKFILL: clinical_studies trial-quality pack (11 columns)')
    print('=' * 60)
    if args.dry_run:
        print('MODE: dry-run (no writes)')
    print()

    total_seen = 0
    missing_source = 0

    # Coverage counters — one per column so we know what fraction
    # of trials actually carry each signal.
    coverage: Counter[str] = Counter()

    # Distributions to sanity-check top values.
    allocation_dist: Counter[str] = Counter()
    intervention_model_dist: Counter[str] = Counter()
    masking_dist: Counter[str] = Counter()
    fda_drug_true = 0
    fda_device_true = 0
    dmc_true = 0
    collaborator_class_dist: Counter[str] = Counter()
    official_role_dist: Counter[str] = Counter()
    trials_with_industry_collab = 0
    trials_with_primary_outcome = 0
    trials_with_secondary_outcome = 0
    why_stopped_count = 0

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

        resp = (supabase.from_('clinical_studies')
                .select('id, api_raw_data')
                .order('id').range(start, end).execute())
        rows = resp.data or []
        if not rows:
            break

        for row in rows:
            total_seen += 1
            api_raw = row.get('api_raw_data')
            if not api_raw:
                missing_source += 1
                continue

            pack = extract_pack(api_raw)

            # Coverage + distribution tallies
            if pack['allocation']:
                coverage['allocation'] += 1
                allocation_dist[pack['allocation']] += 1
            if pack['intervention_model']:
                coverage['intervention_model'] += 1
                intervention_model_dist[pack['intervention_model']] += 1
            if pack['masking']:
                coverage['masking'] += 1
                masking_dist[pack['masking']] += 1
            if pack['why_stopped']:
                coverage['why_stopped'] += 1
                why_stopped_count += 1
            if pack['is_fda_regulated_drug'] is not None:
                coverage['is_fda_regulated_drug'] += 1
                if pack['is_fda_regulated_drug']:
                    fda_drug_true += 1
            if pack['is_fda_regulated_device'] is not None:
                coverage['is_fda_regulated_device'] += 1
                if pack['is_fda_regulated_device']:
                    fda_device_true += 1
            if pack['has_dmc'] is not None:
                coverage['has_dmc'] += 1
                if pack['has_dmc']:
                    dmc_true += 1
            if pack['collaborators']:
                coverage['collaborators'] += 1
                for c in pack['collaborators']:
                    if c.get('class'):
                        collaborator_class_dist[c['class']] += 1
                if any((c.get('class') == 'INDUSTRY') for c in pack['collaborators']):
                    trials_with_industry_collab += 1
            if pack['overall_officials']:
                coverage['overall_officials'] += 1
                for o in pack['overall_officials']:
                    if o.get('role'):
                        official_role_dist[o['role']] += 1
            if pack['primary_outcomes']:
                coverage['primary_outcomes'] += 1
                trials_with_primary_outcome += 1
            if pack['secondary_outcomes']:
                coverage['secondary_outcomes'] += 1
                trials_with_secondary_outcome += 1

            if not args.dry_run:
                supabase.from_('clinical_studies').update(pack).eq('id', row['id']).execute()

        page += 1
        if args.limit is not None and total_seen >= args.limit:
            break
        if len(rows) < BATCH_SIZE:
            break

    def pct(n: int) -> str:
        return f'{100 * n / max(1, total_seen):.1f}%'

    print(f'Rows examined:            {total_seen:,}')
    print(f'Missing api_raw_data:     {missing_source:,}')
    print()
    print('Coverage per column:')
    for col in ('allocation', 'intervention_model', 'masking', 'why_stopped',
                'is_fda_regulated_drug', 'is_fda_regulated_device', 'has_dmc',
                'collaborators', 'overall_officials',
                'primary_outcomes', 'secondary_outcomes'):
        n = coverage[col]
        print(f'  {col:26} {n:>7,}  ({pct(n)})')
    print()
    print('allocation distribution:')
    for v, c in allocation_dist.most_common():
        print(f'  {v:20} {c:>7,}')
    print()
    print('intervention_model distribution:')
    for v, c in intervention_model_dist.most_common():
        print(f'  {v:20} {c:>7,}')
    print()
    print('masking distribution:')
    for v, c in masking_dist.most_common():
        print(f'  {v:20} {c:>7,}')
    print()
    print('FDA / DMC flags (TRUE counts):')
    print(f'  is_fda_regulated_drug   TRUE: {fda_drug_true:,}')
    print(f'  is_fda_regulated_device TRUE: {fda_device_true:,}')
    print(f'  has_dmc                 TRUE: {dmc_true:,}')
    print()
    print(f'why_stopped populated (trial terminated early): {why_stopped_count:,}')
    print()
    print('collaborator class distribution (all collaborator rows):')
    for v, c in collaborator_class_dist.most_common(10):
        print(f'  {v:26} {c:>7,}')
    print(f'  trials with any INDUSTRY collaborator: {trials_with_industry_collab:,}')
    print()
    print('overall_officials role distribution (all official rows):')
    for v, c in official_role_dist.most_common(10):
        print(f'  {v:26} {c:>7,}')
    print()
    print(f'trials with any primary_outcomes:   {trials_with_primary_outcome:,}')
    print(f'trials with any secondary_outcomes: {trials_with_secondary_outcome:,}')
    if args.dry_run:
        print()
        print('DRY-RUN: no rows were written.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
