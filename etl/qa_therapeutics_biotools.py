#!/usr/bin/env python3
"""
QA script to find therapeutics projects that should be biotools.

Looks for obvious biotools keywords in title/abstract of projects
currently classified as therapeutics.

Usage:
    python qa_therapeutics_biotools.py                 # Show misclassified
    python qa_therapeutics_biotools.py --fix          # Reclassify to biotools
    python qa_therapeutics_biotools.py --export       # Export to CSV for review
"""

import os
import sys
import argparse
import csv
from datetime import datetime
from dotenv import load_dotenv

sys.stdout.reconfigure(line_buffering=True)

load_dotenv('../.env.local')

from supabase import create_client

# VERY strong biotools signals in TITLE (highest confidence - worth 3 points)
TITLE_BIOTOOLS_VERY_STRONG = [
    'software tool',
    'computational tool',
    'computational tools',
    'bioinformatics tool',
    'bioinformatics pipeline',
    'web-based tool',
    'web tool',
    'machine learning tool',
    'ai tool',
    'algorithm for',
    'algorithms for',
    'software platform',
    'analysis software',
    'open-source software',
    'open source software',
]

# Strong biotools signals in TITLE (very high confidence - worth 2 points)
TITLE_BIOTOOLS_STRONG = [
    'platform for',
    'platform to',
    'a platform',
    'novel platform',
    'new platform',
    'pipeline for',
    'pipeline to',
    'tool for',
    'tools for',
    'toolkit for',
    'toolkit to',
    'method for',
    'methods for',
    'novel method',
    'new method',
    'assay for',
    'assay development',
    'assay platform',
    'high-throughput',
    'high throughput',
    'software for',
    'software to',
    'database of',
    'database for',
    'atlas of',
    'resource for',
    'web-based tool',
    'web tool',
    'computational tool',
    'computational platform',
    'computational pipeline',
    'bioinformatics tool',
    'bioinformatics pipeline',
    'sequencing method',
    'imaging method',
    'screening platform',
    'screening tool',
    'screening assay',
    'profiling platform',
    'data resource',
    'technology platform',
    'technology for',
    'technologies for',
    'enabling technology',
    'user-friendly',
]

# Additional biotools signals in abstract (moderate confidence)
ABSTRACT_BIOTOOLS = [
    'develop a platform',
    'develop a tool',
    'develop a method',
    'develop a pipeline',
    'develop software',
    'create a platform',
    'create a tool',
    'build a platform',
    'build a pipeline',
    'establish a platform',
    'novel platform',
    'innovative platform',
    'high-throughput screening',
    'automated pipeline',
    'publicly available',
    'open source',
    'open-source',
    'made available to',
    'community resource',
    'shared resource',
    'disseminate',
    'web server',
    'web-based',
    'downloadable',
    'user-friendly interface',
]

# NEGATIVE signals - if present, likely NOT biotools (truly therapeutics)
THERAPEUTICS_STRONG = [
    'clinical trial',
    'phase i',
    'phase ii',
    'phase iii',
    'phase 1',
    'phase 2',
    'phase 3',
    'fda approval',
    'ind-enabling',
    'ind enabling',
    'preclinical development',
    'therapeutic development',
    'drug development',
    'lead optimization',
    'drug candidate',
    'therapeutic candidate',
    'toxicology',
    'pharmacokinetic',
    'pharmacodynamic',
    'dose escalation',
    'clinical efficacy',
    'treat patient',
    'treating patient',
    'treatment of patient',
    'patient treatment',
]


