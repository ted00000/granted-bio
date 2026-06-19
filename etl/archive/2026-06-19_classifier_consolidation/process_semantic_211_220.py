#!/usr/bin/env python3
"""
Process NIH grant batches 211-220 for semantic classification.
Applies classification rules based on PROJECT_PROMPT_SEMANTIC.md
"""

import csv
import re
import os

# Activity codes that are always training (confidence 95)
TRAINING_CODES = {
    'T32', 'T34', 'T35', 'T90', 'TL1', 'TL4',
    'F30', 'F31', 'F32', 'F33', 'F99',
    'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2',
    'D43', 'D71', 'R25', 'R90'
}

# Activity codes that are always infrastructure (confidence 95)
INFRASTRUCTURE_CODES = {
    'P30', 'P50', 'P51', 'S10', 'G20', 'U13', 'R13', 'U24', 'U2C'
}

# SBIR/STTR codes - never basic_research, always company
SBIR_CODES = {'R41', 'R42', 'R43', 'R44', 'SB1', 'U44'}

# Multi-component grant codes that may have cores
MULTI_COMPONENT_CODES = {'P01', 'P20', 'P2C', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}

# Other special codes
SPECIAL_CODES = {
    'U45': ('training', 85),
    'UH4': ('training', 85),
    'U2F': ('other', 85),
    'UC7': ('infrastructure', 85),
}

def classify_org_type(org_name, activity_code):
    """Classify organization type based on org name and activity code."""
    if not org_name:
        return 'other'

    org_upper = org_name.upper()

    # SBIR/STTR are always company
    if activity_code in SBIR_CODES:
        return 'company'

    # Company indicators
    company_indicators = ['LLC', ' INC', 'CORP', 'THERAPEUTICS', 'BIOSCIENCES',
                          'PHARMACEUTICALS', 'BIOTECH', 'BIOPHARMA', 'PHARMA',
                          'TECHNOLOGIES', 'SOLUTIONS', 'LABS', 'SCIENCES INC',
                          'DIAGNOSTICS', 'MEDICAL INC', 'HEALTH INC']
    for ind in company_indicators:
        if ind in org_upper:
            return 'company'

    # Research institutes (check before university since some have university in name)
    research_institutes = [
        'SCRIPPS', 'BROAD INSTITUTE', 'SALK', 'FRED HUTCHINSON', 'SLOAN KETTERING',
        'DANA-FARBER', 'COLD SPRING HARBOR', 'JACKSON LABORATORY', 'WISTAR',
        'ALLEN INSTITUTE', 'STOWERS', 'WHITEHEAD', 'VAN ANDEL', 'GLADSTONE',
        'RESEARCH TRIANGLE', 'BATTELLE', 'SRI INTERNATIONAL', 'MITRE',
        'SANFORD BURNHAM', 'LA JOLLA', 'HUDSON ALPHA', 'BENAROYA', 'RESEARCH INST',
        'INSTITUTE FOR', 'WOODS HOLE', 'MARINE BIOLOGICAL'
    ]
    for inst in research_institutes:
        if inst in org_upper:
            return 'research_institute'

    # University
    if 'UNIVERSITY' in org_upper or 'COLLEGE' in org_upper or 'SCHOOL OF' in org_upper:
        return 'university'

    # Hospital (not part of university)
    hospital_indicators = ['HOSPITAL', 'MEDICAL CENTER', 'HEALTH SYSTEM', 'CLINIC',
                          'CHILDREN\'S', 'MAYO', 'CEDARS-SINAI', 'MOUNT SINAI']
    for ind in hospital_indicators:
        if ind in org_upper:
            return 'hospital'

    return 'other'


def is_core_or_support(title, abstract):
    """Check if project is a core/support component within multi-component grant."""
    text = f"{title} {abstract}".lower() if abstract else title.lower()

    core_indicators = [
        'administrative core', 'admin core', 'resource core', 'shared facility',
        'data core', 'biostatistics core', 'imaging core', 'service core',
        'support core', 'coordination core', 'management core', 'pilot core',
        'biorepository core', 'bioinformatics core', 'tissue core', 'proteomics core',
        'genomics core', 'clinical core', 'community core', 'outreach core'
    ]

    for indicator in core_indicators:
        if indicator in text:
            return 'infrastructure'

    mentoring_indicators = ['mentoring core', 'career development core', 'training core']
    for indicator in mentoring_indicators:
        if indicator in text:
            return 'training'

    return None


