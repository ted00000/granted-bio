"""
Export all projects to CSV batches for Claude Max classification.

Creates 40 batch files with ~3,200 projects each.
Uses 3000 char abstracts for better classification accuracy.
"""

import os
import csv
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 60)
print("EXPORT PROJECTS FOR CLASSIFICATION")
print("=" * 60)

# Connect
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

# Get total count
total_result = supabase.table('projects').select('application_id', count='exact').execute()
total_projects = total_result.count
print(f"Total projects: {total_projects:,}")

# Load abstracts
print("\nLoading abstracts...")
abstracts_map = {}
offset = 0
while True:
    response = supabase.table('abstracts').select(
        'application_id, abstract_text'
    ).order('application_id').range(offset, offset + 1000 - 1).execute()

    if not response.data:
        break

    for a in response.data:
        abstracts_map[a['application_id']] = a['abstract_text']

    print(f"  Loaded {len(abstracts_map):,} abstracts...", end='\r')

    if len(response.data) < 1000:
        break
    offset += 1000

print(f"✓ Loaded {len(abstracts_map):,} abstracts\n")

# Fetch all projects
print("Fetching projects...")
all_projects = []
offset = 0
while True:
    response = supabase.table('projects').select(
        'application_id, title, org_name, org_type, primary_category, activity_code, phr, terms'
    ).order('application_id').range(offset, offset + 1000 - 1).execute()

    if not response.data:
        break

    all_projects.extend(response.data)
    print(f"  Fetched {len(all_projects):,} projects...", end='\r')

    if len(response.data) < 1000:
        break
    offset += 1000

print(f"✓ Fetched {len(all_projects):,} projects\n")

# Calculate batch size for 40 batches (doubled for 3000 char abstracts)
NUM_BATCHES = 40
batch_size = (len(all_projects) + NUM_BATCHES - 1) // NUM_BATCHES
print(f"Creating {NUM_BATCHES} batches of ~{batch_size:,} projects each\n")

# Write batches
print("Writing batch files...")
for batch_num in range(NUM_BATCHES):
    start_idx = batch_num * batch_size
    end_idx = min(start_idx + batch_size, len(all_projects))
    batch_projects = all_projects[start_idx:end_idx]

    if not batch_projects:
        break

    filename = f'etl/classify_batch_{batch_num + 1:02d}.csv'

    with open(filename, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['application_id', 'title', 'org_name', 'current_org_type', 'current_category', 'activity_code', 'abstract', 'phr', 'terms'])

        for p in batch_projects:
            app_id = p['application_id']
            abstract = abstracts_map.get(app_id, '') or ''
            phr = p.get('phr') or ''
            terms = p.get('terms') or ''

            writer.writerow([
                app_id,
                p.get('title') or '',
                p.get('org_name') or '',
                p.get('org_type') or '',
                p.get('primary_category') or '',
                p.get('activity_code') or '',
                abstract[:3000],  # Doubled for better classification
                phr[:500],
                terms[:300]
            ])

    print(f"  ✓ {filename} ({len(batch_projects):,} projects)")

print(f"\n{'=' * 60}")
print("EXPORT COMPLETE")
print("=" * 60)
print(f"Total: {len(all_projects):,} projects in {NUM_BATCHES} batches")
print(f"\nFiles created: etl/classify_batch_01.csv through classify_batch_{NUM_BATCHES:02d}.csv")
print("\nNext steps:")
print("1. Upload each batch to Claude Max with the classification prompt")
print("2. Save output as classify_output_XX.csv")
print("3. Run import script to update database")