def main():
    parser = argparse.ArgumentParser(description='QA therapeutics→biotools misclassifications')
    parser.add_argument('--fix', action='store_true', help='Reclassify to biotools')
    parser.add_argument('--export', action='store_true', help='Export to CSV for review')
    parser.add_argument('--limit', type=int, default=0, help='Max projects to check (0=all)')
    parser.add_argument('--min-score', type=int, default=2, help='Min biotools signals to flag')
    args = parser.parse_args()

    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not url or not key:
        print("Error: Missing SUPABASE env vars")
        sys.exit(1)

    supabase = create_client(url, key)

    print(f"Fetching therapeutics projects...")

    # Paginate through all therapeutics projects
    projects = []
    page_size = 1000
    offset = 0

    while True:
        response = supabase.table('projects').select(
            'application_id, project_number, title, fiscal_year, org_name, total_cost, primary_category_confidence'
        ).eq('primary_category', 'therapeutics').order(
            'fiscal_year', desc=True
        ).range(offset, offset + page_size - 1).execute()

        batch = response.data or []
        if not batch:
            break

        projects.extend(batch)
        offset += page_size

        if len(batch) < page_size:
            break

        if args.limit and len(projects) >= args.limit:
            projects = projects[:args.limit]
            break

    print(f"Found {len(projects)} therapeutics projects to check\n")

    # Fetch abstracts for these projects
    app_ids = [p['application_id'] for p in projects]

    # Batch fetch abstracts
    abstracts_map = {}
    batch_size = 100
    for i in range(0, len(app_ids), batch_size):
        batch = app_ids[i:i+batch_size]
        abs_response = supabase.table('abstracts').select(
            'application_id, abstract_text'
        ).in_('application_id', batch).execute()
        for a in (abs_response.data or []):
            abstracts_map[a['application_id']] = a.get('abstract_text', '') or ''

    # Check each project
    misclassified = []

    for p in projects:
        title = (p.get('title') or '').lower()
        abstract = abstracts_map.get(p['application_id'], '').lower()
        text = title + ' ' + abstract

        # Count biotools signals - very strong title signals (3 pts each)
        very_strong_hits = []
        for signal in TITLE_BIOTOOLS_VERY_STRONG:
            if signal in title:
                very_strong_hits.append(signal)

        # Strong title signals (2 pts each)
        title_hits = []
        for signal in TITLE_BIOTOOLS_STRONG:
            if signal in title:
                title_hits.append(signal)

        abstract_hits = []
        for signal in ABSTRACT_BIOTOOLS:
            if signal in abstract:
                abstract_hits.append(signal)

        # Check for therapeutics signals (reduces score)
        tx_hits = []
        for signal in THERAPEUTICS_STRONG:
            if signal in text:
                tx_hits.append(signal)

        # Score: very strong = 3pts, strong = 2pts, abstract = 1pt
        score = len(very_strong_hits) * 3 + len(title_hits) * 2 + len(abstract_hits)

        # Reduce score if therapeutics signals present
        if tx_hits:
            score = score - len(tx_hits) * 2

        if score >= args.min_score:
            # Combine very_strong and strong hits for display
            all_title_hits = very_strong_hits + title_hits
            misclassified.append({
                'application_id': p['application_id'],
                'project_number': p.get('project_number'),
                'title': p.get('title'),
                'fiscal_year': p.get('fiscal_year'),
                'org_name': p.get('org_name'),
                'total_cost': p.get('total_cost'),
                'confidence': p.get('primary_category_confidence'),
                'score': score,
                'title_hits': all_title_hits,
                'abstract_hits': abstract_hits,
                'tx_hits': tx_hits,
            })

    # Sort by score descending
    misclassified.sort(key=lambda x: x['score'], reverse=True)

    print(f"Found {len(misclassified)} likely misclassified projects\n")
    print("=" * 100)

    # Display results
    for i, p in enumerate(misclassified[:50], 1):
        print(f"\n{i}. [{p['score']} pts] {p['title'][:80]}...")
        print(f"   App ID: {p['application_id']} | FY{p['fiscal_year']} | {p['org_name']}")
        print(f"   Title signals: {', '.join(p['title_hits']) if p['title_hits'] else 'none'}")
        print(f"   Abstract signals: {', '.join(p['abstract_hits'][:5]) if p['abstract_hits'] else 'none'}")
        if p['tx_hits']:
            print(f"   ⚠️  TX signals (might be valid): {', '.join(p['tx_hits'][:3])}")

    if len(misclassified) > 50:
        print(f"\n... and {len(misclassified) - 50} more")

    # Export to CSV
    if args.export:
        filename = f"qa_therapeutics_biotools_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        with open(filename, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'application_id', 'project_number', 'title', 'fiscal_year',
                'org_name', 'total_cost', 'confidence', 'score', 'title_hits', 'abstract_hits', 'tx_hits'
            ])
            writer.writeheader()
            for p in misclassified:
                row = {**p}
                row['title_hits'] = '; '.join(p['title_hits'])
                row['abstract_hits'] = '; '.join(p['abstract_hits'])
                row['tx_hits'] = '; '.join(p['tx_hits'])
                writer.writerow(row)
        print(f"\n✓ Exported to {filename}")

    # Fix mode
    if args.fix and misclassified:
        # Only fix high-confidence ones (score >= 4, no therapeutics signals)
        to_fix = [p for p in misclassified if p['score'] >= 4 and not p['tx_hits']]

        if not to_fix:
            print("\n⚠️  No high-confidence fixes available (score >= 4 with no TX signals)")
            return

        print(f"\n\nReclassifying {len(to_fix)} high-confidence projects to biotools...")

        for p in to_fix:
            supabase.table('projects').update({
                'primary_category': 'biotools',
                'primary_category_confidence': 85,  # High confidence from QA
            }).eq('application_id', p['application_id']).execute()
            print(f"  ✓ {p['application_id']}: {p['title'][:60]}...")

        print(f"\n✓ Reclassified {len(to_fix)} projects to biotools")


if __name__ == '__main__':
    main()
