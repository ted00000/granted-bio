"""
Merge classified batch files and update database with primary_category.
"""

import os
import csv
import glob
import sys
from dotenv import load_dotenv

load_dotenv('.env.local')

from supabase import create_client

def get_supabase_client():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not url or not key:
        raise ValueError("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY")
    return create_client(url, key)

def main():
    batch_dir = 'etl/classification_batches_2024'
    pattern = os.path.join(batch_dir, '*_classified.csv')
    files = sorted(glob.glob(pattern))

    print(f"Found {len(files)} classified batch files", flush=True)

    # Merge all classifications
    classifications = {}
    for filepath in files:
        batch_name = os.path.basename(filepath)
        count = 0
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                app_id = row.get('application_id')
                category = row.get('primary_category')
                if app_id and category:
                    classifications[app_id] = category
                    count += 1
        print(f"  {batch_name}: {count} records", flush=True)

    print(f"\nTotal classifications: {len(classifications)}", flush=True)

    # Count by category
    category_counts = {}
    for cat in classifications.values():
        category_counts[cat] = category_counts.get(cat, 0) + 1

    print("\nCategory breakdown:", flush=True)
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        pct = 100 * count / len(classifications)
        print(f"  {cat}: {count:,} ({pct:.1f}%)", flush=True)

    # Update database
    print("\n" + "=" * 60, flush=True)
    print("UPDATING DATABASE", flush=True)
    print("=" * 60, flush=True)

    supabase = get_supabase_client()

    # Update each record individually (UPDATE not UPSERT)
    total_updated = 0
    errors = 0
    app_ids = list(classifications.keys())

    for i, app_id in enumerate(app_ids):
        try:
            supabase.table('projects').update({
                'primary_category': classifications[app_id]
            }).eq('application_id', app_id).execute()
            total_updated += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Error updating {app_id}: {str(e)[:80]}", flush=True)

        if (i + 1) % 5000 == 0 or i + 1 == len(app_ids):
            print(f"  Updated {total_updated:,} / {len(classifications):,} projects...", flush=True)

    print(f"\nComplete!", flush=True)
    print(f"  Updated: {total_updated:,}", flush=True)
    print(f"  Errors: {errors}", flush=True)

if __name__ == '__main__':
    main()
