"""
Fast import of classifications using concurrent updates.
Uses threading for parallel API calls - ~10x faster.
"""

import os
import csv
import glob
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 60)
print("FAST IMPORT CLASSIFICATIONS (CONCURRENT)")
print("=" * 60)
sys.stdout.flush()

supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")
sys.stdout.flush()

VALID_CATEGORIES = ['training', 'infrastructure', 'basic_research', 'biotools',
                    'therapeutics', 'diagnostics', 'medical_device', 'digital_health',
                    'other', 'unclassified']
VALID_ORG_TYPES = ['company', 'university', 'hospital', 'research_institute', 'other']

pattern = 'etl/classify_batch_*-v3*_classified.csv'
files = sorted(glob.glob(pattern))

if not files:
    print(f"No files found matching: {pattern}")
    exit(1)

print(f"Found {len(files)} classified batch files\n")

# Process all files and collect updates
all_updates = []
by_category = {}

for filepath in files:
    filename = os.path.basename(filepath)

    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        for row in reader:
            app_id = row.get('application_id')
            if not app_id:
                continue

            # Get and validate category
            category = row.get('primary_category', '').lower().strip()
            if category not in VALID_CATEGORIES:
                category_map = {
                    'basic research': 'basic_research',
                    'medical device': 'medical_device',
                    'digital health': 'digital_health',
                    'research_tools': 'biotools',
                    'research tools': 'biotools',
                }
                category = category_map.get(category, 'other')

            # Handle unclassified
            if category == 'unclassified':
                category = 'other'

            # Get confidence
            try:
                confidence = int(float(row.get('category_confidence', 50)))
                confidence = max(0, min(100, confidence))
            except (ValueError, TypeError):
                confidence = 50

            # Get org_type
            org_type = row.get('org_type', '').lower().strip()
            if org_type not in VALID_ORG_TYPES:
                org_type = 'other'

            # Get secondary category
            secondary = row.get('secondary_category', '').lower().strip()
            if secondary and secondary not in VALID_CATEGORIES:
                secondary = None
            elif not secondary:
                secondary = None

            all_updates.append({
                'application_id': int(app_id),
                'primary_category': category,
                'primary_category_confidence': confidence,
                'org_type': org_type,
                'secondary_category': secondary
            })

            by_category[category] = by_category.get(category, 0) + 1

    print(f"  Loaded {filename}")

print(f"\n✓ Loaded {len(all_updates):,} updates\n")

# Concurrent update function with retry
import time

def update_project(update, max_retries=3):
    for attempt in range(max_retries):
        try:
            supabase.table('projects').update({
                'primary_category': update['primary_category'],
                'primary_category_confidence': update['primary_category_confidence'],
                'org_type': update['org_type'],
                'secondary_category': update['secondary_category']
            }).eq('application_id', update['application_id']).execute()
            return True, None
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(0.5 * (attempt + 1))  # Exponential backoff
                continue
            return False, str(e)
    return False, "Max retries exceeded"

# Use 10 concurrent threads (reduced from 20 to avoid server disconnects)
NUM_WORKERS = 10
total_updated = 0
total_errors = 0

print(f"Importing to database with {NUM_WORKERS} concurrent workers...")
sys.stdout.flush()

with ThreadPoolExecutor(max_workers=NUM_WORKERS) as executor:
    futures = {executor.submit(update_project, u): u for u in all_updates}

    for i, future in enumerate(as_completed(futures)):
        success, error = future.result()
        if success:
            total_updated += 1
        else:
            total_errors += 1
            if total_errors <= 5:
                print(f"  Error: {error}")

        if (i + 1) % 1000 == 0:
            print(f"  Progress: {i+1:,}/{len(all_updates):,} ({100*(i+1)/len(all_updates):.1f}%)")
            sys.stdout.flush()

print(f"\n\n{'=' * 60}")
print("IMPORT COMPLETE")
print("=" * 60)
print(f"Total updated: {total_updated:,}")
print(f"Total errors: {total_errors:,}")

print("\nBy category:")
for cat in sorted(by_category.keys(), key=lambda x: -by_category[x]):
    print(f"  {cat:20} {by_category[cat]:>6,}")

# Verify final distribution
print(f"\n{'=' * 60}")
print("FINAL DATABASE DISTRIBUTION")
print("=" * 60)

for cat in ['training', 'infrastructure', 'basic_research', 'biotools',
            'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']:
    result = supabase.table('projects').select('application_id', count='exact').eq('primary_category', cat).execute()
    print(f"  {cat:20} {result.count:>6,}")

result = supabase.table('projects').select('application_id', count='exact').not_.is_('secondary_category', 'null').execute()
print(f"\nProjects with secondary category: {result.count:,}")

print("\n✓ Done!")