def classify_by_content(title, abstract, activity_code, org_name):
    """
    Classify project by primary deliverable based on title and abstract content.
    Returns (primary_category, confidence, secondary_category, reasoning)
    """
    if not abstract or len(abstract.strip()) < 50:
        if activity_code in TRAINING_CODES:
            return 'training', 95, '', 'Activity code indicates training program'
        if activity_code in INFRASTRUCTURE_CODES:
            return 'infrastructure', 95, '', 'Activity code indicates infrastructure'
        return 'other', 0, '', 'No abstract available'

    text = f"{title} {abstract}".lower()
    title_lower = title.lower() if title else ''

    # Keywords for classification
    biotools_strong = [
        'develop a platform', 'develop an assay', 'develop a method', 'develop a tool',
        'novel probe', 'novel assay', 'create a pipeline', 'computational pipeline',
        'build a database', 'publicly available database', 'reference standard',
        'develop software', 'develop a resource', 'high-throughput screening platform',
        'imaging platform', 'screening assay', 'develop imaging method', 'novel imaging',
        'develop computational', 'develop algorithm', 'bioinformatics tool',
        'develop a model system', 'animal model resource', 'develop reagent'
    ]

    therapeutics_strong = [
        'drug discovery', 'drug development', 'drug candidate', 'lead compound',
        'clinical trial', 'phase i', 'phase ii', 'phase iii', 'phase 1', 'phase 2', 'phase 3',
        'gene therapy', 'cell therapy', 'car-t', 'car t', 'immunotherapy',
        'vaccine development', 'develop a vaccine', 'therapeutic', 'treatment',
        'drug delivery', 'pharmacological', 'optimize compound', 'develop treatment',
        'preclinical development', 'ind-enabling', 'clinical efficacy', 'dose-response',
        'pharmacokinetics', 'pharmacodynamics', 'small molecule', 'monoclonal antibody',
        'antisense', 'sirna therapy', 'mrna therapy', 'crispr therapy'
    ]

    diagnostics_strong = [
        'diagnostic test', 'diagnostic assay', 'point-of-care', 'biomarker panel',
        'clinical biomarker', 'validate a biomarker', 'companion diagnostic',
        'liquid biopsy', 'early detection', 'screening test', 'diagnostic algorithm',
        'clinical detection', 'detect disease', 'blood-based biomarker', 'diagnostic platform'
    ]

    medical_device_strong = [
        'implant', 'prosthetic', 'surgical instrument', 'stent', 'catheter',
        'wearable device', 'brain-computer interface', 'neural interface',
        'tissue-engineered', 'scaffold', 'medical device', 'implantable',
        'bioresorbable', 'electrode array', 'pacemaker', 'defibrillator'
    ]

    digital_health_strong = [
        'mobile app', 'mhealth', 'telemedicine', 'telehealth', 'clinical decision support',
        'ehr tool', 'electronic health record', 'remote monitoring', 'digital therapeutic',
        'smartphone app', 'patient-facing', 'clinician-facing', 'decision support system',
        'health app', 'web-based intervention', 'digital intervention'
    ]

    basic_research_strong = [
        'understand mechanism', 'elucidate mechanism', 'investigate mechanism',
        'role of', 'pathway', 'signaling', 'neural circuit', 'gene function',
        'protein function', 'molecular mechanism', 'cellular mechanism',
        'identify genes', 'characterize', 'understand how', 'discover',
        'fundamental', 'basic biology', 'structural biology', 'mechanistic',
        'transcriptome', 'proteome', 'metabolome'
    ]

    other_strong = [
        'cohort study', 'longitudinal study', 'epidemiological', 'epidemiology',
        'health disparities', 'health policy', 'implementation science',
        'community-based', 'behavioral intervention', 'smoking cessation',
        'weight management', 'lifestyle', 'psychotherapy', 'cognitive behavioral therapy',
        'mindfulness', 'health services research', 'occupational health',
        'environmental health', 'food safety'
    ]

    # Score each category
    scores = {
        'biotools': 0,
        'therapeutics': 0,
        'diagnostics': 0,
        'medical_device': 0,
        'digital_health': 0,
        'basic_research': 0,
        'other': 0
    }

    # Check strong indicators (title gets extra weight)
    for kw in biotools_strong:
        if kw in title_lower:
            scores['biotools'] += 3
        elif kw in text:
            scores['biotools'] += 1

    for kw in therapeutics_strong:
        if kw in title_lower:
            scores['therapeutics'] += 3
        elif kw in text:
            scores['therapeutics'] += 1

    for kw in diagnostics_strong:
        if kw in title_lower:
            scores['diagnostics'] += 3
        elif kw in text:
            scores['diagnostics'] += 1

    for kw in medical_device_strong:
        if kw in title_lower:
            scores['medical_device'] += 3
        elif kw in text:
            scores['medical_device'] += 1

    for kw in digital_health_strong:
        if kw in title_lower:
            scores['digital_health'] += 3
        elif kw in text:
            scores['digital_health'] += 1

    for kw in basic_research_strong:
        if kw in title_lower:
            scores['basic_research'] += 3
        elif kw in text:
            scores['basic_research'] += 1

    for kw in other_strong:
        if kw in title_lower:
            scores['other'] += 3
        elif kw in text:
            scores['other'] += 1

    # Special rules

    # SBIR/STTR: never basic_research
    if activity_code in SBIR_CODES:
        scores['basic_research'] = 0
        # Boost product categories
        if scores['therapeutics'] > 0:
            scores['therapeutics'] += 2
        if scores['medical_device'] > 0:
            scores['medical_device'] += 2
        if scores['diagnostics'] > 0:
            scores['diagnostics'] += 2
        if scores['biotools'] > 0:
            scores['biotools'] += 2
        if scores['digital_health'] > 0:
            scores['digital_health'] += 2

    # Behavioral without drugs = other
    behavioral_terms = ['behavioral intervention', 'cbt', 'cognitive behavioral',
                        'motivational interview', 'mindfulness', 'psychotherapy']
    drug_terms = ['drug', 'pharmacological', 'medication', 'compound', 'therapeutic agent',
                 'varenicline', 'naltrexone', 'bupropion', 'nicotine replacement']

    has_behavioral = any(term in text for term in behavioral_terms)
    has_drug = any(term in text for term in drug_terms)

    if has_behavioral and not has_drug:
        scores['other'] += 3
        scores['therapeutics'] = max(0, scores['therapeutics'] - 2)

    # Resource/colony/repository = infrastructure or biotools
    resource_terms = ['research resource', 'colony', 'biomedical resource', 'repository',
                     'tissue bank', 'biobank', 'provides animals', 'provides samples']
    if any(term in text for term in resource_terms):
        scores['biotools'] += 3

    # USES vs DEVELOPS distinction
    uses_patterns = [
        r'using\s+\w+\s+seq', r'using\s+\w+\s+imaging', r'using\s+machine\s+learning',
        r'using\s+crispr', r'using\s+\w+\s+assay', r'apply\s+\w+\s+method'
    ]
    develops_patterns = [
        r'develop\s+\w+\s+method', r'develop\s+\w+\s+platform', r'develop\s+\w+\s+assay',
        r'create\s+\w+\s+tool', r'build\s+\w+\s+pipeline', r'novel\s+\w+\s+method'
    ]

    uses_method = any(re.search(p, text) for p in uses_patterns)
    develops_method = any(re.search(p, text) for p in develops_patterns)

    if uses_method and not develops_method:
        scores['basic_research'] += 2
        scores['biotools'] = max(0, scores['biotools'] - 1)
    elif develops_method:
        scores['biotools'] += 2

    # Get top two categories
    sorted_cats = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    primary = sorted_cats[0][0]
    primary_score = sorted_cats[0][1]
    secondary = sorted_cats[1][0]
    secondary_score = sorted_cats[1][1]

    # Determine confidence
    if primary_score >= 6:
        confidence = 85
    elif primary_score >= 4:
        confidence = 80
    elif primary_score >= 2:
        confidence = 75
    else:
        confidence = 70

    # Only include secondary if scores are close
    if secondary_score >= primary_score * 0.6 and secondary_score >= 2:
        secondary_cat = secondary
    else:
        secondary_cat = ''

    # Generate reasoning
    if primary == 'basic_research':
        reasoning = 'Primary deliverable is knowledge/understanding of biological mechanisms'
    elif primary == 'biotools':
        reasoning = 'Primary deliverable is a research tool, method, or resource'
    elif primary == 'therapeutics':
        reasoning = 'Primary deliverable is a treatment or therapeutic intervention'
    elif primary == 'diagnostics':
        reasoning = 'Primary deliverable is a clinical diagnostic test or biomarker panel'
    elif primary == 'medical_device':
        reasoning = 'Primary deliverable is a medical device for patient care'
    elif primary == 'digital_health':
        reasoning = 'Primary deliverable is patient/clinician-facing software'
    else:
        reasoning = 'Health services, behavioral, or epidemiological research'

    return primary, confidence, secondary_cat, reasoning


