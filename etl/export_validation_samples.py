#!/usr/bin/env python3
"""
Export random samples from each category for manual validation/labeling.
Creates a CSV file for human review.
"""

import os
import sys
import csv
import random
from datetime import datetime
from dotenv import load_dotenv

sys.stdout.reconfigure(line_buffering=True)

load_dotenv('../.env.local')

from supabase import create_client

# Sample sizes per category
SAMPLE_SIZES = {
    'basic_research': 100,
    'therapeutics': 100,
    'biotools': 50,
    'diagnostics': 50,
    'medical_device': 30,
    'digital_health': 30,
    'other': 50,
    'training': 50,
    'infrastructure': 50
}


def get_supabase_client():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    return create_client(url, key)


def main():
    print("=" * 60)
    print("EXPORT VALIDATION SAMPLES")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    supabase = get_supabase_client()
    print("Connected to Supabase\n")

    # Create validation directory
    os.makedirs('validation', exist_ok=True)

    all_samples = []

    for category, target_size in SAMPLE_SIZES.items():
        print(f"Sampling {category} (target: {target_size})...")

        # Get project IDs for this category
        result = supabase.table('projects').select(
            'application_id'
        ).eq('primary_category', category).limit(1000).execute()

        if not result.data:
            print(f"  No projects found for {category}")
            continue

        # Random sample
        app_ids = [p['application_id'] for p in result.data]
        sample_ids = random.sample(app_ids, min(target_size, len(app_ids)))

        print(f"  Selected {len(sample_ids)} projects")

        # Fetch full details + abstracts for sampled projects
        for app_id in sample_ids:
            # Get project
            proj = supabase.table('projects').select(
                'application_id, title, org_name, activity_code, primary_category, primary_category_confidence'
            ).eq('application_id', app_id).single().execute()

            # Get abstract
            abs_result = supabase.table('abstracts').select(
                'abstract_text'
            ).eq('application_id', app_id).execute()

            abstract = ''
            if abs_result.data:
                abstract = abs_result.data[0].get('abstract_text', '') or ''

            all_samples.append({
                'application_id': proj.data['application_id'],
                'title': proj.data.get('title', ''),
                'org_name': proj.data.get('org_name', ''),
                'activity_code': proj.data.get('activity_code', ''),
                'abstract': abstract[:2000],  # Truncate for readability
                'current_category': proj.data.get('primary_category', ''),
                'current_confidence': proj.data.get('primary_category_confidence', ''),
                'gold_category': '',  # To be filled by human
                'gold_notes': ''  # To be filled by human
            })

    # Shuffle all samples so categories are mixed
    random.shuffle(all_samples)

    # Write to CSV
    output_file = 'validation/samples_to_label.csv'
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'application_id', 'title', 'org_name', 'activity_code',
            'abstract', 'current_category', 'current_confidence',
            'gold_category', 'gold_notes'
        ])
        writer.writeheader()
        writer.writerows(all_samples)

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print("=" * 60)
    print(f"Total samples: {len(all_samples)}")
    print(f"Output file: {output_file}")
    print()
    print("Next steps:")
    print("1. Open the CSV in a spreadsheet")
    print("2. For each row, fill in 'gold_category' with the correct category")
    print("3. Add any notes in 'gold_notes' (optional)")
    print("4. Save and run validate_classifier.py")


if __name__ == '__main__':
    main()
