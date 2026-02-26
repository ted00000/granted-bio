#!/usr/bin/env python3
"""
Merge first-pass OK classifications with semantic review results.
"""
import csv
import os
from pathlib import Path

# Paths
FIRSTPASS_FILE = 'firstpass_results/all_firstpass_results.csv'
SEMANTIC_DIR = 'semantic_results'
OUTPUT_FILE = 'final_classifications.csv'

def load_semantic_results():
    """Load all semantic classification results into a dict keyed by application_id."""
    semantic = {}
    semantic_dir = Path(SEMANTIC_DIR)

    # Both naming conventions
    files = list(semantic_dir.glob('batch_*_semantic.csv')) + list(semantic_dir.glob('semantic_*.csv'))

    for filepath in files:
        with open(filepath, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                app_id = row['application_id']
                semantic[app_id] = {
                    'primary_category': row['primary_category'],
                    'category_confidence': row.get('category_confidence', ''),
                    'secondary_category': row.get('secondary_category', ''),
                    'org_type': row.get('org_type', ''),
                    'reasoning': row.get('reasoning', '')
                }

    print(f"Loaded {len(semantic)} semantic classifications")
    return semantic

def merge_results():
    """Merge OK first-pass with semantic review results."""
    semantic = load_semantic_results()

    ok_count = 0
    review_count = 0
    missing_count = 0

    with open(FIRSTPASS_FILE, 'r') as fin, open(OUTPUT_FILE, 'w', newline='') as fout:
        reader = csv.DictReader(fin)

        fieldnames = [
            'application_id', 'primary_category', 'category_confidence',
            'secondary_category', 'org_type', 'title', 'activity_code',
            'org_name', 'classification_source', 'reasoning'
        ]
        writer = csv.DictWriter(fout, fieldnames=fieldnames)
        writer.writeheader()

        for row in reader:
            app_id = row['application_id']
            flag = row.get('review_flag', '')

            out_row = {
                'application_id': app_id,
                'title': row.get('title', ''),
                'activity_code': row.get('activity_code', ''),
                'org_name': row.get('org_name', '')
            }

            if flag == 'OK':
                # Use first-pass classification
                out_row['primary_category'] = row['primary_category']
                out_row['category_confidence'] = row.get('category_confidence', '')
                out_row['secondary_category'] = row.get('secondary_category', '')
                out_row['org_type'] = row.get('org_type', '')
                out_row['classification_source'] = 'firstpass'
                out_row['reasoning'] = ''
                ok_count += 1

            elif flag == 'REVIEW':
                # Use semantic classification
                if app_id in semantic:
                    sem = semantic[app_id]
                    out_row['primary_category'] = sem['primary_category']
                    out_row['category_confidence'] = sem['category_confidence']
                    out_row['secondary_category'] = sem['secondary_category']
                    out_row['org_type'] = sem['org_type']
                    out_row['classification_source'] = 'semantic'
                    out_row['reasoning'] = sem['reasoning']
                    review_count += 1
                else:
                    # Missing from semantic - use firstpass anyway
                    out_row['primary_category'] = row['primary_category']
                    out_row['category_confidence'] = row.get('category_confidence', '')
                    out_row['secondary_category'] = row.get('secondary_category', '')
                    out_row['org_type'] = row.get('org_type', '')
                    out_row['classification_source'] = 'firstpass_fallback'
                    out_row['reasoning'] = 'Missing semantic classification'
                    missing_count += 1

            writer.writerow(out_row)

    print(f"\nMerge complete:")
    print(f"  OK (first-pass): {ok_count}")
    print(f"  REVIEW (semantic): {review_count}")
    print(f"  Missing semantic: {missing_count}")
    print(f"  Total: {ok_count + review_count + missing_count}")
    print(f"\nOutput: {OUTPUT_FILE}")

if __name__ == '__main__':
    os.chdir(Path(__file__).parent)
    merge_results()
