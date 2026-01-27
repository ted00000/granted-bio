"""
Export projects to CSV for classification via Claude Max.

Exports all projects with their abstracts to a CSV file that can be
uploaded to Claude.com for manual classification.
"""

import os
import csv
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

# Connect to Supabase
print("=" * 60)
print("EXPORT PROJECTS FOR CLASSIFICATION")
print("=" * 60)
print("\nConnecting to Supabase...")
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

# Count total projects
total_response = supabase.table('projects').select('application_id', count='exact').execute()
total_projects = total_response.count
print(f"Total projects to export: {total_projects:,}\n")

# Fetch all abstracts first (more efficient)
print("Fetching abstracts...")
abstracts_response = supabase.table('abstracts').select('application_id, abstract_text').limit(100000).execute()
abstracts_map = {a['application_id']: a['abstract_text'] for a in abstracts_response.data}
print(f"✓ Loaded {len(abstracts_map):,} abstracts\n")

# Open CSV file for writing
output_file = 'classification_input.csv'
print(f"Writing to {output_file}...")

with open(output_file, 'w', newline='', encoding='utf-8') as csvfile:
    writer = csv.writer(csvfile)

    # Write header
    writer.writerow(['application_id', 'title', 'org_name', 'abstract', 'phr', 'terms'])

    # Fetch projects in batches and write to CSV
    offset = 0
    batch_size = 1000
    total_exported = 0

    while True:
        # Fetch batch
        response = supabase.table('projects').select(
            'application_id, title, org_name, phr, terms'
        ).range(offset, offset + batch_size - 1).execute()

        projects = response.data
        if not projects:
            break

        # Write each project
        for project in projects:
            app_id = project['application_id']
            abstract = abstracts_map.get(app_id, '')

            writer.writerow([
                app_id,
                project.get('title', ''),
                project.get('org_name', ''),
                abstract,
                project.get('phr', ''),
                project.get('terms', '')
            ])
            total_exported += 1

        print(f"  Exported {total_exported:,} / {total_projects:,} projects", flush=True)

        if len(projects) < batch_size:
            break

        offset += batch_size

print(f"\n✓ Export complete!")
print(f"  Total exported: {total_exported:,} projects")
print(f"  Output file: {output_file}")
print(f"  File size: {os.path.getsize(output_file) / 1024 / 1024:.1f} MB")
print("\n" + "=" * 60)
print("NEXT STEPS")
print("=" * 60)
print("1. Upload classification_input.csv to Claude.com Projects")
print("2. Use the classification prompt from the plan")
print("3. Download the results as classification_output.csv")
print("4. Run: python3 etl/import_classifications.py")
print("=" * 60)
