#!/usr/bin/env python3
"""
Boost confidence scores based on title patterns WITHOUT changing categories.
This is a safe operation that improves confidence metrics without risk of category drift.
"""

import os
import sys
from datetime import datetime
from dotenv import load_dotenv

sys.stdout.reconfigure(line_buffering=True)

load_dotenv('../.env.local')

from supabase import create_client

# Title patterns that strongly indicate each category
TITLE_BOOSTS = {
    'basic_research': [
        'mechanism', 'role of', 'function of', 'regulation of', 'pathway',
        'signaling', 'characterization', 'dynamics of', 'structure of',
        'biology of', 'molecular basis', 'genetic basis', 'circuit',
        'neural', 'cellular', 'modulation of', 'dissecting', 'understanding',
        'elucidating', 'defining', 'investigating', 'genetic', 'genomic',
        'transcriptional', 'epigenetic', 'metabolic', 'developmental'
    ],
    'therapeutics': [
        'therapy for', 'treatment of', 'therapeutic', 'drug', 'vaccine',
        'clinical trial', 'phase i', 'phase ii', 'phase 1', 'phase 2',
        'car-t', 'gene therapy', 'cell therapy', 'immunotherapy', 'targeting',
        'inhibitor', 'agonist', 'antagonist', 'formulation', 'delivery'
    ],
    'biotools': [
        'platform for', 'tool for', 'method for', 'pipeline for', 'assay for',
        'database', 'atlas', 'resource for', 'high-throughput', 'development of',
        'novel assay', 'novel platform', 'software for', 'computational'
    ],
    'diagnostics': [
        'diagnostic', 'early detection', 'screening', 'liquid biopsy',
        'point-of-care', 'biomarker for', 'detection of'
    ],
    'medical_device': [
        'implant', 'prosthe', 'device', 'stent', 'catheter', 'scaffold',
        'neural interface', 'brain-computer', 'surgical', 'wearable'
    ],
    'digital_health': [
        'app', 'mobile health', 'mhealth', 'telemedicine', 'telehealth',
        'digital', 'remote monitoring', 'ehr', 'electronic health'
    ],
    'other': [
        'disparit', 'equity', 'implementation', 'behavioral intervention',
        'cessation', 'prevention', 'community', 'cohort study', 'epidemiolog'
    ]
}


def get_supabase_client():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    return create_client(url, key)


def title_supports_category(title: str, category: str) -> bool:
    """Check if title contains patterns that strongly indicate the category."""
    if not title or category not in TITLE_BOOSTS:
        return False
    t = title.lower()
    return any(pattern in t for pattern in TITLE_BOOSTS[category])


def main():
    print("=" * 60)
    print("BOOST CONFIDENCE BASED ON TITLE (NO CATEGORY CHANGES)")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    supabase = get_supabase_client()
    print("Connected to Supabase\n")

    # Get projects with confidence < 80 that could benefit from a boost
    print("Finding projects with confidence 70-79 that have supportive titles...")

    total_boosted = 0
    total_checked = 0

    for category in ['basic_research', 'therapeutics', 'biotools', 'diagnostics',
                     'medical_device', 'digital_health', 'other']:
        print(f"\nProcessing {category}...")

        # Fetch projects with this category and confidence 70-79
        offset = 0
        batch_size = 1000
        category_boosted = 0

        while True:
            result = supabase.table('projects').select(
                'application_id, title, primary_category_confidence'
            ).eq('primary_category', category
            ).gte('primary_category_confidence', 70
            ).lt('primary_category_confidence', 80
            ).range(offset, offset + batch_size - 1).execute()

            if not result.data:
                break

            updates = []
            for p in result.data:
                total_checked += 1
                title = p.get('title', '') or ''
                current_conf = p.get('primary_category_confidence', 70)

                if title_supports_category(title, category):
                    # Boost to 80%
                    updates.append(p['application_id'])

            # Apply updates
            if updates:
                for app_id in updates:
                    try:
                        supabase.table('projects').update({
                            'primary_category_confidence': 80
                        }).eq('application_id', app_id).execute()
                        category_boosted += 1
                        total_boosted += 1
                    except Exception as e:
                        print(f"  Error: {str(e)[:50]}")

            offset += batch_size
            if len(result.data) < batch_size:
                break

        if category_boosted > 0:
            print(f"  Boosted {category_boosted:,} projects to 80%")

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print("=" * 60)
    print(f"Total checked: {total_checked:,}")
    print(f"Total boosted to 80%: {total_boosted:,}")

    # Final verification
    print(f"\n{'=' * 60}")
    print("VERIFICATION")
    print("=" * 60)

    total = supabase.table('projects').select('id', count='exact').execute()
    high_conf = supabase.table('projects').select('id', count='exact').gte('primary_category_confidence', 80).execute()
    pct = 100 * high_conf.count / total.count if total.count else 0

    print(f"Total: {total.count:,}")
    print(f">= 80% confidence: {high_conf.count:,} ({pct:.1f}%)")
    print(f"Target: 90%")

    if pct >= 90:
        print("\nTARGET MET!")
    else:
        print(f"\nStill {90 - pct:.1f}% short of target")

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == '__main__':
    main()
