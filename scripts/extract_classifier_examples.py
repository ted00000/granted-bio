"""
Extract few-shot examples for the classifier prompt from
etl/category_disagreements_clean.json.

For each high-volume "from → to" disambiguation boundary, pull the top N
highest-confidence corrections to use as worked examples in the prompt.

Output format matches the few-shot block we'd embed verbatim in the
classifier prompt. Run once when refreshing the prompt; not part of the
production pipeline.

Usage:
    python3 scripts/extract_classifier_examples.py

Outputs to stdout.
"""

import json
from collections import defaultdict


DISAGREEMENTS_PATH = 'etl/category_disagreements_clean.json'

# Boundaries to cover, in priority order. (from_category, to_category, label).
# These are picked from category_disagreements_clean.json's summary as the
# highest-volume buckets — where the original classifier was wrong most often.
BOUNDARIES = [
    ('therapeutics', 'basic_research', 'therapeutics → basic_research'),
    ('therapeutics', 'biotools', 'therapeutics → biotools'),
    ('biotools', 'basic_research', 'biotools → basic_research'),
    ('biotools', 'infrastructure', 'biotools → infrastructure'),
    ('basic_research', 'biotools', 'basic_research → biotools'),
    ('basic_research', 'therapeutics', 'basic_research → therapeutics'),
    ('digital_health', 'biotools', 'digital_health → biotools'),
    ('diagnostics', 'basic_research', 'diagnostics → basic_research'),
]

EXAMPLES_PER_BOUNDARY = 2


def main():
    with open(DISAGREEMENTS_PATH) as f:
        data = json.load(f)

    disagreements = data['disagreements']
    print(f'# Few-shot example extraction', flush=True)
    print(f'# Source: {DISAGREEMENTS_PATH}', flush=True)
    print(f'# Total disagreements available: {len(disagreements):,}', flush=True)
    print(f'# Boundaries × examples each: {len(BOUNDARIES)} × {EXAMPLES_PER_BOUNDARY}', flush=True)
    print()

    grouped = defaultdict(list)
    for d in disagreements:
        key = (d.get('current_category'), d.get('primary_category'))
        grouped[key].append(d)

    print('## Per-boundary counts in the disagreement data\n', flush=True)
    for from_cat, to_cat, label in BOUNDARIES:
        items = grouped.get((from_cat, to_cat), [])
        # Sort by confidence descending — pick the model's most confident corrections
        items_sorted = sorted(items, key=lambda x: x.get('category_confidence', 0), reverse=True)
        print(f'  {label}: {len(items)} total', flush=True)

    print()
    print('## Few-shot examples (paste into classifier prompt)\n', flush=True)
    print('Examples below are real NIH grants where an earlier classifier was wrong.', flush=True)
    print('The CLASSIFICATION shown is the corrected ground truth from manual review.\n', flush=True)

    for from_cat, to_cat, label in BOUNDARIES:
        items = grouped.get((from_cat, to_cat), [])
        items_sorted = sorted(items, key=lambda x: x.get('category_confidence', 0), reverse=True)
        chosen = items_sorted[:EXAMPLES_PER_BOUNDARY]
        if not chosen:
            continue

        print(f'### Boundary: {label}\n', flush=True)
        for ex in chosen:
            title = (ex.get('title') or '').strip()
            org = (ex.get('org_name') or '').strip()
            activity = (ex.get('activity_code') or '').strip()
            corrected = ex.get('primary_category')
            confidence = ex.get('category_confidence')
            reasoning = (ex.get('reasoning') or '').strip()

            print('PROJECT:')
            print(f'  title: "{title}"')
            print(f'  org: {org}')
            print(f'  activity: {activity}')
            print()
            print('ANALYSIS:')
            print(f'  {reasoning}')
            print()
            print(f'CLASSIFICATION: {corrected} (confidence {int(confidence) if confidence else 90})')
            print()
            print('---')
            print()


if __name__ == '__main__':
    main()
