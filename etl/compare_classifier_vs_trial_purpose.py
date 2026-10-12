"""
Read-only report: compare projects.primary_category (LLM/rule classifier)
against the modal primary_purpose of each project's linked clinical trials
(source-truth from CT.gov via migration 20260914_clinical_trial_primary_purpose.sql).

Purpose: surface where the project classifier disagrees with clinical
signal so we can decide whether disagreements are systematic (fix the
classifier) or one-offs (route to human review). This script does NOT
change any classifications — read-only audit.

Purpose→category mapping (per agreement 2026-09-14):
    TREATMENT               → therapeutics
    PREVENTION              → therapeutics
    DIAGNOSTIC              → diagnostics
    SCREENING               → diagnostics
    DEVICE_FEASIBILITY      → medical_device
    BASIC_SCIENCE           → basic_research
    SUPPORTIVE_CARE         → other  (conservative; case-by-case in reality)
    HEALTH_SERVICES_RESEARCH→ other
    OTHER                   → other
    EDUCATIONAL_COUNSELING_TRAINING / ECT → training

Rolling-window filter matches the product surface: fiscal_year >= 2024.

Usage:
    python3 etl/compare_classifier_vs_trial_purpose.py
    python3 etl/compare_classifier_vs_trial_purpose.py --top 50  # more examples
"""

import os
import sys
import argparse
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

from fiscal_year import get_min_fiscal_year


# App-side rolling-window filter — matches the shared fiscal_year
# module (and the TS mirror src/lib/reports/fiscal-year.ts). Computed
# per-run from today's date; do not type a literal.
MIN_FISCAL_YEAR = get_min_fiscal_year()

PURPOSE_TO_CATEGORY: Dict[str, str] = {
    'TREATMENT': 'therapeutics',
    'PREVENTION': 'therapeutics',
    'DIAGNOSTIC': 'diagnostics',
    'SCREENING': 'diagnostics',
    'DEVICE_FEASIBILITY': 'medical_device',
    'BASIC_SCIENCE': 'basic_research',
    'SUPPORTIVE_CARE': 'other',
    'HEALTH_SERVICES_RESEARCH': 'other',
    'OTHER': 'other',
    'EDUCATIONAL_COUNSELING_TRAINING': 'training',
    'ECT': 'training',
}


def modal_purpose(purposes: List[str]) -> Tuple[Optional[str], bool]:
    """Return (modal_value, is_tie). Ties are flagged for reporter awareness."""
    if not purposes:
        return None, False
    counter = Counter(purposes)
    top_two = counter.most_common(2)
    if len(top_two) == 1:
        return top_two[0][0], False
    top, second = top_two
    return top[0], (top[1] == second[1])


