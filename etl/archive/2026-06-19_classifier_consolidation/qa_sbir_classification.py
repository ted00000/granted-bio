"""
QA Script: Fix SBIR misclassifications based on improved rules.

Target patterns:
1. "Development of [antibody/monoclonal/inhibitor/antagonist]" marked as biotools → therapeutics
2. "Platform for [patients/disease]" marked as biotools → therapeutics/medical_device
3. "System for [patients/treatment]" marked as biotools → therapeutics/medical_device

Run with --dry-run first to preview changes.
"""

import os
import re
import argparse
from dotenv import load_dotenv
import pathlib
load_dotenv(pathlib.Path(__file__).parent.parent / '.env.local')

from supabase import create_client

# Initialize client
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

# SBIR activity codes
SBIR_CODES = ['R41', 'R42', 'R43', 'R44', 'SB1', 'U44']

# Patterns that indicate therapeutics, NOT biotools
THERAPEUTICS_TITLE_PATTERNS = [
    r'development of\s+(highly\s+)?potent\s+',
    r'development of\s+(a\s+)?(human\s+)?monoclonal',
    r'development of\s+(a\s+)?antibod',
    r'development of\s+(a\s+)?(small\s+molecule\s+)?inhibitor',
    r'development of\s+(a\s+)?antagonist',
    r'development of\s+(a\s+)?agonist',
    r'development of\s+(a\s+)?vaccine',
    r'development of\s+(a\s+)?biologic',
    r'development of\s+(a\s+)?therapy',
    r'development of\s+(a\s+)?treatment',
    r'development of\s+(a\s+)?drug',
    r'development of\s+anticoagulant',
    r'development of\s+anti-',
    r'immunoprophylaxis',
    r'immunotherapy\s+for',
]

# Patient-context patterns (should not be biotools)
# These indicate patient/clinician-facing tools, NOT research tools
PATIENT_CONTEXT_PATTERNS = [
    r'platform\s+for\s+\w*\s*patients',
    r'system\s+for\s+\w*\s*patients',
    r'neurorehabilitation\s+platform',
    r'rehabilitation\s+platform',
    r'tele-?rehabilitation',
    r'assistive\s+platform',
    r'prosthetic',
    r'robotic\s+platform\s+for\s+\w*\s*(patient|treatment|therapy)',
]

# Digital health patterns (platform for clinicians/care)
DIGITAL_HEALTH_PATTERNS = [
    r'econsult\s+platform',
    r'telemedicine\s+platform',
    r'telehealth\s+platform',
    r'remote\s+patient\s+monitoring',
    r'clinical\s+decision\s+support',
    r'care\s+management\s+platform',
    r'mhealth\s+app',
]


def should_be_therapeutics(title):
    """Check if a title matches therapeutics patterns."""
    title_lower = title.lower()
    for pattern in THERAPEUTICS_TITLE_PATTERNS:
        if re.search(pattern, title_lower):
            return True, pattern
    return False, None


def has_patient_context(title):
    """Check if title has patient context (not for researchers)."""
    title_lower = title.lower()
    for pattern in PATIENT_CONTEXT_PATTERNS:
        if re.search(pattern, title_lower):
            return True, pattern
    return False, None


def is_digital_health(title):
    """Check if title indicates digital health category."""
    title_lower = title.lower()
    for pattern in DIGITAL_HEALTH_PATTERNS:
        if re.search(pattern, title_lower):
            return True, pattern
    return False, None


def fetch_sbir_biotools():
    """Fetch all SBIR projects currently classified as biotools."""
    print("Fetching SBIR projects currently classified as biotools...")

    all_projects = []
    page_size = 1000
    offset = 0

    while True:
        result = supabase.table('projects').select(
            'application_id, title, primary_category, activity_code'
        ).in_(
            'activity_code', SBIR_CODES
        ).eq(
            'primary_category', 'biotools'
        ).range(offset, offset + page_size - 1).execute()

        if not result.data:
            break

        all_projects.extend(result.data)

        if len(result.data) < page_size:
            break

        offset += page_size

    print(f"Found {len(all_projects)} SBIR biotools projects to analyze")
    return all_projects


def analyze_projects(projects):
    """Analyze projects for misclassification."""
    misclassified = []

    for p in projects:
        title = p.get('title', '')
        app_id = p.get('application_id')

        # Check if should be therapeutics
        is_therapeutic, pattern = should_be_therapeutics(title)
        if is_therapeutic:
            misclassified.append({
                'application_id': app_id,
                'title': title,
                'current_category': 'biotools',
                'suggested_category': 'therapeutics',
                'reason': f'Matched pattern: {pattern}',
                'pattern_type': 'therapeutics_title'
            })
            continue

        # Check for digital health patterns first
        is_dh, pattern = is_digital_health(title)
        if is_dh:
            misclassified.append({
                'application_id': app_id,
                'title': title,
                'current_category': 'biotools',
                'suggested_category': 'digital_health',
                'reason': f'Digital health: {pattern}',
                'pattern_type': 'digital_health'
            })
            continue

        # Check for patient context
        has_patient, pattern = has_patient_context(title)
        if has_patient:
            misclassified.append({
                'application_id': app_id,
                'title': title,
                'current_category': 'biotools',
                'suggested_category': 'therapeutics',  # Could also be medical_device
                'reason': f'Patient context: {pattern}',
                'pattern_type': 'patient_context'
            })

    return misclassified


def update_classifications(misclassified, dry_run=True):
    """Update database classifications."""
    if dry_run:
        print("\n" + "=" * 70)
        print("DRY RUN - No changes will be made")
        print("=" * 70)

    category_counts = {}

    for item in misclassified:
        app_id = item['application_id']
        new_category = item['suggested_category']
        title = item['title'][:70] + '...' if len(item['title']) > 70 else item['title']

        print(f"\n{item['current_category']} → {new_category}")
        print(f"  ID: {app_id}")
        print(f"  Title: {title}")
        print(f"  Reason: {item['reason']}")

        category_counts[new_category] = category_counts.get(new_category, 0) + 1

        if not dry_run:
            try:
                supabase.table('projects').update({
                    'primary_category': new_category,
                    'biotools_reasoning': f"QA reclassified: {item['reason']}"
                }).eq('application_id', app_id).execute()
                print(f"  ✓ Updated")
            except Exception as e:
                print(f"  ✗ Error: {e}")

    print("\n" + "=" * 70)
    print(f"Summary: {len(misclassified)} projects need reclassification")
    for cat, count in sorted(category_counts.items()):
        print(f"  → {count} to {cat}")
    print("=" * 70)

    if dry_run:
        print("\nRun with --apply to make changes")


def main():
    parser = argparse.ArgumentParser(description='QA SBIR classification')
    parser.add_argument('--apply', action='store_true', help='Apply changes (default is dry run)')
    args = parser.parse_args()

    # Fetch current biotools
    projects = fetch_sbir_biotools()

    if not projects:
        print("No SBIR biotools projects found.")
        return

    # Analyze for misclassifications
    misclassified = analyze_projects(projects)

    if not misclassified:
        print("\nNo misclassifications found. All SBIR biotools look correct!")
        return

    # Update (or preview)
    update_classifications(misclassified, dry_run=not args.apply)


if __name__ == '__main__':
    main()
