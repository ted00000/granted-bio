"""
Import classification results from Claude Max back into the database.

Reads classification_output.csv and updates the projects table with:
- primary_category
- primary_category_confidence
- org_type
"""

import os
import csv
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

# Connect to Supabase
print("=" * 60)
print("IMPORT CLASSIFICATION RESULTS")
print("=" * 60)
print("\nConnecting to Supabase...")
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

# Read classification output
input_file = 'classification_output.csv'
print(f"Reading {input_file}...")

if not os.path.exists(input_file):
    print(f"✗ Error: {input_file} not found!")
    print("  Please run classification in Claude Max first and save as classification_output.csv")
    exit(1)

# Track statistics
total_rows = 0
successful_updates = 0
errors = 0
category_counts = {}
org_type_counts = {}

with open(input_file, 'r', encoding='utf-8') as csvfile:
    reader = csv.DictReader(csvfile)

    print("Importing classifications...\n")

    for row in reader:
        total_rows += 1

        if total_rows % 1000 == 0:
            print(f"  Processed {total_rows:,} rows | Success: {successful_updates:,} | Errors: {errors}", flush=True)

        try:
            app_id = row['application_id']
            primary_category = row['primary_category'].lower()
            category_confidence = float(row['category_confidence'])
            org_type = row['org_type'].lower()

            # Validate category
            valid_categories = ['biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']
            if primary_category not in valid_categories:
                print(f"  Warning: Invalid category '{primary_category}' for {app_id}, using 'other'")
                primary_category = 'other'

            # Validate org_type
            valid_org_types = ['company', 'university', 'hospital', 'research_institute', 'government', 'other']
            if org_type not in valid_org_types:
                print(f"  Warning: Invalid org_type '{org_type}' for {app_id}, using 'other'")
                org_type = 'other'

            # Update database
            result = supabase.table('projects').update({
                'primary_category': primary_category,
                'primary_category_confidence': category_confidence,
                'org_type': org_type
            }).eq('application_id', app_id).execute()

            successful_updates += 1

            # Track statistics
            category_counts[primary_category] = category_counts.get(primary_category, 0) + 1
            org_type_counts[org_type] = org_type_counts.get(org_type, 0) + 1

        except Exception as e:
            errors += 1
            if errors <= 10:  # Only print first 10 errors
                print(f"  Error processing row {total_rows}: {e}")

print(f"\n✓ Import complete!")
print(f"  Total rows processed: {total_rows:,}")
print(f"  Successful updates: {successful_updates:,}")
print(f"  Errors: {errors}")

# Print distribution
print("\n" + "=" * 60)
print("CATEGORY DISTRIBUTION")
print("=" * 60)
for category, count in sorted(category_counts.items(), key=lambda x: x[1], reverse=True):
    percentage = (count / successful_updates * 100) if successful_updates > 0 else 0
    print(f"  {category:20} {count:6,} ({percentage:5.1f}%)")

print("\n" + "=" * 60)
print("ORGANIZATION TYPE DISTRIBUTION")
print("=" * 60)
for org_type, count in sorted(org_type_counts.items(), key=lambda x: x[1], reverse=True):
    percentage = (count / successful_updates * 100) if successful_updates > 0 else 0
    print(f"  {org_type:20} {count:6,} ({percentage:5.1f}%)")

print("\n" + "=" * 60)
print("NEXT STEPS")
print("=" * 60)
print("1. Verify the distributions look reasonable")
print("2. Spot check some projects in the database")
print("3. Test the search filters on the website")
print("=" * 60)
