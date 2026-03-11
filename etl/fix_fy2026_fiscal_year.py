#!/usr/bin/env python3
"""
Fix fiscal_year for FY2026 projects loaded on 2026-03-09.
The original load used the API's fiscal_year field (original award year)
instead of the queried fiscal year (2026).
"""

import os
import time
from dotenv import load_dotenv

load_dotenv('.env.local')

from supabase import create_client

def main():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    supabase = create_client(url, key)

    print("Fixing FY2026 fiscal_year values...")
    print()

    # Get all application_ids that were updated today but aren't FY2026
    print("Step 1: Getting application_ids to update...")
    all_ids = []
    offset = 0
    while True:
        result = supabase.table('projects') \
            .select('application_id') \
            .gte('updated_at', '2026-03-09T14:00:00') \
            .neq('fiscal_year', 2026) \
            .range(offset, offset + 999) \
            .execute()
        if not result.data:
            break
        all_ids.extend([r['application_id'] for r in result.data])
        print(f"  Fetched {len(all_ids)} ids...")
        offset += 1000
        if len(result.data) < 1000:
            break
        time.sleep(0.1)

    print(f"\nFound {len(all_ids)} projects to update")

    if len(all_ids) == 0:
        print("Nothing to update!")
        return

    # Update in small batches
    print("\nStep 2: Updating to FY2026...")
    updated = 0
    errors = 0
    for i in range(0, len(all_ids), 25):  # Smaller batches of 25
        batch_ids = all_ids[i:i+25]
        try:
            supabase.table('projects') \
                .update({'fiscal_year': 2026}) \
                .in_('application_id', batch_ids) \
                .execute()
            updated += len(batch_ids)
            if updated % 250 == 0 or updated == len(all_ids):
                print(f"  Progress: {updated}/{len(all_ids)} ({100*updated//len(all_ids)}%)")
        except Exception as e:
            errors += 1
            print(f"  Error at batch {i//25}: {str(e)[:80]}")
        time.sleep(0.1)  # Rate limit

    print(f"\nUpdated {updated} projects, {errors} errors")

    # Verify
    print("\nStep 3: Verification...")
    for fy in [2024, 2025, 2026]:
        r = supabase.table('projects').select('id', count='exact').eq('fiscal_year', fy).execute()
        print(f"  FY{fy}: {r.count:,}")


if __name__ == '__main__':
    main()
