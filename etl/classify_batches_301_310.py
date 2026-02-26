#!/usr/bin/env python3
"""
Semantic classification of NIH grants from review batches 301-310.
Applies classification rules from PROJECT_PROMPT_SEMANTIC.md
"""

import csv
import re
import os

# Activity codes for deterministic classification
TRAINING_CODES = {
    'T32', 'T34', 'T35', 'T90', 'TL1', 'TL4',
    'F30', 'F31', 'F32', 'F33', 'F99',
    'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2',
    'D43', 'D71', 'R25', 'R90'
}

INFRASTRUCTURE_CODES = {
    'P30', 'P50', 'P51', 'S10', 'G20', 'U13', 'R13', 'U24', 'U2C'
}

SBIR_STTR_CODES = {'R41', 'R42', 'R43', 'R44', 'SB1', 'U44'}

# Multi-component codes that need content check for cores
MULTI_COMPONENT_CODES = {'P01', 'P20', 'P2C', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}

def get_org_type(org_name, activity_code):
    """Determine organization type."""
    org_upper = org_name.upper() if org_name else ''

    # SBIR/STTR = always company
    if activity_code in SBIR_STTR_CODES:
        return 'company'

    # Company indicators
    company_patterns = ['LLC', ' INC', 'CORP', 'THERAPEUTICS', 'BIOSCIENCES',
                       'PHARMACEUTICALS', 'BIOTECH', 'BIOPHARMA', 'PHARMA']
    for pattern in company_patterns:
        if pattern in org_upper:
            return 'company'

    # University indicators
    if 'UNIVERSITY' in org_upper or 'COLLEGE' in org_upper or 'SCHOOL OF' in org_upper or 'INSTITUTE OF TECHNOLOGY' in org_upper:
        return 'university'

    # Research institutes
    research_institutes = ['SCRIPPS', 'BROAD INSTITUTE', 'SALK', 'FRED HUTCH', 'HUTCHINSON',
                          'SLOAN KETTERING', 'DANA-FARBER', 'DANA FARBER', 'COLD SPRING HARBOR',
                          'JACKSON LAB', 'WISTAR', 'ALLEN INSTITUTE', 'STOWERS', 'WHITEHEAD',
                          'VAN ANDEL', 'RESEARCH INSTITUTE', 'INSTITUTE FOR']
    for inst in research_institutes:
        if inst in org_upper:
            return 'research_institute'

    # Hospital indicators
    hospital_patterns = ['HOSPITAL', 'MEDICAL CENTER', 'HEALTH SYSTEM', 'CLINIC', 'CHILDREN\'S']
    for pattern in hospital_patterns:
        if pattern in org_upper and 'UNIVERSITY' not in org_upper:
            return 'hospital'

    return 'other'


def is_core_or_admin(title, abstract):
    """Check if this is a core/admin component of a multi-component grant."""
    text = (title + ' ' + (abstract[:500] if abstract else '')).lower()
    core_patterns = [
        'administrative core', 'admin core', 'resource core', 'shared facility',
        'data core', 'biostatistics core', 'imaging core', 'service core',
        'support core', 'coordination core', 'biobank core', 'genomics core',
        'proteomics core', 'animal core', 'tissue core', 'pathology core'
    ]
    for pattern in core_patterns:
        if pattern in text:
            return 'infrastructure'

    mentoring_patterns = ['mentoring core', 'career development core', 'training core']
    for pattern in mentoring_patterns:
        if pattern in text:
            return 'training'

    return None


