"""
Fix org_type misclassifications.
Run locally - won't timeout like Supabase SQL Editor.
"""

import os
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

import time

BATCH_SIZE = 50  # Smaller batches to avoid timeout

def fix_pattern(pattern: str, new_type: str, description: str):
    """Fix all records matching pattern."""
    print(f"\n{'='*60}", flush=True)
    print(f"Fixing: {description}", flush=True)
    print(f"Pattern: {pattern} -> {new_type}", flush=True)
    print(f"{'='*60}", flush=True)

    total_fixed = 0
    batch = 0

    while True:
        batch += 1

        # Find records to fix
        result = supabase.table('projects').select('application_id').eq(
            'org_type', 'company'
        ).ilike('org_name', f'%{pattern}%').limit(BATCH_SIZE).execute()

        if not result.data:
            break

        ids = [r['application_id'] for r in result.data]
        count = len(ids)

        # Update one at a time to avoid timeout
        for app_id in ids:
            supabase.table('projects').update({
                'org_type': new_type
            }).eq('application_id', app_id).execute()

        total_fixed += count
        print(f"  Batch {batch}: fixed {count} records (total: {total_fixed})", flush=True)
        time.sleep(0.1)  # Small delay between batches

    print(f"✓ Complete: {total_fixed} records fixed", flush=True)
    return total_fixed

# Run fixes
total = 0

total += fix_pattern('UNIVERSITY', 'university', 'Universities')
total += fix_pattern('COLLEGE', 'university', 'Colleges')
total += fix_pattern('SCHOOL OF MEDICINE', 'university', 'Medical Schools')
total += fix_pattern('MEDICAL SCHOOL', 'university', 'Medical Schools (alt)')
total += fix_pattern('INSTITUTE OF TECHNOLOGY', 'university', 'Institutes of Technology')
total += fix_pattern('HOSPITAL', 'hospital', 'Hospitals')
total += fix_pattern('MEDICAL CENTER', 'hospital', 'Medical Centers')

print(f"\n{'='*60}")
print(f"TOTAL FIXED: {total}")
print(f"{'='*60}")

# Show final distribution
print("\nFinal org_type distribution:")
for org_type in ['university', 'company', 'hospital', 'research_institute', 'other']:
    result = supabase.table('projects').select('application_id', count='exact').eq('org_type', org_type).execute()
    print(f"  {org_type}: {result.count:,}")
