#!/usr/bin/env python3
"""
Fix projects that were incorrectly changed to 'other' by the faulty reclassification.
Re-classifies projects in 'other' that don't have 'other' signals but have clear
signals for other categories.
"""

import os
import sys
from datetime import datetime
from collections import Counter
from dotenv import load_dotenv

sys.stdout.reconfigure(line_buffering=True)

load_dotenv('../.env.local')

from supabase import create_client
from classify_from_database import classify_project

def get_supabase_client():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    return create_client(url, key)


# Signals that truly indicate "other" category
OTHER_SIGNALS = [
    'disparit', 'equity', 'implementation science', 'behavioral intervention',
    'smoking cessation', 'weight management', 'lifestyle', 'cohort study',
    'epidemiolog', 'community health', 'health services', 'health policy',
    'quality improvement', 'cost-effectiveness', 'occupational', 'food safety',
    'environmental health', 'violence prevention', 'injury prevention',
    'psychosocial', 'mindfulness', 'cognitive behavioral therapy', 'peer support'
]

# Signals that indicate this should NOT be "other"
NOT_OTHER_SIGNALS = {
    'basic_research': [
        'mechanism', 'pathway', 'signaling', 'regulation', 'molecular',
        'genetic', 'cellular', 'neural', 'protein', 'gene expression',
        'transcription', 'receptor', 'kinase', 'epigenetic', 'chromatin'
    ],
    'therapeutics': [
        'drug', 'therapy', 'treatment', 'clinical trial', 'therapeutic',
        'vaccine', 'inhibitor', 'car-t', 'gene therapy', 'cell therapy'
    ],
    'biotools': [
        'platform for', 'tool for', 'method for', 'pipeline for', 'assay for',
        'database', 'atlas', 'high-throughput', 'software for'
    ],
    'diagnostics': [
        'diagnostic', 'detection', 'screening', 'biomarker', 'liquid biopsy'
    ]
}


def should_not_be_other(title: str, abstract: str) -> str:
    """Check if a project in 'other' should actually be a different category."""
    text = (title + ' ' + abstract).lower()
    t = title.lower()

    # First check if it has true "other" signals
    if any(sig in text for sig in OTHER_SIGNALS):
        return None  # It's correctly "other"

    # Check for signals of other categories
    for category, signals in NOT_OTHER_SIGNALS.items():
        if any(sig in text for sig in signals):
            # Extra check: title should also support this category
            if any(sig in t for sig in signals[:5]):  # Check first 5 strongest signals
                return category

    return None


def main():
    print("=" * 60)
    print("FIX PROJECTS INCORRECTLY CHANGED TO 'OTHER'")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    supabase = get_supabase_client()
    print("Connected to Supabase\n")

    # Load abstracts for 'other' projects
    print("Loading 'other' projects and their abstracts...")

    offset = 0
    batch_size = 1000
    other_projects = []

    while True:
        result = supabase.table('projects').select(
            'application_id, title, org_name, activity_code, phr, primary_category_confidence'
        ).eq('primary_category', 'other'
        ).range(offset, offset + batch_size - 1).execute()

        if not result.data:
            break
        other_projects.extend(result.data)
        offset += batch_size
        if len(result.data) < batch_size:
            break

    print(f"Found {len(other_projects):,} 'other' projects")

    # Load abstracts
    app_ids = [p['application_id'] for p in other_projects]
    abstracts_map = {}

    for i in range(0, len(app_ids), 1000):
        batch_ids = app_ids[i:i+1000]
        result = supabase.table('abstracts').select(
            'application_id, abstract_text'
        ).in_('application_id', batch_ids).execute()
        for a in result.data:
            abstracts_map[a['application_id']] = a['abstract_text'] or ''

    print(f"Loaded {len(abstracts_map):,} abstracts")

    # Check which projects should be reclassified
    print("\nAnalyzing projects...")

    reclassify = []
    category_counts = Counter()

    for p in other_projects:
        app_id = p['application_id']
        title = p.get('title', '') or ''
        abstract = abstracts_map.get(app_id, '')

        new_category = should_not_be_other(title, abstract)
        if new_category:
            # Double-check with full classifier
            full_result = classify_project(p, abstract)
            if full_result['primary_category'] != 'other' and full_result['category_confidence'] >= 75:
                reclassify.append({
                    'application_id': app_id,
                    'new_category': full_result['primary_category'],
                    'confidence': full_result['category_confidence'],
                    'org_type': full_result['org_type']
                })
                category_counts[full_result['primary_category']] += 1

    print(f"\nFound {len(reclassify):,} projects to fix")
    if category_counts:
        print("Breakdown:")
        for cat, count in category_counts.most_common():
            print(f"  other -> {cat}: {count:,}")

    # Apply fixes
    if reclassify:
        print(f"\n{'=' * 60}")
        print("APPLYING FIXES")
        print("=" * 60)

        fixed = 0
        errors = 0

        for r in reclassify:
            try:
                supabase.table('projects').update({
                    'primary_category': r['new_category'],
                    'primary_category_confidence': r['confidence'],
                    'org_type': r['org_type']
                }).eq('application_id', r['application_id']).execute()
                fixed += 1
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  Error: {str(e)[:50]}")

            if fixed % 100 == 0 and fixed > 0:
                print(f"  Fixed {fixed:,}/{len(reclassify):,}", flush=True)

        print(f"\nFixed: {fixed:,}, Errors: {errors}")

    # Final verification
    print(f"\n{'=' * 60}")
    print("VERIFICATION")
    print("=" * 60)

    for cat in ['basic_research', 'therapeutics', 'biotools', 'other']:
        result = supabase.table('projects').select('id', count='exact').eq('primary_category', cat).execute()
        print(f"  {cat}: {result.count:,}")

    total = supabase.table('projects').select('id', count='exact').execute()
    high_conf = supabase.table('projects').select('id', count='exact').gte('primary_category_confidence', 80).execute()
    pct = 100 * high_conf.count / total.count if total.count else 0
    print(f"\n>= 80% confidence: {high_conf.count:,} ({pct:.1f}%)")

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == '__main__':
    main()