def classify_by_content(title, abstract, phr, activity_code, org_name):
    """Classify based on title, abstract, and public health relevance."""
    if not abstract or len(abstract.strip()) < 50:
        # No meaningful abstract - check if activity code gives us an answer
        if activity_code in TRAINING_CODES:
            return 'training', 95, '', get_org_type(org_name, activity_code), 'Activity code deterministic (no abstract)'
        if activity_code in INFRASTRUCTURE_CODES:
            return 'infrastructure', 95, '', get_org_type(org_name, activity_code), 'Activity code deterministic (no abstract)'
        return 'other', 0, '', get_org_type(org_name, activity_code), 'No abstract available'

    text = (title + ' ' + abstract + ' ' + (phr or '')).lower()
    title_lower = title.lower()

    org_type = get_org_type(org_name, activity_code)

    # SBIR/STTR: never basic_research
    is_sbir = activity_code in SBIR_STTR_CODES

    # Check for DEVELOPS vs USES patterns
    develops_patterns = [
        r'develop\w* (?:a |an |novel |new )?(?:assay|probe|platform|pipeline|tool|method|database|resource|model system)',
        r'creat\w* (?:a |an |novel |new )?(?:assay|probe|platform|pipeline|tool|method|database)',
        r'build\w* (?:a |an )?(?:platform|pipeline|database|tool)',
        r'novel (?:assay|probe|platform|method|pipeline|tool)',
        r'high-throughput (?:screening )?platform',
        r'computational (?:pipeline|tool|platform|method)',
        r'reference standard',
        r'establish\w* (?:a |an )?(?:pipeline|platform|database|resource)',
    ]

    is_develops = False
    for pattern in develops_patterns:
        if re.search(pattern, text):
            is_develops = True
            break

    # Strong biotools indicators in title
    biotools_title = any(term in title_lower for term in [
        'platform', 'pipeline', 'assay', 'novel probe', 'database',
        'resource', 'toolkit', 'software', 'algorithm development'
    ])

    # Therapeutics indicators
    therapeutics_indicators = [
        'drug discovery', 'drug development', 'clinical trial', 'phase i', 'phase ii', 'phase iii',
        'phase 1', 'phase 2', 'phase 3', 'gene therapy', 'cell therapy', 'car-t', 'car t',
        'vaccine development', 'immunotherapy', 'drug delivery', 'pharmacological',
        'therapeutic', 'treatment', 'optimize compound', 'lead optimization',
        'drug candidate', 'preclinical development', 'clinical efficacy',
        'small molecule', 'antibody drug', 'biologic', 'formulation'
    ]
    has_therapeutics = any(ind in text for ind in therapeutics_indicators)

    # Diagnostics indicators
    diagnostics_indicators = [
        'diagnostic', 'clinical test', 'biomarker panel', 'screening test',
        'companion diagnostic', 'point-of-care test', 'liquid biopsy',
        'early detection', 'clinical validation', 'sensitivity and specificity',
        'clinical biomarker'
    ]
    has_diagnostics = any(ind in text for ind in diagnostics_indicators)

    # Medical device indicators
    device_indicators = [
        'implant', 'prosthetic', 'surgical instrument', 'stent', 'catheter',
        'wearable device', 'tissue-engineered', 'brain-computer interface',
        'neural interface', 'medical device', 'bioresorbable'
    ]
    has_device = any(ind in text for ind in device_indicators)

    # Digital health indicators
    digital_indicators = [
        'telemedicine', 'mhealth', 'mobile app', 'mobile application',
        'clinical decision support', 'ehr', 'electronic health record',
        'remote monitoring', 'digital therapeutic', 'smartphone app',
        'web-based intervention', 'digital intervention'
    ]
    has_digital = any(ind in text for ind in digital_indicators)

    # Basic research indicators
    basic_indicators = [
        'mechanism', 'pathway', 'role of', 'understand', 'elucidate',
        'characterize', 'investigate', 'determine how', 'examine',
        'neural circuit', 'molecular basis', 'signaling', 'regulation'
    ]
    has_basic = any(ind in text for ind in basic_indicators)

    # Behavioral intervention (without drugs = other)
    behavioral_indicators = [
        'smoking cessation', 'weight management', 'lifestyle modification',
        'psychotherapy', 'mindfulness', 'cognitive behavioral therapy', 'cbt',
        'behavioral intervention', 'motivational interviewing',
        'community-based intervention', 'health education'
    ]
    has_behavioral = any(ind in text for ind in behavioral_indicators)

    # Drug indicators (to check if behavioral + drug = therapeutics)
    drug_indicators = ['drug', 'medication', 'pharmacotherapy', 'pharmacological',
                       'varenicline', 'bupropion', 'naltrexone', 'methadone']
    has_drug = any(ind in text for ind in drug_indicators)

    # Infrastructure/cohort indicators
    cohort_indicators = [
        'cohort study', 'longitudinal cohort', 'epidemiological',
        'health services research', 'health policy', 'implementation science',
        'health disparities', 'community health', 'occupational safety',
        'environmental health', 'registry', 'surveillance'
    ]
    has_cohort = any(ind in text for ind in cohort_indicators)

    # Classification logic
    secondary = ''

    # SBIR: classify by deliverable, never basic_research
    if is_sbir:
        if has_therapeutics:
            return 'therapeutics', 90, secondary, 'company', 'SBIR: therapeutic development'
        if has_diagnostics:
            return 'diagnostics', 90, secondary, 'company', 'SBIR: diagnostic development'
        if has_device:
            return 'medical_device', 90, secondary, 'company', 'SBIR: device development'
        if has_digital:
            return 'digital_health', 90, secondary, 'company', 'SBIR: digital health product'
        if is_develops or biotools_title:
            return 'biotools', 90, secondary, 'company', 'SBIR: tool/platform development'
        return 'therapeutics', 75, secondary, 'company', 'SBIR: assumed commercial product'

    # Check for develops patterns first (biotools)
    if is_develops or biotools_title:
        if has_therapeutics:
            secondary = 'therapeutics'
        elif has_diagnostics:
            secondary = 'diagnostics'
        return 'biotools', 85, secondary, org_type, 'Primary deliverable is a tool/platform/method'

    # Therapeutics
    if has_therapeutics and not has_behavioral:
        if has_basic:
            secondary = 'basic_research'
        return 'therapeutics', 85, secondary, org_type, 'Drug/treatment development focus'

    # Behavioral with drug = therapeutics
    if has_behavioral and has_drug:
        return 'therapeutics', 80, 'other', org_type, 'Behavioral + pharmacological intervention'

    # Diagnostics
    if has_diagnostics:
        if has_basic:
            secondary = 'basic_research'
        return 'diagnostics', 85, secondary, org_type, 'Clinical test/diagnostic development'

    # Medical device
    if has_device:
        return 'medical_device', 85, secondary, org_type, 'Medical device development'

    # Digital health
    if has_digital:
        return 'digital_health', 85, secondary, org_type, 'Digital health tool/app'

    # Behavioral without drugs = other
    if has_behavioral:
        return 'other', 85, '', org_type, 'Behavioral intervention without pharmacotherapy'

    # Cohort/epi/health services = other
    if has_cohort:
        return 'other', 80, '', org_type, 'Cohort study/health services research'

    # Default to basic_research if mechanisms/pathways focus
    if has_basic:
        return 'basic_research', 80, secondary, org_type, 'Mechanistic/biological understanding focus'

    # Uncertain - lean toward other
    return 'other', 65, '', org_type, 'No clear primary deliverable identified'


