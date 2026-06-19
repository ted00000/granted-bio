#!/usr/bin/env python3
"""
Semantic classifier for NIH grant projects.
Applies classification rules from PROJECT_PROMPT_SEMANTIC.md
"""

import csv
import re
import sys
from pathlib import Path

# Activity codes that always map to training (Step 1)
TRAINING_CODES = {
    'T32', 'T34', 'T35', 'T90', 'TL1', 'TL4',
    'F30', 'F31', 'F32', 'F33', 'F99',
    'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2',
    'D43', 'D71', 'R25', 'R90'
}

# Activity codes that always map to infrastructure (Step 1)
INFRASTRUCTURE_CODES = {
    'P30', 'P50', 'P51', 'S10', 'G20', 'U13', 'R13', 'U24', 'U2C'
}

# SBIR/STTR codes - commercial development, never basic_research
SBIR_STTR_CODES = {'R41', 'R42', 'R43', 'R44', 'SB1', 'U44'}

# Multi-component grant codes that may contain cores
MULTI_COMPONENT_CODES = {'P01', 'P20', 'P2C', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}

# Other special codes
SAFETY_TRAINING_CODES = {'U45', 'UH4'}  # worker safety training
FOOD_SAFETY_CODES = {'U2F'}  # food safety regulatory
BIOSAFETY_CODES = {'UC7'}  # biosafety labs
CLINICAL_TRIAL_NETWORK_CODES = {'UG1', 'U10'}


def classify_org_type(org_name, activity_code):
    """Classify organization type based on org name."""
    org_name_upper = org_name.upper() if org_name else ''

    # SBIR/STTR always company
    if activity_code in SBIR_STTR_CODES:
        return 'company'

    # Company indicators
    company_indicators = ['LLC', 'INC', 'CORP', 'THERAPEUTICS', 'BIOSCIENCES',
                          'PHARMACEUTICALS', 'BIOTECH', 'BIOPHARMA', 'PHARMA',
                          'TECHNOLOGIES', 'SCIENCES INC', 'LABS INC']
    for indicator in company_indicators:
        if indicator in org_name_upper:
            return 'company'

    # Research institutes
    research_institutes = ['SCRIPPS', 'BROAD INSTITUTE', 'SALK', 'FRED HUTCHINSON',
                           'SLOAN KETTERING', 'DANA-FARBER', 'COLD SPRING HARBOR',
                           'JACKSON LABORATORY', 'WISTAR', 'ALLEN INSTITUTE',
                           'STOWERS', 'WHITEHEAD', 'VAN ANDEL', 'INSTITUTE FOR',
                           'LA JOLLA INSTITUTE', 'RESEARCH INSTITUTE', 'BATTELLE']
    for inst in research_institutes:
        if inst in org_name_upper:
            return 'research_institute'

    # University
    uni_indicators = ['UNIVERSITY', 'UNIV ', 'UNIV.', 'COLLEGE', 'SCHOOL OF MEDICINE',
                      'INSTITUTE OF TECHNOLOGY', 'MIT', 'CALTECH']
    for indicator in uni_indicators:
        if indicator in org_name_upper:
            return 'university'

    # Hospital (check after university since some have "University Medical Center")
    hospital_indicators = ['HOSPITAL', 'MEDICAL CENTER', 'HEALTH SYSTEM', 'CLINIC',
                           'CHILDREN\'S', "CHILDREN'S", 'MAYO', 'MEMORIAL HEALTH',
                           'HEALTH CENTER', 'MEDICAL COLLEGE']
    for indicator in hospital_indicators:
        if indicator in org_name_upper:
            # But not if it starts with University
            if not any(u in org_name_upper[:15] for u in ['UNIVERSITY', 'UNIV']):
                return 'hospital'

    # Government/other
    gov_indicators = ['VA ', 'VETERANS', 'NIH', 'CDC', 'FDA', 'NATIONAL INSTITUTES']
    for indicator in gov_indicators:
        if indicator in org_name_upper:
            return 'other'

    return 'university'  # Default


def is_core_project(title, abstract):
    """Check if this is a core/support project within a multi-component grant."""
    text = (title + ' ' + abstract[:500]).lower()
    core_indicators = ['administrative core', 'resource core', 'shared facility',
                       'data core', 'biostatistics core', 'imaging core',
                       'service core', 'support core', 'shared resource',
                       'core facility', 'administrative/management core',
                       'bioinformatics core', 'proteomics core', 'genomics core']
    for indicator in core_indicators:
        if indicator in text:
            return True
    return False


