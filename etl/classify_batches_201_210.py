#!/usr/bin/env python3
"""
Semantic classification of NIH grants for batches 201-210.
Classifies by PRIMARY DELIVERABLE per PROJECT_PROMPT_SEMANTIC.md rules.
"""

import csv
import re
import os

# Activity codes that are deterministically classified
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

def classify_org(org_name, activity_code):
    """Classify organization type."""
    org_upper = org_name.upper() if org_name else ''

    # SBIR/STTR = always company
    if activity_code in SBIR_STTR_CODES:
        return 'company'

    # Company indicators
    company_patterns = ['LLC', 'INC.', 'INC,', 'CORP.', 'CORP,', 'THERAPEUTICS',
                       'BIOSCIENCES', 'PHARMACEUTICALS', 'BIOTECH', 'L.L.C.',
                       'INCORPORATED', 'CORPORATION']
    for pattern in company_patterns:
        if pattern in org_upper:
            return 'company'

    # Research institutes
    research_institutes = [
        'SCRIPPS', 'BROAD INSTITUTE', 'SALK', 'FRED HUTCHINSON', 'SLOAN KETTERING',
        'DANA-FARBER', 'COLD SPRING HARBOR', 'JACKSON LABORATORY', 'WISTAR',
        'ALLEN INSTITUTE', 'STOWERS', 'WHITEHEAD', 'VAN ANDEL', 'INSTITUT PASTEUR',
        'RESEARCH INSTITUTE', 'CANCER CENTER', 'CANCER RESEARCH'
    ]
    for inst in research_institutes:
        if inst in org_upper:
            return 'research_institute'

    # University
    uni_patterns = ['UNIVERSITY', 'COLLEGE', 'SCHOOL OF MEDICINE', 'INSTITUTE OF TECHNOLOGY']
    for pattern in uni_patterns:
        if pattern in org_upper:
            return 'university'

    # Hospital
    hospital_patterns = ['HOSPITAL', 'MEDICAL CENTER', 'HEALTH SYSTEM', 'CLINIC', "CHILDREN'S", 'CHILDRENS']
    for pattern in hospital_patterns:
        if pattern in org_upper:
            # Check if university comes before medical center
            if 'UNIVERSITY' in org_upper:
                uni_pos = org_upper.find('UNIVERSITY')
                hosp_pos = org_upper.find(pattern)
                if uni_pos < hosp_pos:
                    return 'university'
            return 'hospital'

    # Default
    return 'other'


