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


def process_patents_csv(filepath: str, limit: Optional[int] = None) -> tuple[list[Dict[str, Any]], list[Dict[str, str]]]:
    """
    Process the NIH RePORTER patents CSV file.

    Args:
        filepath: Path to the CSV file
        limit: Optional limit on number of rows to process

    Returns:
        Tuple of (patents list, patent_links list)
        - patents: unique patent records (metadata only)
        - patent_links: project_number -> patent_id mappings
    """
    count = 0
    patents_dict: Dict[str, Dict[str, Any]] = {}
    patent_links: list[Dict[str, str]] = []
    seen_links: set = set()

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        for row in reader:
            count += 1

            patent_id = row.get('PATENT_ID')
            project_number = row.get('PROJECT_ID')

            if not patent_id:
                continue

            # Track unique patents (metadata only, no project_number)
            if patent_id not in patents_dict:
                patent_title = row.get('PATENT_TITLE', '')
                classification = classify_patent(patent_title)

                patents_dict[patent_id] = {
                    'patent_id': patent_id,
                    'patent_title': patent_title,
                    'patent_org': row.get('PATENT_ORG_NAME'),
                    **classification,
                }

            # Track patent-project links (many-to-many)
            if project_number:
                link_key = (project_number, patent_id)
                if link_key not in seen_links:
                    seen_links.add(link_key)
                    patent_links.append({
                        'project_number': project_number,
                        'patent_id': patent_id,
                    })

            if limit and len(patents_dict) >= limit:
                break

    patents = list(patents_dict.values())
    print(f"Processed {count} rows, {len(patents)} unique patents, {len(patent_links)} links")
    return patents, patent_links


def load_patents(data_dir: str = 'data/raw', limit: Optional[int] = None) -> tuple[list, list]:
    """
    Load and process all patents from the CSV file.

    Returns:
        Tuple of (patents, patent_links)
        - patents: unique patent records (metadata only)
        - patent_links: project_number -> patent_id mappings for junction table
    """
    filepath = os.path.join(data_dir, 'Patents.csv')

    if not os.path.exists(filepath):
        print(f"Warning: Patents file not found: {filepath}")
        return [], []

    patents, patent_links = process_patents_csv(filepath, limit)

    # Count unique projects
    unique_projects = set(link['project_number'] for link in patent_links)

    print(f"Loaded {len(patents)} patents linked to {len(unique_projects)} projects")

    return patents, patent_links


if __name__ == '__main__':
    # Test with a small sample
    patents, patent_links = load_patents(limit=500)

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
        print("\nSample patent (metadata only):")
        for key, value in patents[0].items():
            print(f"  {key}: {value}")

    # Print sample link
    if patent_links:
        print("\nSample patent link:")
        for key, value in patent_links[0].items():
            print(f"  {key}: {value}")
