#!/usr/bin/env python3
"""
Validate classifier against gold standard labels.
Computes precision, recall, F1 per category and overall.
"""

import os
import sys
import csv
import json
from datetime import datetime
from collections import Counter, defaultdict
from dotenv import load_dotenv

sys.stdout.reconfigure(line_buffering=True)

load_dotenv('../.env.local')

from classify_from_database import classify_project

CATEGORIES = ['training', 'infrastructure', 'basic_research', 'biotools',
              'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']


def load_validation_set(filepath: str) -> list:
    """Load labeled validation set from CSV."""
    samples = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('gold_category'):  # Only include labeled rows
                samples.append(row)
    return samples


def compute_metrics(predictions: list, gold: list) -> dict:
    """Compute precision, recall, F1 for each category."""
    # Count TP, FP, FN per category
    tp = Counter()
    fp = Counter()
    fn = Counter()

    for pred, true in zip(predictions, gold):
        if pred == true:
            tp[pred] += 1
        else:
            fp[pred] += 1
            fn[true] += 1

    metrics = {}
    for cat in CATEGORIES:
        precision = tp[cat] / (tp[cat] + fp[cat]) if (tp[cat] + fp[cat]) > 0 else 0
        recall = tp[cat] / (tp[cat] + fn[cat]) if (tp[cat] + fn[cat]) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
        support = tp[cat] + fn[cat]  # Number of actual instances

        metrics[cat] = {
            'precision': precision,
            'recall': recall,
            'f1': f1,
            'support': support,
            'tp': tp[cat],
            'fp': fp[cat],
            'fn': fn[cat]
        }

    # Macro F1 (unweighted average)
    valid_f1s = [m['f1'] for m in metrics.values() if m['support'] > 0]
    metrics['macro_f1'] = sum(valid_f1s) / len(valid_f1s) if valid_f1s else 0

    # Weighted F1
    total_support = sum(m['support'] for m in metrics.values())
    weighted_f1 = sum(m['f1'] * m['support'] for m in metrics.values()) / total_support if total_support > 0 else 0
    metrics['weighted_f1'] = weighted_f1

    # Overall accuracy
    correct = sum(1 for p, g in zip(predictions, gold) if p == g)
    metrics['accuracy'] = correct / len(predictions) if predictions else 0

    return metrics


def print_confusion_matrix(predictions: list, gold: list):
    """Print confusion matrix."""
    # Build matrix
    matrix = defaultdict(lambda: defaultdict(int))
    for pred, true in zip(predictions, gold):
        matrix[true][pred] += 1

    # Get categories that appear in data
    cats_in_data = sorted(set(gold) | set(predictions))

    # Print header
    header = ['True\\Pred'] + cats_in_data
    col_width = max(15, max(len(c) for c in cats_in_data) + 2)

    print(f"{'True\\Pred':<15}", end='')
    for cat in cats_in_data:
        print(f"{cat:<{col_width}}", end='')
    print()

    # Print rows
    for true_cat in cats_in_data:
        print(f"{true_cat:<15}", end='')
        for pred_cat in cats_in_data:
            count = matrix[true_cat][pred_cat]
            print(f"{count:<{col_width}}", end='')
        print()


def check_confidence_calibration(samples: list, predictions: list, confidences: list):
    """Check if confidence scores are well-calibrated."""
    print("\nCONFIDENCE CALIBRATION")
    print("-" * 40)

    # Group by confidence level
    conf_buckets = defaultdict(list)
    for sample, pred, conf in zip(samples, predictions, confidences):
        gold = sample['gold_category']
        correct = 1 if pred == gold else 0
        bucket = (conf // 5) * 5  # Round to nearest 5
        conf_buckets[bucket].append(correct)

    print(f"{'Confidence':<12} {'Actual Acc':<12} {'Count':<8} {'Calibration'}")
    for conf in sorted(conf_buckets.keys(), reverse=True):
        results = conf_buckets[conf]
        actual = sum(results) / len(results) if results else 0
        expected = conf / 100
        diff = actual - expected
        status = "OK" if abs(diff) <= 0.10 else ("overconfident" if diff < 0 else "underconfident")
        print(f"{conf}%         {actual:.0%}          {len(results):<8} {status}")


def list_errors(samples: list, predictions: list, confidences: list, limit: int = 20):
    """List misclassified projects for error analysis."""
    print(f"\nERRORS (first {limit})")
    print("-" * 80)

    errors = []
    for sample, pred, conf in zip(samples, predictions, confidences):
        gold = sample['gold_category']
        if pred != gold:
            errors.append({
                'app_id': sample['application_id'],
                'title': sample['title'][:60],
                'predicted': pred,
                'gold': gold,
                'confidence': conf
            })

    for i, err in enumerate(errors[:limit], 1):
        print(f"{i}. [{err['predicted']} @ {err['confidence']}%] should be [{err['gold']}]")
        print(f"   {err['title']}...")
        print()


def main():
    print("=" * 60)
    print("VALIDATE CLASSIFIER")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    # Load validation set
    validation_file = 'validation/samples_to_label.csv'
    if not os.path.exists(validation_file):
        print(f"ERROR: {validation_file} not found")
        print("Run export_validation_samples.py first, then label the samples")
        sys.exit(1)

    samples = load_validation_set(validation_file)
    if not samples:
        print("ERROR: No labeled samples found in validation set")
        print("Fill in the 'gold_category' column for at least some rows")
        sys.exit(1)

    print(f"Loaded {len(samples)} labeled samples\n")

    # Run classifier on each sample
    predictions = []
    confidences = []
    gold_labels = []

    for sample in samples:
        # Build project dict for classifier
        project = {
            'application_id': sample['application_id'],
            'title': sample.get('title', ''),
            'org_name': sample.get('org_name', ''),
            'activity_code': sample.get('activity_code', ''),
            'phr': ''
        }
        abstract = sample.get('abstract', '')

        result = classify_project(project, abstract)
        predictions.append(result['primary_category'])
        confidences.append(result['category_confidence'])
        gold_labels.append(sample['gold_category'])

    # Compute metrics
    metrics = compute_metrics(predictions, gold_labels)

    # Print results
    print("=" * 60)
    print("RESULTS")
    print("=" * 60)

    print(f"\nOverall Accuracy: {metrics['accuracy']:.1%}")
    print(f"Macro F1: {metrics['macro_f1']:.3f}")
    print(f"Weighted F1: {metrics['weighted_f1']:.3f}")

    print("\nPER-CATEGORY METRICS")
    print("-" * 60)
    print(f"{'Category':<18} {'Precision':<10} {'Recall':<10} {'F1':<10} {'Support'}")
    for cat in CATEGORIES:
        m = metrics[cat]
        if m['support'] > 0:
            print(f"{cat:<18} {m['precision']:.2f}       {m['recall']:.2f}       {m['f1']:.2f}       {m['support']}")

    print("\nCONFUSION MATRIX")
    print("-" * 60)
    print_confusion_matrix(predictions, gold_labels)

    check_confidence_calibration(samples, predictions, confidences)

    list_errors(samples, predictions, confidences)

    # Save detailed results
    results_file = 'validation/results.json'
    with open(results_file, 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'num_samples': len(samples),
            'accuracy': metrics['accuracy'],
            'macro_f1': metrics['macro_f1'],
            'weighted_f1': metrics['weighted_f1'],
            'per_category': {cat: metrics[cat] for cat in CATEGORIES}
        }, f, indent=2)

    print(f"\nDetailed results saved to {results_file}")


if __name__ == '__main__':
    main()
