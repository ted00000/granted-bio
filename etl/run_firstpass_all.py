#!/usr/bin/env python3
"""Run first-pass classifier on all semantic batches."""
import os
import csv
import sys
from collections import Counter
from pathlib import Path

# Add the etl directory to path for importing the classifier
sys.path.insert(0, str(Path(__file__).parent))
from nih_grant_classifier import classify_project

BATCH_DIR = Path(__file__).parent / 'semantic_batches'
OUTPUT_DIR = Path(__file__).parent / 'firstpass_results'
OUTPUT_DIR.mkdir(exist_ok=True)

def process_all_batches():
    batch_files = sorted(BATCH_DIR.glob('semantic_batch_*.csv'))
    print(f"Found {len(batch_files)} batches to process")

    all_results = []
    total_ok = 0
    total_review = 0
    category_counts = Counter()

    for i, batch_file in enumerate(batch_files, 1):
        with open(batch_file, 'r', encoding='utf-8') as f:
            rows = list(csv.DictReader(f))

        results = []
        for row in rows:
            result = classify_project(row)
            # result = (app_id, category, confidence, secondary, org_type, flag)
            results.append({
                'application_id': result[0],
                'primary_category': result[1],
                'category_confidence': result[2],
                'secondary_category': result[3],
                'org_type': result[4],
                'review_flag': result[5],
                # Include original data for semantic review
                'title': row.get('title', ''),
                'abstract': row.get('abstract', '')[:3000],
                'activity_code': row.get('activity_code', ''),
                'org_name': row.get('org_name', ''),
                'phr': row.get('phr', '')[:1000],
                'terms': row.get('terms', '')
            })

        # Write output for this batch
        output_file = OUTPUT_DIR / f'firstpass_{batch_file.name}'
        with open(output_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=list(results[0].keys()))
            writer.writeheader()
            writer.writerows(results)

        batch_ok = sum(1 for r in results if r['review_flag'] == 'OK')
        batch_review = sum(1 for r in results if r['review_flag'] == 'REVIEW')
        total_ok += batch_ok
        total_review += batch_review

        for r in results:
            category_counts[r['primary_category']] += 1
            all_results.append(r)

        if i % 25 == 0 or i == len(batch_files):
            print(f"Processed {i}/{len(batch_files)} batches - OK: {total_ok}, REVIEW: {total_review}")

    # Write summary
    print(f"\n=== FIRST PASS COMPLETE ===")
    print(f"Total projects: {len(all_results)}")
    print(f"OK (high confidence): {total_ok} ({100*total_ok/len(all_results):.1f}%)")
    print(f"REVIEW (needs semantic): {total_review} ({100*total_review/len(all_results):.1f}%)")
    print(f"\nCategory distribution:")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    # Write combined results
    combined_file = OUTPUT_DIR / 'all_firstpass_results.csv'
    with open(combined_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=list(all_results[0].keys()))
        writer.writeheader()
        writer.writerows(all_results)
    print(f"\nCombined results written to: {combined_file}")

    # Write REVIEW items for semantic processing
    review_items = [r for r in all_results if r['review_flag'] == 'REVIEW']
    review_file = OUTPUT_DIR / 'review_items.csv'
    with open(review_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=list(review_items[0].keys()) if review_items else [])
        writer.writeheader()
        writer.writerows(review_items)
    print(f"REVIEW items written to: {review_file}")

    return all_results, total_ok, total_review

if __name__ == '__main__':
    process_all_batches()