def classify_project(row):
    """Main classification function for a project."""
    app_id = row.get('application_id', '')
    title = row.get('title', '')
    abstract = row.get('abstract', '')
    activity_code = row.get('activity_code', '')
    org_name = row.get('org_name', '')

    # Step 1: Check activity code first
    if activity_code in TRAINING_CODES:
        org_type = classify_org_type(org_name, activity_code)
        return {
            'application_id': app_id,
            'primary_category': 'training',
            'category_confidence': 95,
            'secondary_category': '',
            'org_type': org_type,
            'reasoning': f'Activity code {activity_code} is a training program'
        }

    if activity_code in INFRASTRUCTURE_CODES:
        org_type = classify_org_type(org_name, activity_code)
        return {
            'application_id': app_id,
            'primary_category': 'infrastructure',
            'category_confidence': 95,
            'secondary_category': '',
            'org_type': org_type,
            'reasoning': f'Activity code {activity_code} is infrastructure'
        }

    # Check special codes
    if activity_code in SPECIAL_CODES:
        cat, conf = SPECIAL_CODES[activity_code]
        org_type = classify_org_type(org_name, activity_code)
        return {
            'application_id': app_id,
            'primary_category': cat,
            'category_confidence': conf,
            'secondary_category': '',
            'org_type': org_type,
            'reasoning': f'Activity code {activity_code} special classification'
        }

    # Step 2: Check for cores in multi-component grants
    if activity_code in MULTI_COMPONENT_CODES:
        core_type = is_core_or_support(title, abstract)
        if core_type:
            org_type = classify_org_type(org_name, activity_code)
            return {
                'application_id': app_id,
                'primary_category': core_type,
                'category_confidence': 85,
                'secondary_category': '',
                'org_type': org_type,
                'reasoning': f'Core/support component within {activity_code} grant'
            }

    # Check for SEER
    text = f"{title} {abstract}".upper() if abstract else title.upper()
    if 'SEER' in text and ('REGISTRY' in text or 'REGISTRIES' in text or 'CANCER' in text):
        org_type = classify_org_type(org_name, activity_code)
        return {
            'application_id': app_id,
            'primary_category': 'infrastructure',
            'category_confidence': 85,
            'secondary_category': '',
            'org_type': org_type,
            'reasoning': 'SEER cancer registry program'
        }

    # Step 3: Classify by content
    primary, confidence, secondary, reasoning = classify_by_content(
        title, abstract, activity_code, org_name
    )
    org_type = classify_org_type(org_name, activity_code)

    return {
        'application_id': app_id,
        'primary_category': primary,
        'category_confidence': confidence,
        'secondary_category': secondary,
        'org_type': org_type,
        'reasoning': reasoning
    }