def fetch_all(supabase, table: str, columns: str, filters=None,
              batch_size: int = 1000) -> List[Dict[str, Any]]:
    """Page through a Supabase table so we're not capped by the default row limit."""
    rows: List[Dict[str, Any]] = []
    page = 0
    while True:
        start = page * batch_size
        end = start + batch_size - 1
        query = supabase.from_(table).select(columns).order('id').range(start, end)
        if filters:
            for name, value in filters:
                if name == 'gte':
                    col, v = value
                    query = query.gte(col, v)
                elif name == 'not_is':
                    col, v = value
                    query = query.not_.is_(col, v)
        resp = query.execute()
        chunk = resp.data or []
        rows.extend(chunk)
        if len(chunk) < batch_size:
            break
        page += 1
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--top', type=int, default=25,
                        help='How many high-signal disagreements to show.')
    parser.add_argument('--exclude-categories', nargs='*',
                        default=['infrastructure', 'training'],
                        help='Skip projects with these primary_category values. '
                             'Default: infrastructure + training, because those '
                             'categories fund/administer trials without being '
                             'therapeutic themselves — trial-purpose signal is '
                             'structurally misleading there.')
    args = parser.parse_args()
    excluded_categories = set(args.exclude_categories)

    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        print('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY must be set',
              file=sys.stderr)
        return 1
    supabase = create_client(url, key)

    print('=' * 72)
    print('CLASSIFIER AUDIT: project.primary_category vs modal trial primary_purpose')
    print('=' * 72)
    print(f'Rolling-window filter: fiscal_year >= {MIN_FISCAL_YEAR}')
    print()

    # 1. Pull trials with non-NULL primary_purpose. This is our signal source.
    print('Fetching clinical_studies with primary_purpose set...')
    trial_rows = fetch_all(
        supabase, 'clinical_studies',
        'id, project_number, primary_purpose, nct_id, study_title',
        filters=[('not_is', ('primary_purpose', 'null'))],
    )
    print(f'  {len(trial_rows):,} trials with a source-truth purpose')

    # Group by project_number.
    purposes_by_project: Dict[str, List[str]] = defaultdict(list)
    trials_by_project: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for t in trial_rows:
        pn = t.get('project_number')
        pp = t.get('primary_purpose')
        if not pn or not pp:
            continue
        purposes_by_project[pn].append(pp)
        trials_by_project[pn].append(t)
    print(f'  spanning {len(purposes_by_project):,} distinct project_numbers')

    # 2. Pull projects in the rolling window with their classifier verdict.
    print(f'\nFetching projects with fiscal_year >= {MIN_FISCAL_YEAR}...')
    project_rows = fetch_all(
        supabase, 'projects',
        'id, project_number, application_id, title, org_name, primary_category, '
        'primary_category_confidence, total_cost, fiscal_year',
        filters=[('gte', ('fiscal_year', MIN_FISCAL_YEAR))],
    )
    print(f'  {len(project_rows):,} projects in window')

    projects_by_pn: Dict[str, Dict[str, Any]] = {}
    for p in project_rows:
        pn = p.get('project_number')
        if pn:
            projects_by_pn[pn] = p

    # 3. Join: projects with ≥1 linked trial with primary_purpose set.
    #    Applies the category-exclusion filter so we compare only against
    #    categories where trial-purpose signal is a fair check.
    joined: List[Tuple[Dict[str, Any], List[str]]] = []
    excluded_count = 0
    for pn, purposes in purposes_by_project.items():
        p = projects_by_pn.get(pn)
        if p is None:
            continue  # trial belongs to an out-of-window project; skip.
        if p.get('primary_category') in excluded_categories:
            excluded_count += 1
            continue
        joined.append((p, purposes))

    print(f'\nProjects in window with ≥1 linked source-truth trial: {len(joined):,}')
    print(f'  (excluded {excluded_count:,} where primary_category ∈ '
          f'{sorted(excluded_categories)})')
    print(f'Coverage: '
          f'{100 * len(joined) / max(1, len(project_rows)):.1f}% of in-window projects '
          f'have auditable trial signal.')

    # 4. Agreement rate + confusion matrix + disagreement list.
    agree = 0
    disagree = 0
    ties = 0
    unmapped_purpose = 0

    #   Rows: project.primary_category. Cols: derived expected category.
    confusion: Dict[str, Counter] = defaultdict(Counter)
    disagreements: List[Dict[str, Any]] = []
    single_trial_subset: List[Dict[str, Any]] = []
    multi_trial_subset: List[Dict[str, Any]] = []

    for p, purposes in joined:
        purpose, is_tie = modal_purpose(purposes)
        if is_tie:
            ties += 1
        if purpose is None:
            continue
        expected = PURPOSE_TO_CATEGORY.get(purpose)
        if expected is None:
            unmapped_purpose += 1
            continue

        actual = p.get('primary_category') or '(none)'
        confusion[actual][expected] += 1

        if actual == expected:
            agree += 1
        else:
            disagree += 1
            record = {
                'project_number': p['project_number'],
                'application_id': p.get('application_id'),
                'title': (p.get('title') or '')[:80],
                'org': (p.get('org_name') or '')[:40],
                'actual_category': actual,
                'expected_category': expected,
                'modal_purpose': purpose,
                'is_tie': is_tie,
                'trial_count': len(purposes),
                'purpose_distribution': dict(Counter(purposes)),
                'confidence': p.get('primary_category_confidence'),
                'funding': p.get('total_cost') or 0,
            }
            disagreements.append(record)
            if len(purposes) == 1:
                single_trial_subset.append(record)
            else:
                multi_trial_subset.append(record)

    n = agree + disagree
    print()
    print('AGREEMENT (project category ↔ expected category from modal trial purpose)')
    print(f'  Agree:              {agree:>7,}  ({100 * agree / max(1, n):.1f}%)')
    print(f'  Disagree:           {disagree:>7,}  ({100 * disagree / max(1, n):.1f}%)')
    print(f'  Ties (modal is tied): {ties:>5,}  (counted in agree/disagree)')
    print(f'  Unmapped purpose:   {unmapped_purpose:>7,}')

    # 5. Confusion matrix.
    all_expected = sorted({e for row in confusion.values() for e in row})
    all_actual = sorted(confusion.keys())

    print()
    print('CONFUSION MATRIX (rows = current primary_category, cols = expected from trials)')
    print(f'{"actual \\ expected":<22}  ' + '  '.join(f'{e:>16}' for e in all_expected) + '  ' + f'{"total":>8}')
    for actual in all_actual:
        row = confusion[actual]
        total = sum(row.values())
        cells = '  '.join(f'{row.get(e, 0):>16,}' for e in all_expected)
        marker = ''
        # Highlight the diagonal (where actual == expected).
        print(f'{actual:<22}  {cells}  {total:>8,}{marker}')

    # 6. Disagreements broken down by trial-signal strength.
    print()
    print('DISAGREEMENT BY SIGNAL STRENGTH')
    print(f'  Single-trial projects (weaker signal): {len(single_trial_subset):>6,}')
    print(f'  Multi-trial projects (stronger):       {len(multi_trial_subset):>6,}')

    # 7. Systematic patterns: (actual, expected) pairs with the most rows.
    print()
    print('TOP SYSTEMATIC DISAGREEMENT PAIRS (multi-trial only)')
    pair_counter: Counter = Counter()
    for d in multi_trial_subset:
        pair_counter[(d['actual_category'], d['expected_category'])] += 1
    print(f'  {"actual → expected":<48} {"count":>7}')
    for (actual, expected), count in pair_counter.most_common(15):
        print(f'  {actual:>18} → {expected:<28} {count:>7,}')

    # 8. "Other → specific" — projects the classifier bucketed as `other` but
    #    trial signal points to a specific category. These are the highest-
    #    confidence classifier misses.
    other_to_specific = [d for d in disagreements
                         if d['actual_category'] == 'other'
                         and d['expected_category'] != 'other']
    print()
    print(f'CLASSIFIER MISSES: primary_category="other" but trial signal → specific category')
    print(f'  Total:        {len(other_to_specific):>6,}')
    other_multi = [d for d in other_to_specific if d['trial_count'] > 1]
    print(f'  Multi-trial:  {len(other_multi):>6,}')

    # 9. High-signal disagreements: sort multi-trial disagreements by
    #    (trial_count DESC, funding DESC) and print top N.
    def _signal_sort_key(d):
        return (-d['trial_count'], -(d['funding'] or 0))

    top_disagreements = sorted(multi_trial_subset, key=_signal_sort_key)[:args.top]

    print()
    print(f'TOP {args.top} HIGH-SIGNAL DISAGREEMENTS (multi-trial, sorted by trial count desc, funding desc)')
    print(f'  {"proj_num":<16} {"actual":<15} {"expected":<15} {"n":>3} {"conf":>5} {"funding":>12}  purposes')
    for d in top_disagreements:
        conf = f"{d['confidence']:.0f}" if d['confidence'] is not None else 'n/a'
        funding = f"${d['funding']/1_000_000:.1f}M" if d['funding'] else '—'
        purposes_str = ', '.join(f"{p}:{c}" for p, c in
                                 sorted(d['purpose_distribution'].items(),
                                        key=lambda x: -x[1]))
        title = d['title']
        print(f"  {d['project_number']:<16} {d['actual_category']:<15} "
              f"{d['expected_category']:<15} {d['trial_count']:>3} {conf:>5} {funding:>12}  {purposes_str}")
        print(f"    {title}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
