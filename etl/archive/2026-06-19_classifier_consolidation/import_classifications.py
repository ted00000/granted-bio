"""
Import classified batches from Opus classifier back to database.

Reads classify_batch_##-v3_classified.csv files and updates projects table.
Expected columns: application_id, primary_category, category_confidence, secondary_category, org_type

NOTE: Requires 'secondary_category' column in projects table.
Run this SQL first if column doesn't exist:
  ALTER TABLE projects ADD COLUMN secondary_category TEXT;
"""

import os
import csv
import glob
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 60)
print("IMPORT CLASSIFICATIONS (OPUS v4)")
print("=" * 60)

# Connect
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

# Valid values
VALID_CATEGORIES = ['training', 'infrastructure', 'basic_research', 'biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other', 'unclassified']
VALID_ORG_TYPES = ['company', 'university', 'hospital', 'research_institute', 'other']

# Find classified batch files (v3 format)
pattern = 'etl/classify_batch_*-v3*_classified.csv'
files = sorted(glob.glob(pattern))

if not files:
    print(f"No files found matching: {pattern}")
    print("Expected files like: classify_batch_01_classified.csv")
    exit(1)

print(f"Found {len(files)} classified batch files:\n")
for f in files:
    print(f"  {f}")

print("\n" + "-" * 60)
print("IMPORTING...")
print("-" * 60)

total_updated = 0
total_skipped = 0
total_errors = 0
by_category = {}

for filepath in files:
    filename = os.path.basename(filepath)
    file_updated = 0
    file_skipped = 0
    file_errors = 0

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)

            for row in reader:
                app_id = row.get('application_id')
                if not app_id:
                    file_skipped += 1
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

                # Handle unclassified - keep as 'other' with 0 confidence
                if category == 'unclassified':
                    category = 'other'

                # Get and validate confidence
                try:
                    confidence = float(row.get('category_confidence', 50))
                    confidence = max(0, min(100, confidence))
                except (ValueError, TypeError):
                    confidence = 50

                # Get and validate org_type
                org_type = row.get('org_type', '').lower().strip()
                if org_type not in VALID_ORG_TYPES:
                    org_type_map = {
                        'research institute': 'research_institute',
                    }
                    org_type = org_type_map.get(org_type, 'other')

                # Get secondary category (optional)
                secondary = row.get('secondary_category', '').lower().strip()
                if secondary and secondary not in VALID_CATEGORIES:
                    secondary = ''  # Clear invalid secondary categories

                # Update database
                try:
                    update_data = {
                        'primary_category': category,
                        'primary_category_confidence': confidence,
                        'org_type': org_type,
                        'secondary_category': secondary if secondary else None,
                    }
                    supabase.table('projects').update(update_data).eq('application_id', int(app_id)).execute()

                    file_updated += 1
                    by_category[category] = by_category.get(category, 0) + 1

                except Exception as e:
                    file_errors += 1
                    if file_errors <= 3:
                        print(f"    Error updating {app_id}: {e}")

        print(f"  {filename}: {file_updated:,} updated, {file_skipped} skipped, {file_errors} errors")
        total_updated += file_updated
        total_skipped += file_skipped
        total_errors += file_errors

    except Exception as e:
        print(f"  {filename}: ERROR reading file - {e}")
        total_errors += 1

print("\n" + "=" * 60)
print("IMPORT COMPLETE")
print("=" * 60)
print(f"Total updated: {total_updated:,}")
print(f"Total skipped: {total_skipped:,}")
print(f"Total errors: {total_errors:,}")

print("\nBy category (from imported files):")
for cat in sorted(by_category.keys(), key=lambda x: -by_category[x]):
    print(f"  {cat:20} {by_category[cat]:>6,}")

# Verify final distribution
print("\n" + "=" * 60)
print("FINAL DATABASE DISTRIBUTION")
print("=" * 60)

display_categories = ['training', 'infrastructure', 'basic_research', 'biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']
for cat in display_categories:
    result = supabase.table('projects').select('application_id', count='exact').eq('primary_category', cat).execute()
    print(f"  {cat:20} {result.count:>6,}")

# Count projects with secondary categories
print("\n" + "=" * 60)
print("SECONDARY CATEGORY COUNTS")
print("=" * 60)

result = supabase.table('projects').select('application_id', count='exact').neq('secondary_category', None).execute()
print(f"  Projects with secondary category: {result.count:,}")

print("\n✓ Done!")