def classify_project(row):
    """
    Classify a project by primary deliverable.
    Returns: (primary_category, confidence, secondary_category, reasoning)
    """
    app_id = row.get('application_id', '')
    activity_code = row.get('activity_code', '').strip().upper()
    title = row.get('title', '').lower()
    abstract = row.get('abstract', '').lower()
    org_name = row.get('org_name', '')

    combined = f"{title} {abstract}"

    # Step 1: Check activity code first
    if activity_code in TRAINING_CODES:
        return ('training', 95, '', 'Activity code deterministic: training')

    if activity_code in INFRASTRUCTURE_CODES:
        return ('infrastructure', 95, '', 'Activity code deterministic: infrastructure')

    # Step 2: Check for cores in multi-component grants
    multi_component = {'P01', 'P20', 'P2C', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}
    if activity_code in multi_component:
        core_patterns = ['administrative core', 'resource core', 'shared facility',
                        'data core', 'biostatistics core', 'imaging core', 'service core']
        for pattern in core_patterns:
            if pattern in combined:
                return ('infrastructure', 82, '', f'Multi-component grant with core indicators')

    # Step 3: SBIR/STTR - never basic_research
    is_sbir = activity_code in SBIR_STTR_CODES

    # Check for no abstract
    if len(abstract.strip()) < 50:
        if activity_code in TRAINING_CODES:
            return ('training', 95, '', 'Activity code deterministic: training')
        return ('other', 0, '', 'No abstract available')

    # Step 3: Classify by primary deliverable

    # THERAPEUTICS signals (DEVELOPS treatment)
    therapeutics_signals = [
        'drug discovery', 'drug development', 'gene therapy', 'cell therapy',
        'vaccine development', 'immunotherapy', 'drug delivery', 'clinical trial',
        'phase i', 'phase ii', 'phase iii', 'phase 1', 'phase 2', 'phase 3',
        'therapeutic', 'treatment', 'ind filing', 'ind application',
        'preclinical development', 'lead optimization', 'drug candidate',
        'pharmacological', 'antifungal', 'antiviral', 'antibiotic',
        'car-t', 'cart cell', 'chimeric antigen receptor',
        'oncolytic', 'nanoparticle', 'small molecule',
        'we will develop a', 'develop a novel treatment',
        'treat patients', 'for treatment of', 'as a treatment',
        'therapeutic target', 'novel therapeutic', 'new treatment',
        'pharmacokinetic', 'pharmacodynamic', 'dose-escalation',
        'clinical translation', 'clinical candidate'
    ]

    # BIOTOOLS signals (DEVELOPS tool/method/resource)
    biotools_signals = [
        'develop an assay', 'novel assay', 'develop a platform',
        'computational pipeline', 'computational tool', 'software tool',
        'database', 'atlas', 'resource for', 'platform for',
        'imaging method', 'imaging platform', 'imaging technique',
        'probe', 'biosensor', 'reporter', 'high-throughput screening',
        'method development', 'we will develop', 'novel method',
        'algorithm', 'machine learning tool', 'deep learning tool',
        'reference standard', 'reagent', 'kit',
        'we will create', 'we will build', 'publicly available'
    ]

    # DIAGNOSTICS signals (DEVELOPS clinical test)
    diagnostics_signals = [
        'diagnostic', 'biomarker panel', 'clinical test',
        'point-of-care', 'screening test', 'companion diagnostic',
        'liquid biopsy', 'early detection', 'clinical biomarker',
        'validate a biomarker', 'blood-based biomarker',
        'diagnostic assay', 'detection of', 'clinical validation'
    ]

    # MEDICAL_DEVICE signals
    device_signals = [
        'implant', 'prosthetic', 'surgical instrument', 'stent', 'catheter',
        'wearable', 'tissue-engineered', 'brain-computer interface',
        'neural interface', 'medical device', 'bioelectronic',
        'electrode', 'neuromodulation', 'closed-loop'
    ]

    # DIGITAL_HEALTH signals
    digital_signals = [
        'mobile app', 'mhealth', 'telemedicine', 'telehealth',
        'clinical decision support', 'ehr', 'electronic health record',
        'remote monitoring', 'digital therapeutic', 'patient-facing',
        'clinician-facing', 'software', 'web-based'
    ]

    # OTHER signals (behavioral, health services, epidemiology)
    other_signals = [
        'health services', 'health policy', 'epidemiolog',
        'behavioral intervention', 'smoking cessation', 'weight management',
        'lifestyle', 'psychotherapy', 'cognitive behavioral therapy',
        'mindfulness', 'community-based', 'longitudinal cohort',
        'health disparities', 'implementation science', 'community health',
        'occupational safety', 'environmental health', 'food safety',
        'retrospective', 'claims database', 'medicaid', 'medicare',
        'survey', 'qualitative', 'interview', 'focus group'
    ]

    # BASIC_RESEARCH signals (KNOWLEDGE is deliverable)
    basic_signals = [
        'mechanism', 'pathway', 'understand', 'elucidate', 'role of',
        'how does', 'what is the', 'investigate', 'dissect',
        'characterize', 'determine the function', 'molecular basis',
        'neural circuit', 'signaling', 'regulation', 'gene expression',
        'transcription', 'epigenetic', 'chromatin', 'metabolism',
        'protein structure', 'structural biology', 'biochemical',
        'cell biology', 'developmental biology', 'immunology',
        'pathogenesis', 'etiology', 'pathophysiology',
        'in vivo', 'in vitro', 'mouse model', 'animal model',
        'knockout', 'transgenic', 'crispr', 'rnaseq', 'proteomics'
    ]

    # Count signals
    def count_signals(text, signals):
        return sum(1 for s in signals if s in text)

    tx_count = count_signals(combined, therapeutics_signals)
    bt_count = count_signals(combined, biotools_signals)
    dx_count = count_signals(combined, diagnostics_signals)
    dv_count = count_signals(combined, device_signals)
    dh_count = count_signals(combined, digital_signals)
    ot_count = count_signals(combined, other_signals)
    br_count = count_signals(combined, basic_signals)

    # Key distinction: USES vs DEVELOPS
    # If title focuses on developing a tool/method, it's biotools
    develops_tool = any(p in title for p in ['develop', 'novel', 'platform', 'assay', 'atlas', 'pipeline'])

    # Special handling for SBIR/STTR
    if is_sbir:
        # Never basic_research for SBIR/STTR
        scores = {
            'therapeutics': tx_count + 3,  # Bias toward therapeutics for SBIR
            'biotools': bt_count,
            'diagnostics': dx_count,
            'medical_device': dv_count + 2,  # Also common for SBIR
            'digital_health': dh_count
        }
        best = max(scores, key=scores.get)
        if scores[best] > 0:
            return (best, 80, '', f'SBIR/STTR commercial development: {best}')
        return ('therapeutics', 75, '', 'SBIR/STTR defaulting to therapeutics')

    # Score each category
    scores = {
        'basic_research': br_count,
        'therapeutics': tx_count,
        'biotools': bt_count,
        'diagnostics': dx_count,
        'medical_device': dv_count,
        'digital_health': dh_count,
        'other': ot_count
    }

    # Boost biotools if title indicates tool development
    if develops_tool and bt_count > 0:
        scores['biotools'] += 3

    # Get top categories
    sorted_cats = sorted(scores.items(), key=lambda x: -x[1])
    primary = sorted_cats[0][0]
    primary_score = sorted_cats[0][1]
    secondary = sorted_cats[1][0] if sorted_cats[1][1] > 2 and sorted_cats[1][1] >= primary_score * 0.6 else ''
    secondary_score = sorted_cats[1][1]

    # Determine confidence
    if primary_score >= 5 and primary_score > secondary_score * 1.5:
        confidence = 85
    elif primary_score >= 3:
        confidence = 78
    elif primary_score >= 1:
        confidence = 70
    else:
        confidence = 65
        primary = 'basic_research'  # Default to basic_research

    # Reasoning
    if secondary:
        reasoning = f'{primary.replace("_", " ").title()} primary ({primary_score} signals), {secondary} secondary ({secondary_score} signals)'
    else:
        reasoning = f'{primary.replace("_", " ").title()} classification ({primary_score} signals)'

    return (primary, confidence, secondary, reasoning)


