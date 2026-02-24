"""
Retry failed classification imports.

Compares expected classifications (from CSV files) against actual database values.
Updates any mismatches.
"""

import os
import csv
import glob
import time
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 60)
print("RETRY FAILED CLASSIFICATION IMPORTS")
print("=" * 60)

supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

VALID_CATEGORIES = ['training', 'infrastructure', 'basic_research', 'biotools',
                    'therapeutics', 'diagnostics', 'medical_device', 'digital_health',
                    'other', 'unclassified']

# Load all expected classifications from CSV files
print("Loading expected classifications from CSVs...")
expected = {}

pattern = 'etl/classify_batch_*-v3*_classified.csv'
files = sorted(glob.glob(pattern))

for filepath in files:
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            app_id = row.get('application_id')
            if not app_id:
                continue

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

            if category == 'unclassified':
                category = 'other'

            try:
                confidence = int(float(row.get('category_confidence', 50)))
                confidence = max(0, min(100, confidence))
            except (ValueError, TypeError):
                confidence = 50

            org_type = row.get('org_type', '').lower().strip()
            if org_type not in ['company', 'university', 'hospital', 'research_institute', 'other']:
                org_type = 'other'

            secondary = row.get('secondary_category', '').lower().strip()
            if secondary and secondary not in VALID_CATEGORIES:
                secondary = None
            elif not secondary:
                secondary = None

            expected[int(app_id)] = {
                'primary_category': category,
                'primary_category_confidence': confidence,
                'org_type': org_type,
                'secondary_category': secondary
            }

print(f"✓ Loaded {len(expected):,} expected classifications\n")

# Query database in batches to find mismatches
print("Checking database for mismatches...")
mismatches = []
app_ids = list(expected.keys())
batch_size = 500
checked = 0

for i in range(0, len(app_ids), batch_size):
    batch_ids = app_ids[i:i+batch_size]

    result = supabase.table('projects').select(
        'application_id, primary_category, primary_category_confidence, org_type, secondary_category'
    ).in_('application_id', batch_ids).execute()

    db_records = {r['application_id']: r for r in result.data}

    for app_id in batch_ids:
        exp = expected[app_id]
        actual = db_records.get(app_id)

        if not actual:
            # Project not found in DB at all
            continue

        # Check if classification matches
        if (actual.get('primary_category') != exp['primary_category'] or
            actual.get('primary_category_confidence') != exp['primary_category_confidence'] or
            actual.get('org_type') != exp['org_type'] or
            actual.get('secondary_category') != exp['secondary_category']):
            mismatches.append({
                'application_id': app_id,
                **exp
            })

    checked += len(batch_ids)
    if checked % 5000 == 0:
        print(f"  Checked {checked:,}/{len(app_ids):,}...")

print(f"\n✓ Found {len(mismatches):,} mismatches to fix\n")

if not mismatches:
    print("No mismatches found - all imports succeeded!")
    exit(0)

# Update mismatches one at a time with retry logic
print(f"Updating {len(mismatches):,} records...")

def update_with_retry(update, max_retries=5):
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
                time.sleep(1 * (attempt + 1))  # Longer backoff for retries
                continue
            return False, str(e)
    return False, "Max retries exceeded"

updated = 0
errors = 0
error_ids = []

for i, update in enumerate(mismatches):
    success, error = update_with_retry(update)
    if success:
        updated += 1
    else:
        errors += 1
        error_ids.append(update['application_id'])
        print(f"  Error on {update['application_id']}: {error}")

    if (i + 1) % 100 == 0:
        print(f"  Progress: {i+1:,}/{len(mismatches):,}")

print(f"\n{'=' * 60}")
print("RETRY COMPLETE")
print("=" * 60)
print(f"Updated: {updated:,}")
print(f"Errors: {errors:,}")

if error_ids:
    print(f"\nFailed IDs: {error_ids[:20]}{'...' if len(error_ids) > 20 else ''}")

print("\n✓ Done!")
