#!/usr/bin/env python3
"""
Import reclassified training projects from Claude Max JSON outputs.

Reads all JSON files from training_reclassify_batches/training_reclassified/
and updates the projects table with new primary_category and category_confidence.
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

INPUT_DIR = Path("etl/training_reclassify_batches/training_reclassified")

VALID_CATEGORIES = {
    'basic_research', 'biotools', 'therapeutics', 'diagnostics',
    'medical_device', 'digital_health', 'infrastructure', 'other'
}


def extract_json_from_file(filepath: Path) -> list:
    """Extract JSON array from a file (handles both .json and .txt)."""
    content = filepath.read_text()

    # Find JSON array in the content
    # Handle cases where there might be extra text before/after the JSON
    match = re.search(r'\[[\s\S]*\]', content)
    if not match:
        print(f"  Warning: No JSON array found in {filepath.name}")
        return []

    try:
        data = json.loads(match.group())
        if not isinstance(data, list):
            print(f"  Warning: JSON in {filepath.name} is not an array")
            return []
        return data
    except json.JSONDecodeError as e:
        print(f"  Error parsing JSON in {filepath.name}: {e}")
        return []


def normalize_category(category: str) -> str:
    """Normalize category to lowercase and handle common variations."""
    if not category:
        return None
    cat = category.lower().strip()
    # Handle common variations
    if cat in ('basic research', 'basicresearch'):
        return 'basic_research'
    if cat in ('digital health', 'digitalhealth'):
        return 'digital_health'
    if cat in ('medical device', 'medicaldevice'):
        return 'medical_device'
    return cat


def validate_classification(item: dict) -> tuple:
    """Validate and normalize a single classification entry. Returns (is_valid, normalized_item)."""
    if not isinstance(item, dict):
        return False, None

    app_id = item.get('application_id')
    category = item.get('primary_category')
    confidence = item.get('category_confidence')

    if not app_id or not isinstance(app_id, int):
        return False, None

    normalized_cat = normalize_category(category)
    if normalized_cat not in VALID_CATEGORIES:
        return False, None

    if not isinstance(confidence, (int, float)) or confidence < 0 or confidence > 100:
        return False, None

    return True, {
        'application_id': app_id,
        'primary_category': normalized_cat,
        'category_confidence': confidence
    }


def load_all_classifications() -> list:
    """Load and merge all classification files."""
    all_classifications = []
    seen_ids = set()

    if not INPUT_DIR.exists():
        raise FileNotFoundError(f"Input directory not found: {INPUT_DIR}")

    files = list(INPUT_DIR.glob("*"))
    print(f"Found {len(files)} files in {INPUT_DIR}")

    for filepath in sorted(files):
        if filepath.name.startswith('.'):
            continue

        print(f"  Processing {filepath.name}...")
        items = extract_json_from_file(filepath)

        valid_count = 0
        duplicate_count = 0
        invalid_count = 0

        for item in items:
            is_valid, normalized = validate_classification(item)
            if not is_valid:
                invalid_count += 1
                continue

            app_id = normalized['application_id']
            if app_id in seen_ids:
                duplicate_count += 1
                continue

            seen_ids.add(app_id)
            all_classifications.append(normalized)
            valid_count += 1

        print(f"    Valid: {valid_count}, Duplicates: {duplicate_count}, Invalid: {invalid_count}")

    return all_classifications


def update_database(classifications: list, batch_size: int = 100, dry_run: bool = False):
    """Update database with new classifications."""
    total = len(classifications)
    updated = 0
    errors = 0

    print(f"\nUpdating {total} projects in database...")
    if dry_run:
        print("  (DRY RUN - no changes will be made)")

    for i in range(0, total, batch_size):
        batch = classifications[i:i + batch_size]

        for item in batch:
            app_id = item['application_id']
            category = item['primary_category']
            confidence = int(item['category_confidence'])

            if dry_run:
                updated += 1
                continue

            try:
                result = supabase.table("projects").update({
                    "primary_category": category
                }).eq("application_id", app_id).execute()

                if result.data:
                    updated += 1
                else:
                    # Project might not exist
                    errors += 1

            except Exception as e:
                print(f"    Error updating {app_id}: {e}")
                errors += 1

        print(f"  Progress: {min(i + batch_size, total)}/{total} ({updated} updated, {errors} errors)")

    return updated, errors


def show_distribution(classifications: list):
    """Show category distribution."""
    from collections import Counter

    categories = Counter(c['primary_category'] for c in classifications)
    print("\nCategory distribution:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        pct = 100 * count / len(classifications)
        print(f"  {cat}: {count} ({pct:.1f}%)")

    # Confidence stats
    confidences = [c['category_confidence'] for c in classifications]
    avg_conf = sum(confidences) / len(confidences)
    high_conf = sum(1 for c in confidences if c >= 80)
    print(f"\nConfidence stats:")
    print(f"  Average: {avg_conf:.1f}%")
    print(f"  High confidence (>=80%): {high_conf} ({100*high_conf/len(classifications):.1f}%)")


def main():
    import sys

    dry_run = "--dry-run" in sys.argv

    print("=" * 60)
    print("Import Training Reclassifications")
    print("=" * 60)

    # Load all classifications
    print("\nLoading classification files...")
    classifications = load_all_classifications()
    print(f"\nTotal unique classifications: {len(classifications)}")

    if not classifications:
        print("No classifications to import!")
        return

    # Show distribution
    show_distribution(classifications)

    # Update database
    updated, errors = update_database(classifications, dry_run=dry_run)

    print(f"\n{'DRY RUN ' if dry_run else ''}Complete!")
    print(f"  Updated: {updated}")
    print(f"  Errors: {errors}")

    if dry_run:
        print("\nRun without --dry-run to apply changes.")


if __name__ == "__main__":
    main()
