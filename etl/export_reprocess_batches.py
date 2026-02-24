"""
Export low-confidence projects for reprocessing with longer abstracts.

Reads application_ids from reprocess_under_80_confidence.csv and exports
to batch files with doubled abstract length (3000 chars instead of 1500).
"""

import os
import csv
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 60)
print("EXPORT LOW-CONFIDENCE PROJECTS FOR REPROCESSING")
print("=" * 60)

# Connect
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

# Read application IDs from reprocess file
print("Reading application IDs from reprocess file...")
app_ids_to_reprocess = set()
with open('etl/reprocess_under_80_confidence.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        app_id = row.get('application_id')
        if app_id:
            app_ids_to_reprocess.add(str(app_id).strip())  # Keep as string

print(f"✓ Found {len(app_ids_to_reprocess):,} projects to reprocess\n")

# Load abstracts
print("Loading abstracts...")
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

# Fetch projects that need reprocessing
print("Fetching project details...")
all_projects = []
seen_ids = set()
offset = 0
while True:
    response = supabase.table('projects').select(
        'application_id, title, org_name, org_type, primary_category, activity_code, phr, terms'
    ).order('application_id').range(offset, offset + 1000 - 1).execute()

    if not response.data:
        break

    # Filter to only projects that need reprocessing (with deduplication)
    for p in response.data:
        app_id = str(p['application_id'])
        if app_id in app_ids_to_reprocess and app_id not in seen_ids:
            all_projects.append(p)
            seen_ids.add(app_id)

    print(f"  Found {len(all_projects):,} projects to reprocess...", end='\r')

    if len(response.data) < 1000:
        break
    offset += 1000

print(f"✓ Found {len(all_projects):,} projects to reprocess\n")

# Calculate batch size for ~7 batches
NUM_BATCHES = 7
batch_size = (len(all_projects) + NUM_BATCHES - 1) // NUM_BATCHES
print(f"Creating {NUM_BATCHES} batches of ~{batch_size:,} projects each")
print("Abstract truncation: 3000 chars (doubled from 1500)\n")

# Write batches
print("Writing batch files...")
for batch_num in range(NUM_BATCHES):
    start_idx = batch_num * batch_size
    end_idx = min(start_idx + batch_size, len(all_projects))
    batch_projects = all_projects[start_idx:end_idx]

    if not batch_projects:
        break

    filename = f'etl/reprocess_batch_{batch_num + 1:02d}.csv'

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
                abstract[:3000],  # DOUBLED from 1500 to 3000
                phr[:500],
                terms[:300]
            ])

    print(f"  ✓ {filename} ({len(batch_projects):,} projects)")

print(f"\n{'=' * 60}")
print("EXPORT COMPLETE")
print("=" * 60)
print(f"Total: {len(all_projects):,} projects in {NUM_BATCHES} batches")
print(f"\nFiles created: etl/reprocess_batch_01.csv through reprocess_batch_{NUM_BATCHES:02d}.csv")
print("\nKey change: Abstract truncation doubled to 3000 chars")
