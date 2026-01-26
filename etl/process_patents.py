"""
Process NIH RePORTER patents CSV file.
Classifies patents as device/therapeutic/method types.
"""

import csv
import os
from typing import Generator, Dict, Any, Optional

# Device/system patent keywords (biotools indicator)
DEVICE_KEYWORDS = [
    'device', 'system', 'apparatus', 'instrument', 'platform',
    'machine', 'equipment', 'sensor', 'detector', 'analyzer',
    'microarray', 'chip', 'biosensor', 'probe', 'assay system',
    'kit for', 'reagent kit', 'diagnostic kit',
]

# Therapeutic patent keywords (anti-biotools indicator)
THERAPEUTIC_KEYWORDS = [
    'treatment', 'treating', 'therapy', 'therapeutic',
    'compound for', 'composition for', 'formulation',
    'antibody', 'inhibitor', 'agonist', 'antagonist',
    'pharmaceutical', 'drug', 'vaccine',
    'method of treating', 'use of', 'administration',
]

# Method patent keywords
METHOD_KEYWORDS = [
    'method for', 'methods for', 'process for', 'technique',
    'protocol', 'procedure', 'assay', 'detection method',
    'screening method', 'diagnostic method',
]


def classify_patent(patent_title: str) -> Dict[str, bool]:
    """
    Classify a patent based on its title.

    Returns dict with is_device_patent, is_therapeutic_patent, is_method_patent
    """
    title_lower = (patent_title or '').lower()

    return {
        'is_device_patent': any(kw in title_lower for kw in DEVICE_KEYWORDS),
        'is_therapeutic_patent': any(kw in title_lower for kw in THERAPEUTIC_KEYWORDS),
        'is_method_patent': any(kw in title_lower for kw in METHOD_KEYWORDS),
    }


def process_patents_csv(filepath: str, limit: Optional[int] = None) -> Generator[Dict[str, Any], None, None]:
    """
    Process the NIH RePORTER patents CSV file.

    Args:
        filepath: Path to the CSV file
        limit: Optional limit on number of rows to process

    Yields:
        Processed patent dictionaries ready for database insertion
    """
    count = 0
    seen_patents: set = set()

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        for row in reader:
            count += 1

            patent_id = row.get('PATENT_ID')
            if not patent_id or patent_id in seen_patents:
                continue

            seen_patents.add(patent_id)

            patent_title = row.get('PATENT_TITLE', '')

            # Classify patent
            classification = classify_patent(patent_title)

            patent = {
                'patent_id': patent_id,
                'patent_title': patent_title,
                'project_number': row.get('PROJECT_ID'),
                'patent_org': row.get('PATENT_ORG_NAME'),
                **classification,
            }

            yield patent

            if limit and len(seen_patents) >= limit:
                break

    print(f"Processed {count} rows, {len(seen_patents)} unique patents")


def load_patents(data_dir: str = 'data/raw', limit: Optional[int] = None) -> list:
    """
    Load and process all patents from the CSV file.

    Returns:
        List of processed patent dictionaries
    """
    filepath = os.path.join(data_dir, 'Patents.csv')

    if not os.path.exists(filepath):
        print(f"Warning: Patents file not found: {filepath}")
        return []

    patents = list(process_patents_csv(filepath, limit))

    # Build project to patents mapping
    project_patents: Dict[str, list] = {}
    for patent in patents:
        proj_num = patent.get('project_number')
        if proj_num:
            if proj_num not in project_patents:
                project_patents[proj_num] = []
            project_patents[proj_num].append(patent)

    print(f"Loaded {len(patents)} patents for {len(project_patents)} projects")

    return patents


if __name__ == '__main__':
    # Test with a small sample
    patents = load_patents(limit=500)

    # Count patent classifications
    device_count = sum(1 for p in patents if p['is_device_patent'])
    therapeutic_count = sum(1 for p in patents if p['is_therapeutic_patent'])
    method_count = sum(1 for p in patents if p['is_method_patent'])

    print(f"\nPatent classification:")
    print(f"  Device patents: {device_count}")
    print(f"  Therapeutic patents: {therapeutic_count}")
    print(f"  Method patents: {method_count}")

    # Print sample patent
    if patents:
        print("\nSample patent:")
        for key, value in patents[0].items():
            print(f"  {key}: {value}")