def classify_grant(row):
    """Main classification function for a single grant."""
    app_id = row.get('application_id', '')
    activity_code = row.get('activity_code', '').strip()
    title = row.get('title', '')
    abstract = row.get('abstract', '')
    phr = row.get('phr', '')
    org_name = row.get('org_name', '')

    # Step 1: Check activity code first
    if activity_code in TRAINING_CODES:
        return app_id, 'training', 95, '', get_org_type(org_name, activity_code), 'Activity code deterministic: training'

    if activity_code in INFRASTRUCTURE_CODES:
        return app_id, 'infrastructure', 95, '', get_org_type(org_name, activity_code), 'Activity code deterministic: infrastructure'

    # Step 2: Check for cores in multi-component grants
    if activity_code in MULTI_COMPONENT_CODES:
        core_type = is_core_or_admin(title, abstract)
        if core_type:
            conf = 85 if core_type == 'infrastructure' else 85
            return app_id, core_type, conf, '', get_org_type(org_name, activity_code), f'Core component: {core_type}'

    # Check for SEER
    if 'SEER' in (title + ' ' + (abstract or '')).upper():
        return app_id, 'infrastructure', 85, '', get_org_type(org_name, activity_code), 'SEER registry'

    # Step 3: Content-based classification
    primary, confidence, secondary, org_type, reasoning = classify_by_content(
        title, abstract, phr, activity_code, org_name
    )

    return app_id, primary, confidence, secondary, org_type, reasoning


def process_batch(filepath):
    """Process a single batch file."""
    results = []

    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            result = classify_grant(row)
            results.append(result)

    return results


def main():
    batch_dir = '/Users/tednunes/Projects/granted-bio/etl/review_batches'
    output_file = '/Users/tednunes/Projects/granted-bio/etl/semantic_results/semantic_301-310.csv'

    all_results = []

    for batch_num in range(301, 311):
        batch_file = os.path.join(batch_dir, f'review_batch_{batch_num:04d}.csv')
        print(f'Processing {batch_file}...')
        results = process_batch(batch_file)
        all_results.extend(results)
        print(f'  -> {len(results)} grants classified')

    # Write output
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['application_id', 'primary_category', 'category_confidence',
                        'secondary_category', 'org_type', 'reasoning'])
        for result in all_results:
            writer.writerow(result)

    print(f'\nTotal: {len(all_results)} grants classified')
    print(f'Output written to: {output_file}')

    # Print category distribution
    from collections import Counter
    categories = Counter(r[1] for r in all_results)
    print('\nCategory distribution:')
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f'  {cat}: {count}')


if __name__ == '__main__':
    main()
