#!/usr/bin/env python3
"""
Update Supabase database with final classification results using individual updates.
Uses asyncio for parallel processing.
"""
import csv
import os
import asyncio
from pathlib import Path
from dotenv import load_dotenv
import httpx

load_dotenv('../.env.local')

SUPABASE_URL = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPABASE_KEY = os.environ['SUPABASE_SERVICE_KEY']
INPUT_FILE = 'final_classifications.csv'
CONCURRENT = 50  # Number of concurrent requests

async def update_record(client, app_id, data):
    """Update a single record."""
    url = f"{SUPABASE_URL}/rest/v1/projects?application_id=eq.{app_id}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }
    try:
        response = await client.patch(url, json=data, headers=headers)
        return response.status_code == 204
    except Exception as e:
        return False

async def process_batch(records, pbar_start):
    """Process a batch of records concurrently."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = []
        for rec in records:
            data = {
                'primary_category': rec['primary_category'],
                'primary_category_confidence': int(rec['category_confidence']) if rec['category_confidence'] else 80,
            }
            if rec['org_type']:
                data['org_type'] = rec['org_type']
            if rec['secondary_category']:
                data['secondary_category'] = rec['secondary_category']

            tasks.append(update_record(client, rec['application_id'], data))

        results = await asyncio.gather(*tasks)
        success = sum(1 for r in results if r)
        return success

async def main():
    import sys
    total = 0
    updated = 0
    batch = []
    batch_size = 500

    with open(INPUT_FILE, 'r') as f:
        reader = csv.DictReader(f)
        records = list(reader)

    total = len(records)
    print(f"Total records: {total:,}", flush=True)

    for i in range(0, total, batch_size):
        batch = records[i:i+batch_size]
        success = await process_batch(batch, i)
        updated += success
        pct = 100 * (i + len(batch)) / total
        print(f"Progress: {i+len(batch):,}/{total:,} ({pct:.1f}%) - {updated:,} updated", flush=True)

    print(f"\nComplete: {updated:,} of {total:,} updated", flush=True)

if __name__ == '__main__':
    os.chdir(Path(__file__).parent)
    asyncio.run(main())
