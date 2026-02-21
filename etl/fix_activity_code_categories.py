"""
Fix projects with training/fellowship/career activity codes.

These activity codes should ALWAYS be classified as 'other' regardless of content:
- T32, T34, T35, TL1, TL4 → Training grants
- F30, F31, F32, F33, F99 → Fellowships
- K01, K02, K05, K07, K08, K12, K22-K26, K43, K76, K99, KL2 → Career development
- P30, P50, P51 → Center grants
- S10, G20 → Equipment grants
- U13, R13 → Conference grants
- D43, D71 → International training

Updates in batches to avoid timeout.
"""

import os
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 60)
print("FIX ACTIVITY CODE CLASSIFICATIONS")
print("=" * 60)

# Connect
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

# Activity codes that should be 'other'
OTHER_CODES = [
    # Training grants (institutional)
    'T32', 'T34', 'T35', 'TL1', 'TL4',
    # Individual fellowships
    'F30', 'F31', 'F32', 'F33', 'F99',
    # Career development
    'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2',
    # Center/infrastructure grants
    'P30', 'P50', 'P51',
    # Equipment grants
    'S10', 'G20',
    # Conference grants
    'U13', 'R13',
    # International training
    'D43', 'D71'
]

# Categories that are wrong for these activity codes
WRONG_CATEGORIES = ['biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health']

BATCH_SIZE = 100

total_fixed = 0
by_code = {}

print("Processing activity codes...")
print("-" * 60)

for code in OTHER_CODES:
    code_fixed = 0

    for wrong_cat in WRONG_CATEGORIES:
        while True:
            # Find projects with this code in wrong category
            result = supabase.table('projects').select('application_id').like(
                'activity_code', f'{code}%'
            ).eq('primary_category', wrong_cat).limit(BATCH_SIZE).execute()

            if not result.data:
                break

            # Update each project
            for p in result.data:
                supabase.table('projects').update({
                    'primary_category': 'other',
                    'primary_category_confidence': 95
                }).eq('application_id', p['application_id']).execute()
                total_fixed += 1
                code_fixed += 1

            print(f"  {code}: {code_fixed} fixed (total: {total_fixed})", end='\r')

            if len(result.data) < BATCH_SIZE:
                break

    if code_fixed > 0:
        by_code[code] = code_fixed
        print(f"  {code}: {code_fixed} fixed")

print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)

print(f"\nTotal projects fixed: {total_fixed:,}")

if by_code:
    print("\nBy activity code:")
    for code, count in sorted(by_code.items(), key=lambda x: -x[1]):
        print(f"  {code:6} {count:>5}")

# Verify new distribution
print("\n" + "=" * 60)
print("NEW CATEGORY DISTRIBUTION")
print("=" * 60)

for cat in ['biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']:
    result = supabase.table('projects').select('application_id', count='exact').eq('primary_category', cat).execute()
    print(f"  {cat:20} {result.count:>6,}")

print("\n✓ Done!")
