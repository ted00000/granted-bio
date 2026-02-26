#!/usr/bin/env python3
"""Split REVIEW items into batches for semantic processing."""
import csv
from pathlib import Path

INPUT_FILE = Path(__file__).parent / 'firstpass_results' / 'review_items.csv'
OUTPUT_DIR = Path(__file__).parent / 'review_batches'
OUTPUT_DIR.mkdir(exist_ok=True)

BATCH_SIZE = 50  # Items per batch for semantic review

def create_batches():
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))

    total = len(rows)
    num_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"Splitting {total} REVIEW items into {num_batches} batches of {BATCH_SIZE}")

    for i in range(num_batches):
        start = i * BATCH_SIZE
        end = min(start + BATCH_SIZE, total)
        batch_rows = rows[start:end]

        batch_file = OUTPUT_DIR / f'review_batch_{i+1:04d}.csv'
        with open(batch_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=list(batch_rows[0].keys()))
            writer.writeheader()
            writer.writerows(batch_rows)

        if (i + 1) % 200 == 0 or i + 1 == num_batches:
            print(f"Created {i+1}/{num_batches} batches")

    print(f"\nAll batches written to: {OUTPUT_DIR}")
    return num_batches

if __name__ == '__main__':
    create_batches()
