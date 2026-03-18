#!/usr/bin/env python3
"""
Import classification results from Claude Max back into the database.

Reads JSON files containing classification results and updates the projects table.
"""

import os
import json
import glob
from supabase import create_client, Client
from dotenv import load_dotenv
from collections import Counter

load_dotenv('.env.local')

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

VALID_CATEGORIES = [
    "training", "infrastructure", "basic_research", "biotools",
    "therapeutics", "diagnostics", "medical_device", "digital_health", "other"
]


def parse_claude_max_response(file_path: str) -> list:
    """
    Parse a Claude Max response file containing JSON classification results.

    Supports multiple formats:
    1. JSON array: [{"application_id": ..., "primary_category": ...}, ...]
    2. Single JSON object: {"application_id": ..., "primary_category": ...}
    3. Raw text with JSON array embedded (extracts the array)
    """
    with open(file_path, 'r') as f:
        content = f.read().strip()

    # Try to parse as JSON directly
    try:
        data = json.loads(content)
        if isinstance(data, list):
            return data
        elif isinstance(data, dict):
            return [data]
    except json.JSONDecodeError:
        pass

    # Try to extract JSON array from markdown code block
    if "```json" in content:
        start = content.find("```json") + 7
        end = content.find("```", start)
        if end > start:
            try:
                return json.loads(content[start:end].strip())
            except json.JSONDecodeError:
                pass

    # Try to find JSON array anywhere in the content
    start = content.find("[")
    end = content.rfind("]") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(content[start:end])
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse JSON from {file_path}")


def validate_classification(item: dict) -> tuple[bool, str]:
    """Validate a single classification result."""
    if "application_id" not in item:
        return False, "missing application_id"

    if "primary_category" not in item:
        return False, "missing primary_category"

    if item["primary_category"] not in VALID_CATEGORIES:
        return False, f"invalid category: {item['primary_category']}"

    return True, ""


def import_results(input_dir: str, dry_run: bool = True):
    """Import all classification results from a directory."""

    # Find all JSON files in the directory
    json_files = glob.glob(os.path.join(input_dir, "*.json"))
    if not json_files:
        # Also check for .txt files that might contain JSON
        json_files = glob.glob(os.path.join(input_dir, "response_*.txt"))

    if not json_files:
        print(f"No result files found in {input_dir}")
        print("Expected files matching: *.json or response_*.txt")
        return

    print(f"Found {len(json_files)} result files")

    all_results = []
    errors = []

    for file_path in sorted(json_files):
        print(f"\nProcessing: {os.path.basename(file_path)}")

        try:
            results = parse_claude_max_response(file_path)
            print(f"  Parsed {len(results)} classifications")

            valid_count = 0
            for item in results:
                is_valid, error = validate_classification(item)
                if is_valid:
                    all_results.append(item)
                    valid_count += 1
                else:
                    errors.append({
                        "file": os.path.basename(file_path),
                        "item": item,
                        "error": error
                    })

            print(f"  Valid: {valid_count}, Invalid: {len(results) - valid_count}")

        except Exception as e:
            print(f"  ERROR: {e}")
            errors.append({
                "file": os.path.basename(file_path),
                "error": str(e)
            })

    # Summary
    print("\n" + "=" * 60)
    print("Import Summary")
    print("=" * 60)
    print(f"Total valid classifications: {len(all_results)}")
    print(f"Total errors: {len(errors)}")

    # Category distribution
    categories = Counter(r["primary_category"] for r in all_results)
    print("\nCategory distribution:")
    for cat, count in categories.most_common():
        print(f"  {cat}: {count}")

    if errors:
        print(f"\nErrors (first 10):")
        for err in errors[:10]:
            print(f"  {err.get('file', 'unknown')}: {err.get('error', 'unknown error')}")

    if dry_run:
        print("\nDRY RUN - no changes applied. Run with --execute to apply.")
        return

    # Apply updates
    print("\nApplying updates...")
    applied = 0
    update_errors = 0

    for i, result in enumerate(all_results):
        try:
            update_data = {
                "primary_category": result["primary_category"]
            }

            # Include confidence if provided
            if "category_confidence" in result:
                update_data["primary_category_confidence"] = result["category_confidence"]

            supabase.table("projects").update(update_data).eq(
                "application_id", result["application_id"]
            ).execute()

            applied += 1
            if applied % 100 == 0:
                print(f"  Applied {applied}/{len(all_results)}...")

        except Exception as e:
            update_errors += 1
            print(f"  Error updating {result['application_id']}: {e}")

    print(f"\nDone. Applied {applied} updates, {update_errors} errors.")


def main():
    import sys

    dry_run = "--execute" not in sys.argv

    # Default input directory
    input_dir = "etl/claude_max_results"

    # Parse input directory from args
    for arg in sys.argv:
        if arg.startswith("--input="):
            input_dir = arg.split("=")[1]

    print("=" * 60)
    print("Import Claude Max Classification Results")
    print("=" * 60)
    print(f"Input directory: {input_dir}")

    if not os.path.exists(input_dir):
        print(f"\nDirectory not found: {input_dir}")
        print("\nUsage:")
        print("  1. Create a directory for your Claude Max responses")
        print("  2. Save each Claude Max JSON response as a .json file")
        print("  3. Run: python etl/import_claude_max_results.py --input=<dir>")
        print("\nExample:")
        print("  mkdir etl/claude_max_results")
        print("  # Save Claude Max responses as response_001.json, response_002.json, etc.")
        print("  python etl/import_claude_max_results.py --input=etl/claude_max_results")
        return

    import_results(input_dir, dry_run=dry_run)


if __name__ == "__main__":
    main()
