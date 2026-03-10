#!/usr/bin/env python3
"""
Reclassify specific categories with honest classifier.
Uses robust pagination that doesn't exit early on partial batches.
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


def load_all_abstracts(supabase):
    """Load all abstracts with robust pagination using explicit ordering."""
    print("Loading abstracts...")

    # Get total count first
    total_result = supabase.table('abstracts').select('id', count='exact').execute()
    total = total_result.count
    print(f"  Total abstracts to load: {total:,}")

    abstracts_map = {}
    offset = 0
    batch_size = 1000
    consecutive_empty = 0
    max_empty = 3

    while offset < total + batch_size:  # Use offset-based termination
        try:
            # Use explicit ordering to ensure consistent pagination
            result = supabase.table('abstracts').select(
                'application_id, abstract_text'
            ).order('application_id').range(offset, offset + batch_size - 1).execute()

            if not result.data:
                consecutive_empty += 1
                if consecutive_empty >= max_empty:
                    print(f"  No more data after {offset}")
                    break
                offset += batch_size
                continue

            consecutive_empty = 0

            for a in result.data:
                abstracts_map[a['application_id']] = a['abstract_text'] or ''

            offset += batch_size

            if offset % 20000 == 0:
                print(f"  Loaded {len(abstracts_map):,} (offset {offset:,}/{total:,})...", flush=True)

            # Exit if we got a partial batch (end of data)
            if len(result.data) < batch_size:
                print(f"  Reached end at offset {offset}")
                break

        except Exception as e:
            print(f"  Error at offset {offset}: {e}")
            time.sleep(2)
            # Don't increment offset on error, retry same batch

    print(f"  Loaded {len(abstracts_map):,} abstracts")
    return abstracts_map


def reclassify_category(supabase, category, abstracts_map):
    """Reclassify all projects in a category."""
    print(f"\n{'=' * 60}")
    print(f"PROCESSING: {category.upper()}")
    print("=" * 60)

    # Get count
    count_result = supabase.table('projects').select('id', count='exact').eq('primary_category', category).execute()
    total = count_result.count
    print(f"Total {category} projects: {total:,}")

    # Process in batches
    offset = 0
    batch_size = 1000
    processed = 0
    updated = 0
    errors = 0

    category_changes = Counter()
    confidence_changes = Counter()

    while processed < total:
        try:
            result = supabase.table('projects').select(
                'application_id, title, org_name, activity_code, phr, primary_category, primary_category_confidence, org_type'
            ).eq('primary_category', category).range(offset, offset + batch_size - 1).execute()
        except Exception as e:
            print(f"  Error fetching batch at offset {offset}: {e}")
            time.sleep(2)
            continue

        if not result.data:
            break

        for p in result.data:
            app_id = p['application_id']
            abstract = abstracts_map.get(app_id, '')
            old_cat = p['primary_category']
            old_conf = p.get('primary_category_confidence') or 0
            old_org_type = p.get('org_type')

            # Reclassify
            new_result = classify_project(p, abstract)
            new_cat = new_result['primary_category']
            new_conf = new_result['category_confidence']
            new_org_type = new_result['org_type']

            # Track changes
            if new_cat != old_cat:
                category_changes[(old_cat, new_cat)] += 1

            conf_change = new_conf - old_conf
            if conf_change != 0:
                bucket = f"{'+' if conf_change > 0 else ''}{conf_change}"
                confidence_changes[bucket] += 1

            # Update if anything changed
            if new_cat != old_cat or new_conf != old_conf or new_org_type != old_org_type:
                try:
                    supabase.table('projects').update({
                        'primary_category': new_cat,
                        'primary_category_confidence': new_conf,
                        'org_type': new_org_type
                    }).eq('application_id', app_id).execute()
                    updated += 1
                except Exception as e:
                    errors += 1
                    if errors <= 5:
                        print(f"  Error updating {app_id}: {str(e)[:50]}")

            processed += 1

        offset += batch_size

        if processed % 5000 == 0:
            print(f"  Processed {processed:,}/{total:,}, Updated {updated:,}", flush=True)

    print(f"\nResults for {category}:")
    print(f"  Processed: {processed:,}")
    print(f"  Updated: {updated:,}")
    print(f"  Errors: {errors}")

    if category_changes:
        print(f"\n  Category changes:")
        for (old, new), count in category_changes.most_common(10):
            print(f"    {old} -> {new}: {count:,}")

    if confidence_changes:
        print(f"\n  Confidence changes (top 10):")
        for change, count in sorted(confidence_changes.items(), key=lambda x: -x[1])[:10]:
            print(f"    {change}: {count:,}")

    return processed, updated, errors, category_changes


def main():
    print("=" * 60)
    print("RECLASSIFY BASIC_RESEARCH AND OTHER")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    supabase = get_supabase_client()
    print("Connected to Supabase\n")

    # Load all abstracts first
    abstracts_map = load_all_abstracts(supabase)

    if len(abstracts_map) < 100000:
        print(f"ERROR: Only loaded {len(abstracts_map):,} abstracts, expected ~144K")
        print("Aborting to prevent bad updates.")
        sys.exit(1)

    # Process each category
    total_changes = Counter()

    for category in ['basic_research', 'other']:
        processed, updated, errors, changes = reclassify_category(supabase, category, abstracts_map)
        total_changes.update(changes)

    # Final verification
    print(f"\n{'=' * 60}")
    print("FINAL VERIFICATION")
    print("=" * 60)

    for cat in ['basic_research', 'therapeutics', 'biotools', 'diagnostics', 'other']:
        result = supabase.table('projects').select('id', count='exact').eq('primary_category', cat).execute()
        high_conf = supabase.table('projects').select('id', count='exact').eq('primary_category', cat).gte('primary_category_confidence', 80).execute()
        pct = 100 * high_conf.count / result.count if result.count else 0
        print(f"  {cat}: {result.count:,} total, {high_conf.count:,} at >=80% ({pct:.1f}%)")

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == '__main__':
    main()