def is_mentoring_core(title, abstract):
    """Check if this is a mentoring/career development core."""
    text = (title + ' ' + abstract[:500]).lower()
    mentoring_indicators = ['mentoring core', 'career development core',
                            'training core', 'education core']
    for indicator in mentoring_indicators:
        if indicator in text:
            return True
    return False


def classify_project(app_id, title, abstract, activity_code, org_name):
    """
    Apply semantic classification rules to determine primary category.
    Returns: (primary_category, confidence, secondary_category, org_type, reasoning)
    """
    title = title or ''
    abstract = abstract or ''
    activity_code = activity_code or ''
    org_name = org_name or ''

    org_type = classify_org_type(org_name, activity_code)

    # Handle no/minimal abstract
    if len(abstract.strip()) < 50:
        if activity_code in TRAINING_CODES:
            return ('training', 95, '', org_type, 'Activity code is training type')
        if activity_code in INFRASTRUCTURE_CODES:
            return ('infrastructure', 95, '', org_type, 'Activity code is infrastructure type')
        return ('other', 0, '', org_type, 'No abstract available')

    # STEP 1: Check activity code deterministic rules
    if activity_code in TRAINING_CODES:
        return ('training', 95, '', org_type, f'Activity code {activity_code} is always training')

    if activity_code in INFRASTRUCTURE_CODES:
        return ('infrastructure', 95, '', org_type, f'Activity code {activity_code} is always infrastructure')

    # STEP 2: Check for cores and non-research programs
    if activity_code in MULTI_COMPONENT_CODES:
        if is_core_project(title, abstract):
            return ('infrastructure', 83, '', org_type, 'Core/support project within multi-component grant')
        if is_mentoring_core(title, abstract):
            return ('training', 85, '', org_type, 'Mentoring/career development core')

    if activity_code in SAFETY_TRAINING_CODES:
        return ('training', 85, '', org_type, 'Worker safety training program')

    if activity_code in FOOD_SAFETY_CODES:
        return ('other', 85, '', org_type, 'Food safety regulatory')

    if 'SEER' in title.upper() or 'SEER' in abstract[:200].upper():
        return ('infrastructure', 85, '', org_type, 'SEER cancer registry')

    # STEP 3 & 4: Content-based classification
    text = (title + ' ' + abstract).lower()
    title_lower = title.lower()

    # Check SBIR/STTR first - never basic_research
    is_sbir = activity_code in SBIR_STTR_CODES

    # --- BIOTOOLS detection (DEVELOPS tools/methods/platforms) ---
    biotools_signals = [
        'develop a', 'develop an', 'developing a', 'developing an',
        'we will develop', 'novel assay', 'novel probe', 'novel platform',
        'high-throughput screening platform', 'computational pipeline',
        'computational tool', 'software tool', 'bioinformatics tool',
        'create a database', 'build a database', 'publicly available database',
        'reference standard', 'develop methods', 'novel method',
        'improved method', 'new assay', 'assay development',
        'platform development', 'tool development', 'reagent development',
        'develop and validate', 'development and validation',
        'new imaging method', 'imaging platform', 'imaging tool',
        'animal model as a', 'mouse model for distribution',
        'create a resource', 'community resource'
    ]

    develops_tool = any(signal in text for signal in biotools_signals)
    tool_in_title = any(word in title_lower for word in ['assay', 'platform', 'tool', 'pipeline', 'method', 'probe', 'resource', 'database'])

    # --- THERAPEUTICS detection ---
    therapeutics_signals = [
        'drug discovery', 'drug development', 'drug candidate',
        'lead compound', 'lead optimization', 'clinical trial',
        'phase i', 'phase ii', 'phase iii', 'phase 1', 'phase 2', 'phase 3',
        'car-t', 'car t', 'gene therapy', 'cell therapy',
        'vaccine development', 'immunotherapy', 'antibody therapy',
        'therapeutic antibody', 'therapeutic target', 'drug delivery',
        'drug efficacy', 'preclinical development', 'clinical efficacy',
        'hit-to-lead', 'structure-activity relationship',
        'pharmacokinetic', 'pharmacodynamic', 'therapeutic potential',
        'treatment of', 'treating', 'to treat', 'novel treatment',
        'drug repurposing', 'drug repositioning', 'small molecule inhibitor',
        'targeted therapy', 'combination therapy', 'adjuvant therapy'
    ]

    is_therapeutics = any(signal in text for signal in therapeutics_signals)

    # --- DIAGNOSTICS detection ---
    diagnostics_signals = [
        'diagnostic test', 'diagnostic assay', 'clinical test',
        'point-of-care', 'point of care', 'poc test', 'poc device',
        'biomarker panel for diagnosing', 'biomarker panel for diagnosis',
        'early detection', 'screening test', 'companion diagnostic',
        'liquid biopsy for detection', 'blood-based biomarker',
        'clinical validation of biomarker', 'validate a clinical',
        'diagnostic biomarker', 'prognostic biomarker'
    ]

    is_diagnostics = any(signal in text for signal in diagnostics_signals)

    # --- MEDICAL DEVICE detection ---
    device_signals = [
        'medical device', 'implant', 'prosthetic', 'surgical instrument',
        'stent', 'catheter', 'wearable device', 'wearable therapeutic',
        'tissue-engineered', 'tissue engineered', 'brain-computer interface',
        'neural interface', 'implantable', 'bioresorbable',
        'biomedical device', 'orthopedic device', 'cardiac device'
    ]

    is_device = any(signal in text for signal in device_signals)

    # --- DIGITAL HEALTH detection ---
    digital_signals = [
        'mobile app', 'mhealth', 'm-health', 'telemedicine', 'telehealth',
        'digital therapeutic', 'clinical decision support',
        'ehr tool', 'electronic health record', 'remote monitoring',
        'patient-facing software', 'clinician-facing',
        'health app', 'smartphone app', 'digital intervention',
        'web-based intervention', 'online intervention'
    ]

    is_digital = any(signal in text for signal in digital_signals)

    # --- BEHAVIORAL (should be OTHER) ---
    behavioral_signals = [
        'behavioral intervention', 'behavioral therapy',
        'cognitive behavioral', 'cbt', 'mindfulness',
        'motivational interviewing', 'smoking cessation',
        'weight management', 'lifestyle modification',
        'psychotherapy', 'counseling intervention',
        'stress reduction', 'health behavior'
    ]

    is_behavioral = any(signal in text for signal in behavioral_signals)
    has_drug_component = any(word in text for word in ['pharmacotherapy', 'medication', 'drug', 'varenicline', 'nicotine replacement', 'bupropion'])

    # --- BASIC RESEARCH signals ---
    basic_signals = [
        'mechanism', 'mechanisms of', 'mechanistic', 'pathway',
        'understand how', 'understanding how', 'elucidate',
        'role of', 'roles of', 'function of', 'functions of',
        'molecular basis', 'neural circuit', 'signaling pathway',
        'gene expression', 'regulation of', 'identify genes',
        'genome-wide', 'transcriptome', 'proteome', 'metabolome',
        'structure-function', 'protein structure', 'crystal structure',
        'how does', 'what role', 'molecular mechanisms',
        'cellular mechanisms', 'disease pathogenesis'
    ]

    is_basic = any(signal in text for signal in basic_signals)

    # --- OTHER signals (health services, epidemiology, etc.) ---
    other_signals = [
        'health services research', 'health policy', 'implementation science',
        'health disparities', 'community health', 'epidemiological',
        'cohort study', 'longitudinal cohort', 'population health',
        'occupational health', 'environmental health', 'food safety'
    ]

    is_other = any(signal in text for signal in other_signals)

    # --- Classification logic ---
    secondary = ''

    # SBIR/STTR special handling
    if is_sbir:
        if is_device:
            return ('medical_device', 88, '', org_type, 'SBIR/STTR developing medical device')
        if is_diagnostics:
            return ('diagnostics', 88, '', org_type, 'SBIR/STTR developing diagnostic')
        if is_digital:
            return ('digital_health', 88, '', org_type, 'SBIR/STTR developing digital health product')
        if develops_tool:
            return ('biotools', 85, '', org_type, 'SBIR/STTR developing research tool/platform')
        if is_therapeutics:
            return ('therapeutics', 88, '', org_type, 'SBIR/STTR developing therapeutic')
        # Default SBIR to product categories
        return ('therapeutics', 75, '', org_type, 'SBIR/STTR commercial development')

    # Behavioral interventions without drugs = other
    if is_behavioral and not has_drug_component:
        if is_digital:
            return ('digital_health', 80, '', org_type, 'Digital behavioral intervention')
        return ('other', 82, '', org_type, 'Behavioral intervention without pharmacotherapy')

    # Strong medical device signal
    if is_device:
        if develops_tool:
            return ('medical_device', 85, 'biotools', org_type, 'Developing medical device')
        return ('medical_device', 85, '', org_type, 'Medical device development')

    # Strong diagnostics signal
    if is_diagnostics:
        if develops_tool and tool_in_title:
            return ('diagnostics', 85, 'biotools', org_type, 'Developing diagnostic tool')
        return ('diagnostics', 85, '', org_type, 'Diagnostic development/validation')

    # Strong digital health signal
    if is_digital:
        return ('digital_health', 85, '', org_type, 'Digital health tool/platform')

    # Biotools: develops tool and tool is primary focus
    if develops_tool and tool_in_title:
        if is_therapeutics:
            return ('biotools', 82, 'therapeutics', org_type, 'Develops tool/platform, therapeutic application')
        return ('biotools', 85, '', org_type, 'Primary deliverable is a tool/method/platform')

    # Therapeutics signals
    if is_therapeutics:
        if 'mechanism' in text and 'clinical' not in text:
            # Could be basic research with therapeutic context
            if develops_tool:
                return ('biotools', 78, 'therapeutics', org_type, 'Develops tool with therapeutic application')
            if is_basic and not any(word in title_lower for word in ['therapy', 'treatment', 'drug', 'clinical']):
                return ('basic_research', 75, 'therapeutics', org_type, 'Mechanistic study with therapeutic implications')
        return ('therapeutics', 85, '', org_type, 'Drug/treatment development')

    # Health services / epidemiology / behavioral -> other
    if is_other:
        return ('other', 82, '', org_type, 'Health services/epidemiology/policy research')

    # Default to basic_research if mechanism/pathway focus
    if is_basic:
        if develops_tool:
            return ('biotools', 75, 'basic_research', org_type, 'Develops method to study biology')
        return ('basic_research', 82, '', org_type, 'Knowledge/understanding is primary deliverable')

    # If develops tool but not clearly basic or therapeutic
    if develops_tool:
        return ('biotools', 78, '', org_type, 'Develops tool/method/platform')

    # Final fallback
    return ('basic_research', 70, '', org_type, 'Default classification - knowledge-focused')