def process_batch_file(filepath):
    """Process a single batch file and return classified rows."""
    results = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            result = classify_project(row)
            results.append(result)
    return results


def main():
    base_dir = '/Users/tednunes/Projects/granted-bio/etl'
    batch_dir = os.path.join(base_dir, 'review_batches')
    output_dir = os.path.join(base_dir, 'semantic_results')

    all_results = []

    # Process batches 211-220
    for i in range(211, 221):
        batch_file = os.path.join(batch_dir, f'review_batch_0{i}.csv')
        if os.path.exists(batch_file):
            print(f"Processing batch {i}...")
            results = process_batch_file(batch_file)
            all_results.extend(results)
            print(f"  Processed {len(results)} projects")
        else:
            print(f"Warning: Batch file {batch_file} not found")

    # Write output
    output_file = os.path.join(output_dir, 'semantic_211-220.csv')
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ['application_id', 'primary_category', 'category_confidence',
                     'secondary_category', 'org_type', 'reasoning']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_results)

    print(f"\nTotal projects processed: {len(all_results)}")
    print(f"Output written to: {output_file}")

    # Print category distribution
    from collections import Counter
    categories = Counter(r['primary_category'] for r in all_results)
    print("\nCategory distribution:")
    for cat, count in sorted(categories.items()):
        print(f"  {cat}: {count}")


if __name__ == '__main__':
    main()
