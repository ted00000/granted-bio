"""
Backfill program_officer column from NIH ExPORTER CSV files.

Prerequisites:
    Run this SQL in Supabase SQL Editor first:

    ALTER TABLE projects ADD COLUMN IF NOT EXISTS program_officer VARCHAR(200);

Usage:
    python3 etl/backfill_program_officer.py
"""

import os
import csv
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 70)
print("BACKFILL PROGRAM OFFICER FROM CSV")
print("=" * 70)

# Connect
print("\nConnecting to Supabase...")
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected\n")

# Load PO data from CSV files
csv_files = [
    'data/raw/RePORTER_PRJ_C_FY2024.csv',
    'data/raw/RePORTER_PRJ_C_FY2025.csv'
]

po_data = {}  # application_id -> program_officer

for csv_file in csv_files:
    if not os.path.exists(csv_file):
        print(f"⚠ Skipping {csv_file} - not found")
        continue

    print(f"Reading {csv_file}...")
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        count = 0
        for row in reader:
            app_id = row.get('APPLICATION_ID', '').strip()
            po = row.get('PROGRAM_OFFICER_NAME', '').strip()
            if app_id and po:
                po_data[app_id] = po
                count += 1
    print(f"  ✓ Found {count:,} entries with PO")

print(f"\n✓ Total unique application IDs with PO: {len(po_data):,}\n")

# Update function for threading
def update_record(app_id, po):
    try:
        result = supabase.table('projects') \
            .update({'program_officer': po}) \
            .eq('application_id', app_id) \
            .execute()
        return 1 if result.data else 0
    except Exception as e:
        return 0

# Update database with concurrent requests
app_ids = list(po_data.keys())
updated = 0
processed = 0
batch_size = 50  # Number of concurrent requests

print("Updating database (concurrent)...")
sys.stdout.flush()

with ThreadPoolExecutor(max_workers=batch_size) as executor:
    futures = {executor.submit(update_record, app_id, po_data[app_id]): app_id for app_id in app_ids}

    for future in as_completed(futures):
        result = future.result()
        updated += result
        processed += 1

        if processed % 1000 == 0:
            print(f"  ... processed {processed:,} / {len(app_ids):,} ({updated:,} updated)")
            sys.stdout.flush()

print(f"\n✓ Updated {updated:,} projects with program officer")
print(f"  (Skipped {len(app_ids) - updated:,} - not found in database)")

# Verify
print("\nVerifying...")
result = supabase.table('projects') \
    .select('id', count='exact') \
    .not_.is_('program_officer', 'null') \
    .execute()

print(f"✓ Projects with program_officer: {result.count:,}")

print("\nDone!")