def process_batch(batch_file):
    """Process a single batch file and return classified rows."""
    results = []
    with open(batch_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            app_id = row.get('application_id', '')
            title = row.get('title', '')
            abstract = row.get('abstract', '')
            activity_code = row.get('activity_code', '')
            org_name = row.get('org_name', '')

            primary_cat, confidence, secondary_cat, org_type, reasoning = classify_project(
                app_id, title, abstract, activity_code, org_name
            )

            results.append({
                'application_id': app_id,
                'primary_category': primary_cat,
                'category_confidence': confidence,
                'secondary_category': secondary_cat,
                'org_type': org_type,
                'reasoning': reasoning
            })

    return results


def main():
    batch_dir = Path('/Users/tednunes/Projects/granted-bio/etl/review_batches')
    output_dir = Path('/Users/tednunes/Projects/granted-bio/etl/semantic_results')
    output_dir.mkdir(exist_ok=True)

    all_results = []

    for batch_num in range(141, 151):
        batch_file = batch_dir / f'review_batch_{batch_num:04d}.csv'
        if batch_file.exists():
            print(f'Processing {batch_file.name}...', file=sys.stderr)
            results = process_batch(batch_file)
            all_results.extend(results)
            print(f'  -> {len(results)} projects classified', file=sys.stderr)
        else:
            print(f'WARNING: {batch_file.name} not found', file=sys.stderr)

    # Write output
    output_file = output_dir / 'semantic_141-150.csv'
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ['application_id', 'primary_category', 'category_confidence',
                      'secondary_category', 'org_type', 'reasoning']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_results)

    print(f'\nWrote {len(all_results)} results to {output_file}', file=sys.stderr)

    # Print category distribution
    from collections import Counter
    cats = Counter(r['primary_category'] for r in all_results)
    print('\nCategory distribution:', file=sys.stderr)
    for cat, count in sorted(cats.items(), key=lambda x: -x[1]):
        print(f'  {cat}: {count}', file=sys.stderr)


if __name__ == '__main__':
    main()
