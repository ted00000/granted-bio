#!/usr/bin/env python3
"""
QA script to find Core facility projects that should be infrastructure.

Core facilities should typically be classified as 'infrastructure' unless
they are training cores (training) or research cores doing actual research.

Usage:
    python qa_core_infrastructure.py                 # Show misclassified
    python qa_core_infrastructure.py --fix          # Reclassify to infrastructure
    python qa_core_infrastructure.py --export       # Export to CSV for review
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

# Core facility patterns - these in title indicate infrastructure
CORE_TITLE_PATTERNS = [
    ' core',           # "Data Science Core", "Imaging Core"
    'core:',           # "Core: Biostatistics"
    'core -',          # "Core - Administration"
    'core a', 'core b', 'core c', 'core d', 'core e', 'core f',  # Core A, Core B, etc.
    'shared resource',
    'shared facility',
    'service core',
    'support core',
    'resource core',
]

# False positives - words containing "core" that aren't core facilities
NOT_CORE_PATTERNS = [
    'coreceptor', 'co-receptor', 'score', 'encore', 'hardcore',
    'scorecard', 'underscor', 'core of', 'core domain', 'core protein',
    'core region', 'core sequence', 'core element', 'core structure',
    'core complex', 'core subunit', 'core gene', 'catalytic core',
    'ribosomal core', 'nucleocapsid core', 'viral core', 'hiv core',
    'promoter core', 'enhancer core', 'transcriptional core',
]

# These cores should be infrastructure
INFRASTRUCTURE_CORE_TYPES = [
    'administrative', 'admin', 'coordination', 'coordinating', 'management',
    'data science', 'data core', 'data management', 'bioinformatics',
    'biostatistics', 'statistics', 'statistical',
    'imaging', 'microscopy', 'mri', 'pet', 'ct imaging',
    'genomics', 'sequencing', 'proteomics', 'metabolomics',
    'histopathology', 'pathology', 'histology',
    'flow cytometry', 'cytometry', 'facs',
    'biospecimen', 'biorepository', 'biobank', 'tissue',
    'animal', 'mouse', 'zebrafish', 'model organism',
    'clinical samples', 'sample processing',
    'technology', 'tech core',
    'resource', 'shared',
    'mass spectrometry', 'mass spec',
    'structural biology', 'x-ray', 'crystallography', 'cryo-em',
    'nanoparticle', 'nanotechnology',
    'medicinal chemistry', 'chemistry core',
    'assay development', 'screening', 'hts',
    'bioassay', 'assay core',
    'molecular biology', 'cloning',
    'viral vector', 'vector core', 'aav',
    'antibody', 'hybridoma',
    'cell culture', 'tissue culture',
    'pharmacology', 'pharmacokinetics', 'pk/pd',
    'analytical', 'analysis core',
    'in vitro', 'in vivo',
    'metabolism', 'metabolic',
    'immune monitoring', 'immunology core',
    'biomolecular', 'biochemistry',
]

# These cores should be training
TRAINING_CORE_TYPES = [
    'training', 'mentoring', 'career development', 'education',
    'research experience', 'career', 'professional development',
    'investigator development', 'trainee', 'fellow',
]

# These might be actual research, not cores - be careful
RESEARCH_INDICATORS = [
    'we hypothesize', 'our hypothesis', 'specific aim',
    'this study', 'our research', 'this research',
    'investigate', 'elucidate', 'determine the mechanism',
]


def is_true_core(title, abstract):
    """
    Determine if this is a true core facility vs research with 'core' in name.
    Returns: ('infrastructure', confidence) or ('training', confidence) or None
    """
    title_lower = title.lower()
    abstract_lower = (abstract or '').lower()
    text = title_lower + ' ' + abstract_lower

    # Check for false positives first
    if any(fp in title_lower for fp in NOT_CORE_PATTERNS):
        return None

    # Check if title has core pattern
    has_core_pattern = any(p in title_lower for p in CORE_TITLE_PATTERNS)
    if not has_core_pattern:
        return None

    # Check if abstract has research framing (might be actual research, not core)
    research_framing = sum(1 for r in RESEARCH_INDICATORS if r in abstract_lower)
    if research_framing >= 2:
        return None  # Likely actual research, not a core

    # Check for training core
    is_training = any(t in text for t in TRAINING_CORE_TYPES)
    if is_training:
        return ('training', 80)

    # Check for infrastructure core types
    is_infrastructure = any(t in text for t in INFRASTRUCTURE_CORE_TYPES)
    if is_infrastructure:
        return ('infrastructure', 85)

    # Generic core without specific type - assume infrastructure
    if has_core_pattern:
        return ('infrastructure', 70)

    return None


def main():
    parser = argparse.ArgumentParser(description='QA Core→infrastructure misclassifications')
    parser.add_argument('--fix', action='store_true', help='Reclassify cores')
    parser.add_argument('--export', action='store_true', help='Export to CSV for review')
    parser.add_argument('--min-confidence', type=int, default=75, help='Min confidence to auto-fix')
    args = parser.parse_args()

    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not url or not key:
        print("Error: Missing SUPABASE env vars")
        sys.exit(1)

    supabase = create_client(url, key)

    print("Fetching projects with 'Core' in title...")

    # Find projects with 'Core' that are NOT already infrastructure or training
    # Paginate through ALL projects in smaller batches to avoid timeout
    projects = []
    page_size = 500
    offset = 0

    while True:
        response = supabase.table('projects').select(
            'application_id, project_number, title, fiscal_year, org_name, primary_category, total_cost'
        ).ilike('title', '%core%').not_.in_(
            'primary_category', ['infrastructure', 'training']
        ).range(offset, offset + page_size - 1).execute()

        batch = response.data or []
        if not batch:
            break

        projects.extend(batch)
        print(f"  Fetched {len(projects)} so far...")
        offset += page_size

        if len(batch) < page_size:
            break

    print(f"Found {len(projects)} projects with 'Core' to check\n")

    # Fetch abstracts
    app_ids = [p['application_id'] for p in projects]
    abstracts_map = {}
    batch_size = 100
    for i in range(0, len(app_ids), batch_size):
        batch = app_ids[i:i+batch_size]
        abs_response = supabase.table('abstracts').select(
            'application_id, abstract_text'
        ).in_('application_id', batch).execute()
        for a in (abs_response.data or []):
            abstracts_map[a['application_id']] = a.get('abstract_text', '') or ''

    # Analyze each project
    misclassified = []
    for p in projects:
        title = p.get('title', '')
        abstract = abstracts_map.get(p['application_id'], '')

        result = is_true_core(title, abstract)
        if result:
            new_category, confidence = result
            if new_category != p.get('primary_category'):
                misclassified.append({
                    'application_id': p['application_id'],
                    'project_number': p.get('project_number'),
                    'title': title,
                    'fiscal_year': p.get('fiscal_year'),
                    'org_name': p.get('org_name'),
                    'current_category': p.get('primary_category'),
                    'new_category': new_category,
                    'confidence': confidence,
                })

    # Sort by confidence
    misclassified.sort(key=lambda x: x['confidence'], reverse=True)

    print(f"Found {len(misclassified)} misclassified Core projects\n")
    print("=" * 100)

    # Group by new category
    to_infrastructure = [m for m in misclassified if m['new_category'] == 'infrastructure']
    to_training = [m for m in misclassified if m['new_category'] == 'training']

    print(f"\n→ {len(to_infrastructure)} should be INFRASTRUCTURE")
    print(f"→ {len(to_training)} should be TRAINING\n")

    # Display results
    for i, p in enumerate(misclassified[:40], 1):
        print(f"{i}. [{p['confidence']}%] {p['current_category']} → {p['new_category']}")
        print(f"   {p['title'][:75]}...")
        print(f"   {p['org_name']} | FY{p['fiscal_year']}")
        print()

    if len(misclassified) > 40:
        print(f"... and {len(misclassified) - 40} more")

    # Export to CSV
    if args.export:
        filename = f"qa_core_infrastructure_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        with open(filename, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'application_id', 'project_number', 'title', 'fiscal_year',
                'org_name', 'current_category', 'new_category', 'confidence'
            ])
            writer.writeheader()
            writer.writerows(misclassified)
        print(f"\n✓ Exported to {filename}")

    # Fix mode
    if args.fix and misclassified:
        # Only fix high-confidence ones
        to_fix = [p for p in misclassified if p['confidence'] >= args.min_confidence]

        if not to_fix:
            print(f"\n⚠️  No fixes with confidence >= {args.min_confidence}%")
            return

        print(f"\n\nReclassifying {len(to_fix)} high-confidence projects...")

        for p in to_fix:
            supabase.table('projects').update({
                'primary_category': p['new_category'],
                'primary_category_confidence': p['confidence'],
            }).eq('application_id', p['application_id']).execute()
            print(f"  ✓ {p['application_id']}: {p['current_category']} → {p['new_category']} | {p['title'][:50]}...")

        print(f"\n✓ Reclassified {len(to_fix)} projects")


if __name__ == '__main__':
    main()
