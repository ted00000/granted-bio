#!/usr/bin/env python3
"""
Update Supabase database with final classification results.
"""
import csv
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv('../.env.local')

from supabase import create_client

SUPABASE_URL = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPABASE_KEY = os.environ['SUPABASE_SERVICE_KEY']
INPUT_FILE = 'final_classifications.csv'
BATCH_SIZE = 500

def update_database():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    total = 0
    updated = 0
    errors = 0

    with open(INPUT_FILE, 'r') as f:
        reader = csv.DictReader(f)
        batch = []

        for row in reader:
            total += 1

            update_data = {
                'primary_category': row['primary_category'],
                'primary_category_confidence': int(row['category_confidence']) if row['category_confidence'] else None,
                'org_type': row['org_type'] if row['org_type'] else None
            }

            # Add secondary category if present
            if row['secondary_category']:
                update_data['secondary_category'] = row['secondary_category']

            batch.append({
                'application_id': int(row['application_id']),
                'update_data': update_data
            })

            if len(batch) >= BATCH_SIZE:
                # Process batch
                for item in batch:
                    try:
                        supabase.table('projects').update(
                            item['update_data']
                        ).eq('application_id', item['application_id']).execute()
                        updated += 1
                    except Exception as e:
                        errors += 1
                        if errors <= 10:
                            print(f"Error updating {item['application_id']}: {e}")

                print(f"Progress: {total:,} processed, {updated:,} updated, {errors:,} errors")
                batch = []

        # Process remaining
        for item in batch:
            try:
                supabase.table('projects').update(
                    item['update_data']
                ).eq('application_id', item['application_id']).execute()
                updated += 1
            except Exception as e:
                errors += 1

    print(f"\nComplete:")
    print(f"  Total: {total:,}")
    print(f"  Updated: {updated:,}")
    print(f"  Errors: {errors:,}")

if __name__ == '__main__':
    os.chdir(Path(__file__).parent)
    update_database()
