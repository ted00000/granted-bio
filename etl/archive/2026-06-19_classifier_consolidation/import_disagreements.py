"""
Import classification disagreements from Sonnet 4.6 run back to database.

Reads category_disagreements_clean.json and updates projects table.
"""

import os
import json
import sys
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 60)
print("IMPORT CLASSIFICATION DISAGREEMENTS")
print("=" * 60)

# Connect
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

# Read JSON file
print("Reading disagreements file...")
with open("etl/category_disagreements_clean.json", 'r') as f:
    data = json.load(f)

print(f"\nSummary from file:")
print(f"  Total processed: {data['summary']['total_grants_processed']:,}")
print(f"  Disagreements: {data['summary']['total_disagreements']:,}")
print(f"  Rate: {data['summary']['disagreement_rate_pct']}%")

disagreements = data['disagreements']

print(f"\n" + "-" * 60)
print(f"APPLYING {len(disagreements):,} UPDATES...")
print("-" * 60)
sys.stdout.flush()

applied = 0
errors = 0

for item in disagreements:
    try:
        supabase.table("projects").update({
            "primary_category": item["primary_category"],
            "primary_category_confidence": item["category_confidence"]
        }).eq("application_id", item["application_id"]).execute()

        applied += 1
        if applied % 500 == 0:
            print(f"  Progress: {applied:,}/{len(disagreements):,}...")
            sys.stdout.flush()
    except Exception as e:
        errors += 1
        if errors <= 5:
            print(f"  Error on {item['application_id']}: {e}")

print(f"\n" + "=" * 60)
print("IMPORT COMPLETE")
print("=" * 60)
print(f"Applied: {applied:,}")
print(f"Errors: {errors}")
print("\n✓ Done!")
