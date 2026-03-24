#!/usr/bin/env python3
"""
Import remaining training reclassifications.
"""

import os
import json
import re
from pathlib import Path
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv('.env.local')

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

INPUT_DIR = Path("etl/remaining_training_batches")

VALID_CATEGORIES = {
    'basic_research', 'biotools', 'therapeutics', 'diagnostics',
    'medical_device', 'digital_health', 'infrastructure', 'other'
}


def extract_json_from_file(filepath: Path) -> list:
    content = filepath.read_text()
    match = re.search(r'\[[\s\S]*\]', content)
    if not match:
        print(f"  Warning: No JSON array found in {filepath.name}")
        return []
    try:
        data = json.loads(match.group())
        if not isinstance(data, list):
            return []
        return data
    except json.JSONDecodeError as e:
        print(f"  Error parsing JSON in {filepath.name}: {e}")
        return []


def normalize_category(category: str) -> str:
    if not category:
        return None
    cat = category.lower().strip()
    if cat in ('basic research', 'basicresearch'):
        return 'basic_research'
    if cat in ('digital health', 'digitalhealth'):
        return 'digital_health'
    if cat in ('medical device', 'medicaldevice'):
        return 'medical_device'
    return cat


def load_all_classifications() -> list:
    all_classifications = []
    seen_ids = set()

    # Only process JSON files
    files = list(INPUT_DIR.glob("*.json"))
    print(f"Found {len(files)} JSON files in {INPUT_DIR}")

    for filepath in sorted(files):
        if filepath.name == 'summary.json':
            continue

        print(f"  Processing {filepath.name}...")
        items = extract_json_from_file(filepath)

        valid_count = 0
        for item in items:
            if not isinstance(item, dict):
                continue

            app_id = item.get('application_id')
            category = item.get('primary_category')
            confidence = item.get('category_confidence')

            if not app_id or not isinstance(app_id, int):
                continue

            normalized_cat = normalize_category(category)
            if normalized_cat not in VALID_CATEGORIES:
                continue

            if app_id in seen_ids:
                continue

            seen_ids.add(app_id)
            all_classifications.append({
                'application_id': app_id,
                'primary_category': normalized_cat
            })
            valid_count += 1

        print(f"    Valid: {valid_count}")

    return all_classifications


def update_database(classifications: list, dry_run: bool = False):
    total = len(classifications)
    updated = 0
    errors = 0

    print(f"\nUpdating {total} projects...")
    if dry_run:
        print("  (DRY RUN)")

    for i, item in enumerate(classifications):
        if dry_run:
            updated += 1
            continue

        try:
            result = supabase.table("projects").update({
                "primary_category": item['primary_category']
            }).eq("application_id", item['application_id']).execute()

            if result.data:
                updated += 1
            else:
                errors += 1
        except Exception as e:
            errors += 1

        if (i + 1) % 500 == 0:
            print(f"  Progress: {i+1}/{total} ({updated} updated, {errors} errors)")

    print(f"  Progress: {total}/{total} ({updated} updated, {errors} errors)")
    return updated, errors


def main():
    import sys
    dry_run = "--dry-run" in sys.argv

    print("=" * 60)
    print("Import Remaining Training Reclassifications")
    print("=" * 60)

    classifications = load_all_classifications()
    print(f"\nTotal: {len(classifications)}")

    if not classifications:
        print("No classifications to import!")
        return

    # Distribution
    from collections import Counter
    cats = Counter(c['primary_category'] for c in classifications)
    print("\nDistribution:")
    for cat, count in sorted(cats.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count} ({100*count/len(classifications):.1f}%)")

    updated, errors = update_database(classifications, dry_run=dry_run)
    print(f"\n{'DRY RUN ' if dry_run else ''}Complete!")
    print(f"  Updated: {updated}")
    print(f"  Errors: {errors}")


if __name__ == "__main__":
    main()
