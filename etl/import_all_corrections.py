"""
Import all classification corrections from re-reviewed disagreements.

Handles:
1. REVERT: Items we changed that semantic says should stay original
2. RE-UPDATE: Items we changed that now have different target
3. NEW CHANGE: Semantic-confirmed items not yet imported
4. NEW HIGH_CONFIDENCE_KEYWORD: Activity code violations not yet imported

Skips: REVIEW (needs human) and KEEP (already correct)
"""

import os
import json
import sys
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 60)
print("IMPORT ALL CLASSIFICATION CORRECTIONS")
print("=" * 60)

# Connect
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

# Read files
print("Reading files...")
with open("etl/All_Disagreements_Mar_17.txt", 'r') as f:
    new_data = json.load(f)

with open("etl/category_disagreements_clean.json", 'r') as f:
    old_data = json.load(f)

# Build lookups
old_import = {item['application_id']: item for item in old_data['disagreements']}
new_review = {item['application_id']: item for item in new_data['disagreements']}

# Categorize all updates needed
updates = []

for item in new_data['disagreements']:
    app_id = item['application_id']
    verdict = item.get('semantic_verdict', '')

    # Skip REVIEW (uncertain) and items not flagged for change
    if verdict == 'REVIEW':
        continue

    # KEEP means semantic agrees with current - check if we already changed it
    if verdict == 'KEEP':
        if app_id in old_import:
            # We changed it, but should revert to current_category
            updates.append({
                'application_id': app_id,
                'primary_category': item['current_category'],
                'category_confidence': 75,  # Lower confidence for reverts
                'action': 'REVERT'
            })
        continue

    # CHANGE or HIGH_CONFIDENCE_KEYWORD - determine target
    if verdict == 'CHANGE':
        target_cat = item['semantic_category']
        target_conf = item['semantic_confidence']
    else:  # HIGH_CONFIDENCE_KEYWORD
        target_cat = item['keyword_category']
        target_conf = item['keyword_confidence']

    # Check if we need to update
    if app_id in old_import:
        old_target = old_import[app_id]['primary_category']
        if old_target != target_cat:
            # Different target - re-update
            updates.append({
                'application_id': app_id,
                'primary_category': target_cat,
                'category_confidence': target_conf,
                'action': 'RE_UPDATE'
            })
        # else: same target, no action needed
    else:
        # New item not yet imported
        updates.append({
            'application_id': app_id,
            'primary_category': target_cat,
            'category_confidence': target_conf,
            'action': 'NEW_' + verdict
        })

# Count by action type
action_counts = {}
for u in updates:
    action_counts[u['action']] = action_counts.get(u['action'], 0) + 1

print(f"\nUpdates to apply:")
for action, count in sorted(action_counts.items()):
    print(f"  {action:25} {count:>6,}")
print(f"  {'TOTAL':25} {len(updates):>6,}")

print(f"\n" + "-" * 60)
print(f"APPLYING {len(updates):,} UPDATES...")
print("-" * 60)
sys.stdout.flush()

applied = 0
errors = 0
by_action = {a: 0 for a in action_counts}

for item in updates:
    try:
        supabase.table("projects").update({
            "primary_category": item["primary_category"],
            "primary_category_confidence": item["category_confidence"]
        }).eq("application_id", item["application_id"]).execute()

        applied += 1
        by_action[item['action']] += 1

        if applied % 500 == 0:
            print(f"  Progress: {applied:,}/{len(updates):,}...")
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
print()
print("By action type:")
for action, count in sorted(by_action.items()):
    print(f"  {action:25} {count:>6,}")
print("\n✓ Done!")
