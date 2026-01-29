"""
Find and export any projects that are still unclassified after import.

This script:
1. Queries the database for projects with NULL primary_category
2. Exports them to a CSV for classification via Claude Max
"""

import os
import csv
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

# Connect to Supabase
print("=" * 60)
print("FIND UNCLASSIFIED PROJECTS")
print("=" * 60)
print("\nConnecting to Supabase...")
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

# Find unclassified projects (without slow count queries)
print("Finding unclassified projects...")

# Fetch unclassified projects directly
unclassified_projects = []
offset = 0
batch_size = 1000

while True:
    response = supabase.table('projects').select(
        'application_id, title, org_name, phr'
    ).is_('primary_category', 'null').range(offset, offset + batch_size - 1).execute()

    if not response.data:
        break

    unclassified_projects.extend(response.data)
    offset += batch_size

    if len(response.data) < batch_size:
        break

print(f"  Found {len(unclassified_projects):,} unclassified projects")

if len(unclassified_projects) == 0:
    print("\n✓ All projects are classified!")
    exit(0)

print(f"\nExporting {len(unclassified_projects):,} unclassified projects...")

# Fetch all abstracts first
print("  Fetching abstracts...")
abstracts_response = supabase.table('abstracts').select('application_id, abstract_text').limit(100000).execute()
abstracts_map = {a['application_id']: a['abstract_text'] for a in abstracts_response.data}
print(f"  ✓ Loaded {len(abstracts_map):,} abstracts")

# Export unclassified projects
output_file = 'etl/classification_batches/unclassified_batch.csv'
print(f"  Writing to {output_file}...")

with open(output_file, 'w', newline='', encoding='utf-8') as csvfile:
    writer = csv.writer(csvfile)
    writer.writerow(['application_id', 'title', 'org_name', 'phr', 'abstract'])

    total_exported = 0

    for project in unclassified_projects:
        app_id = project['application_id']
        abstract = abstracts_map.get(app_id, '')

        writer.writerow([
            app_id,
            project.get('title', ''),
            project.get('org_name', ''),
            project.get('phr', ''),
            abstract
        ])
        total_exported += 1

        if total_exported % 1000 == 0:
            print(f"    Exported {total_exported:,} / {len(unclassified_projects):,}", flush=True)

print(f"\n✓ Export complete!")
print(f"  Total exported: {total_exported:,} projects")
print(f"  Output file: {output_file}")
print(f"  File size: {os.path.getsize(output_file) / 1024:.1f} KB")
print("\n" + "=" * 60)
print("NEXT STEPS")
print("=" * 60)
print("1. Upload unclassified_batch.csv to Claude.com Projects")
print("2. Use the v3 classification prompt")
print("3. Save results as unclassified_batch_categorized.csv")
print("4. Run: python3 etl/import_classifications.py")
print("=" * 60)