def process_batch(batch_file):
    """Process a single batch file and return classifications."""
    results = []

    with open(batch_file, 'r', encoding='utf-8', errors='replace') as f:
        # Read entire file as text and parse manually due to complex CSV
        content = f.read()

    # Parse CSV properly handling multiline fields
    import io
    reader = csv.DictReader(io.StringIO(content))

    for row in reader:
        app_id = row.get('application_id', '')
        if not app_id:
            continue

        activity_code = row.get('activity_code', '')
        org_name = row.get('org_name', '')

        # Classify
        primary, confidence, secondary, reasoning = classify_project(row)
        org_type = classify_org(org_name, activity_code)

        results.append({
            'application_id': app_id,
            'primary_category': primary,
            'category_confidence': confidence,
            'secondary_category': secondary,
            'org_type': org_type,
            'reasoning': reasoning
        })

    return results


def main():
    batch_dir = '/Users/tednunes/Projects/granted-bio/etl/review_batches'
    output_file = '/Users/tednunes/Projects/granted-bio/etl/semantic_results/semantic_201-210.csv'

    all_results = []

    for batch_num in range(201, 211):
        batch_file = os.path.join(batch_dir, f'review_batch_0{batch_num}.csv')
        print(f'Processing {batch_file}...')
        results = process_batch(batch_file)
        all_results.extend(results)
        print(f'  -> {len(results)} projects classified')

    # Write output
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'application_id', 'primary_category', 'category_confidence',
            'secondary_category', 'org_type', 'reasoning'
        ])
        writer.writeheader()
        writer.writerows(all_results)

    print(f'\nTotal: {len(all_results)} projects written to {output_file}')


if __name__ == '__main__':
    main()
