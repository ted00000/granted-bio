"""
Process NIH RePORTER clinical studies CSV file.
Classifies trials as diagnostic vs therapeutic.
"""

import csv
import os
from typing import Generator, Dict, Any, Optional

# Diagnostic trial keywords
DIAGNOSTIC_KEYWORDS = [
    'diagnostic', 'detection', 'screening', 'imaging',
    'biomarker', 'test', 'assay', 'monitoring',
    'device trial', 'feasibility',
]

# Therapeutic trial keywords (default assumption)
THERAPEUTIC_KEYWORDS = [
    'treatment', 'therapy', 'therapeutic', 'drug',
    'phase i', 'phase ii', 'phase iii', 'phase 1', 'phase 2', 'phase 3',
    'efficacy', 'safety', 'dose', 'dosing',
    'randomized', 'placebo', 'controlled trial',
]


def classify_clinical_study(study_title: str) -> Dict[str, bool]:
    """
    Classify a clinical study based on its title.

    Returns dict with is_diagnostic_trial, is_therapeutic_trial
    """
    title_lower = (study_title or '').lower()

    is_diagnostic = any(kw in title_lower for kw in DIAGNOSTIC_KEYWORDS)
    is_therapeutic = any(kw in title_lower for kw in THERAPEUTIC_KEYWORDS)

    # If neither is detected, default to therapeutic (most common)
    if not is_diagnostic and not is_therapeutic:
        is_therapeutic = True

    return {
        'is_diagnostic_trial': is_diagnostic,
        'is_therapeutic_trial': is_therapeutic and not is_diagnostic,
    }


def process_clinical_studies_csv(filepath: str, limit: Optional[int] = None) -> Generator[Dict[str, Any], None, None]:
    """
    Process the NIH RePORTER clinical studies CSV file.

    Args:
        filepath: Path to the CSV file
        limit: Optional limit on number of rows to process

    Yields:
        Processed clinical study dictionaries ready for database insertion
    """
    count = 0
    seen_ncts: set = set()

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        for row in reader:
            count += 1

            nct_id = row.get('ClinicalTrials.gov ID')
            if not nct_id:
                continue

            # Allow duplicate NCT IDs for different projects
            study_key = f"{row.get('Core Project Number')}_{nct_id}"
            if study_key in seen_ncts:
                continue

            seen_ncts.add(study_key)

            study_title = row.get('Study', '')

            # Classify study
            classification = classify_clinical_study(study_title)

            clinical_study = {
                'project_number': row.get('Core Project Number'),
                'nct_id': nct_id,
                'study_title': study_title,
                'study_status': row.get('Study Status'),
                **classification,
            }

            yield clinical_study

            if limit and len(seen_ncts) >= limit:
                break

    print(f"Processed {count} rows, {len(seen_ncts)} unique clinical studies")


def load_clinical_studies(data_dir: str = 'data/raw', limit: Optional[int] = None) -> list:
    """
    Load and process all clinical studies from the CSV file.

    Returns:
        List of processed clinical study dictionaries
    """
    filepath = os.path.join(data_dir, 'ClinicalStudies.csv')

    if not os.path.exists(filepath):
        print(f"Warning: Clinical studies file not found: {filepath}")
        return []

    clinical_studies = list(process_clinical_studies_csv(filepath, limit))

    # Build project to clinical studies mapping
    project_clinical: Dict[str, list] = {}
    for study in clinical_studies:
        proj_num = study.get('project_number')
        if proj_num:
            if proj_num not in project_clinical:
                project_clinical[proj_num] = []
            project_clinical[proj_num].append(study)

    print(f"Loaded {len(clinical_studies)} clinical studies for {len(project_clinical)} projects")

    return clinical_studies


if __name__ == '__main__':
    # Test with a small sample
    clinical_studies = load_clinical_studies(limit=500)

    # Count study classifications
    diagnostic_count = sum(1 for s in clinical_studies if s['is_diagnostic_trial'])
    therapeutic_count = sum(1 for s in clinical_studies if s['is_therapeutic_trial'])

    print(f"\nClinical study classification:")
    print(f"  Diagnostic trials: {diagnostic_count}")
    print(f"  Therapeutic trials: {therapeutic_count}")

    # Print sample study
    if clinical_studies:
        print("\nSample clinical study:")
        for key, value in clinical_studies[0].items():
            print(f"  {key}: {value}")
