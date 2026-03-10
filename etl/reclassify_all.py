#!/usr/bin/env python3
"""
Reclassify all projects with improved confidence scoring.
Updates confidence scores (and categories if changed) for all projects.
"""

import os
import sys
import time
from datetime import datetime
from collections import Counter
from dotenv import load_dotenv

sys.stdout.reconfigure(line_buffering=True)

load_dotenv('../.env.local')

from supabase import create_client
from classify_from_database import classify_project

def get_supabase_client():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    return create_client(url, key)


def main():
    print("=" * 60)
    print("RECLASSIFY ALL PROJECTS WITH IMPROVED CONFIDENCE")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    supabase = get_supabase_client()
    print("Connected to Supabase\n")

    # Get total count
    total_result = supabase.table('projects').select('id', count='exact').execute()
    total = total_result.count
    print(f"Total projects to reclassify: {total:,}")

    # Load all abstracts (Supabase has 1000 row default limit)
    print("\nLoading abstracts...")
    abstracts_map = {}
    offset = 0
    batch_size = 1000
    while True:
        result = supabase.table('abstracts').select(
            'application_id, abstract_text'
        ).range(offset, offset + batch_size - 1).execute()
        if not result.data:
            break
        for a in result.data:
            abstracts_map[a['application_id']] = a['abstract_text'] or ''
        offset += batch_size
        if len(abstracts_map) % 10000 == 0:
            print(f"  Loaded {len(abstracts_map):,} abstracts...", flush=True)
        if len(result.data) < batch_size:
            break
    print(f"  Total: {len(abstracts_map):,} abstracts")

    # Process in batches
    print(f"\nReclassifying all projects...")
    print("-" * 60)

    offset = 0
    batch_size = 1000
    updates = []
    category_changes = Counter()
    confidence_improvements = 0
    processed = 0

    while offset < total:
        # Fetch batch
        result = supabase.table('projects').select(
            'application_id, title, org_name, activity_code, phr, primary_category, primary_category_confidence'
        ).range(offset, offset + batch_size - 1).execute()

        if not result.data:
            break

        for p in result.data:
            app_id = p['application_id']
            abstract = abstracts_map.get(app_id, '')
            old_cat = p.get('primary_category')
            old_conf = p.get('primary_category_confidence') or 0

            # Reclassify
            new_result = classify_project(p, abstract)

            # Track changes
            if new_result['primary_category'] != old_cat:
                category_changes[(old_cat, new_result['primary_category'])] += 1

            if new_result['category_confidence'] > old_conf:
                confidence_improvements += 1

            # Only update if something changed
            if (new_result['primary_category'] != old_cat or
                new_result['category_confidence'] != old_conf or
                new_result['org_type'] != p.get('org_type')):
                updates.append({
                    'application_id': app_id,
                    'primary_category': new_result['primary_category'],
                    'category_confidence': new_result['category_confidence'],
                    'org_type': new_result['org_type']
                })

            processed += 1

        # Progress
        if processed % 5000 == 0:
            print(f"  Processed {processed:,}/{total:,} ({100*processed//total}%), {len(updates):,} updates queued", flush=True)

        offset += batch_size

    print(f"\nClassification complete.")
    print(f"  Total processed: {processed:,}")
    print(f"  Updates needed: {len(updates):,}")
    print(f"  Confidence improvements: {confidence_improvements:,}")

    if category_changes:
        print(f"\nCategory changes (top 10):")
        for (old, new), count in category_changes.most_common(10):
            print(f"  {old} -> {new}: {count:,}")

    # Apply updates
    if updates:
        print(f"\n{'=' * 60}")
        print("UPDATING DATABASE")
        print("=" * 60)

        updated = 0
        errors = 0
        for i, u in enumerate(updates):
            try:
                supabase.table('projects').update({
                    'primary_category': u['primary_category'],
                    'primary_category_confidence': u['category_confidence'],
                    'org_type': u['org_type']
                }).eq('application_id', u['application_id']).execute()
                updated += 1
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  Error updating {u['application_id']}: {str(e)[:50]}")

            if (i + 1) % 1000 == 0:
                print(f"  Progress: {updated:,}/{len(updates):,}", flush=True)

        print(f"  Updated: {updated:,}, Errors: {errors}")

    # Final verification
    print(f"\n{'=' * 60}")
    print("FINAL VERIFICATION")
    print("=" * 60)

    total = supabase.table('projects').select('id', count='exact').execute()
    high_conf = supabase.table('projects').select('id', count='exact').gte('primary_category_confidence', 80).execute()
    pct = 100 * high_conf.count / total.count if total.count else 0

    print(f"Total: {total.count:,}")
    print(f">= 80% confidence: {high_conf.count:,} ({pct:.1f}%)")
    print(f"Target: 90%")

    if pct >= 90:
        print("\nTARGET MET!")
    else:
        print(f"\nStill {90 - pct:.1f}% short of target")

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == '__main__':
    main()
