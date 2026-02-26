#!/usr/bin/env python3
"""
Semantic classification of NIH grants for batches 271-280.
Classifies by primary deliverable, not methods used.
"""

import csv
import re
import os

# Activity code rules
TRAINING_CODES = {
    'T32', 'T34', 'T35', 'T90', 'TL1', 'TL4',
    'F30', 'F31', 'F32', 'F33', 'F99',
    'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2',
    'D43', 'D71', 'R25', 'R90'
}

INFRASTRUCTURE_CODES = {
    'P30', 'P50', 'P51', 'S10', 'G20', 'U13', 'R13', 'U24', 'U2C'
}

SBIR_CODES = {'R41', 'R42', 'R43', 'R44', 'SB1', 'U44'}

MULTI_COMPONENT_CODES = {'P01', 'P20', 'P2C', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}

def get_org_type(org_name, activity_code):
    """Determine organization type."""
    org_lower = org_name.lower() if org_name else ''

    # SBIR/STTR always company
    if activity_code in SBIR_CODES:
        return 'company'

    # Check for company indicators
    company_terms = ['llc', 'inc.', 'inc,', 'corp.', 'corp,', 'therapeutics', 'biosciences',
                     'pharmaceuticals', 'biotech', 'pharma', 'bio ', 'ltd', 'limited',
                     'laboratories, inc', 'solutions', 'technologies']
    for term in company_terms:
        if term in org_lower:
            return 'company'

    # Research institutes
    research_institutes = ['scripps', 'broad institute', 'salk', 'fred hutchinson', 'fred hutch',
                          'sloan kettering', 'memorial sloan', 'dana-farber', 'dana farber',
                          'cold spring harbor', 'jackson laboratory', 'wistar', 'allen institute',
                          'stowers', 'whitehead', 'van andel', 'sanford burnham', 'la jolla',
                          'institute for', 'research institute', 'j. craig venter']
    for term in research_institutes:
        if term in org_lower:
            return 'research_institute'

    # Universities
    if any(x in org_lower for x in ['university', 'college', 'school of', 'polytechnic',
                                     'institute of technology', 'mit ', ' mit', 'caltech']):
        return 'university'

    # Hospitals/Medical centers
    if any(x in org_lower for x in ['hospital', 'medical center', 'health system', 'clinic',
                                     'children\'s', 'memorial', 'health center']):
        return 'hospital'

    # Government
    if any(x in org_lower for x in ['veterans', 'va ', 'nih', 'cdc', 'fda']):
        return 'other'

    return 'university'  # default

def is_core_project(title, abstract):
    """Check if project is a core/support component."""
    text = (title + ' ' + (abstract or '')).lower()
    core_terms = ['administrative core', 'admin core', 'resource core', 'shared facility',
                  'data core', 'biostatistics core', 'imaging core', 'service core',
                  'support core', 'core facility', 'shared resource']
    return any(term in text for term in core_terms)

def is_mentoring_core(title, abstract):
    """Check if project is a mentoring/career development core."""
    text = (title + ' ' + (abstract or '')).lower()
    return any(term in text for term in ['mentoring core', 'career development core',
                                          'training core', 'education core'])

def classify_project(row):
    """Classify a single project."""
    app_id = row['application_id']
    title = row.get('title', '') or ''
    abstract = row.get('abstract', '') or ''
    activity_code = row.get('activity_code', '') or ''
    org_name = row.get('org_name', '') or ''
    phr = row.get('phr', '') or ''

    # Combine text for analysis
    full_text = f"{title} {abstract} {phr}".lower()

    org_type = get_org_type(org_name, activity_code)

    # Step 1: Check activity code first
    if activity_code in TRAINING_CODES:
        return app_id, 'training', 95, '', org_type, f"Activity code {activity_code} is training"

    if activity_code in INFRASTRUCTURE_CODES:
        return app_id, 'infrastructure', 95, '', org_type, f"Activity code {activity_code} is infrastructure"

    # Step 2: Check for cores
    if activity_code in MULTI_COMPONENT_CODES:
        if is_core_project(title, abstract):
            return app_id, 'infrastructure', 82, '', org_type, "Core/support component within multi-component grant"
        if is_mentoring_core(title, abstract):
            return app_id, 'training', 85, '', org_type, "Mentoring/career development core"

    # SEER registries
    if 'seer' in full_text and ('registry' in full_text or 'surveillance' in full_text):
        return app_id, 'infrastructure', 85, '', org_type, "SEER cancer registry"

    # No abstract case
    if len(abstract.strip()) < 50:
        if activity_code in TRAINING_CODES:
            return app_id, 'training', 95, '', org_type, f"Activity code {activity_code}, no abstract"
        return app_id, 'other', 0, '', org_type, "No abstract available"

    # Step 3: Classify by primary deliverable

    # SBIR/STTR - never basic_research
    is_sbir = activity_code in SBIR_CODES

    secondary = ''

    # Check for therapeutic indicators
    therapeutic_strong = [
        'drug discovery', 'drug development', 'drug candidate', 'lead compound',
        'gene therapy', 'cell therapy', 'car-t', 'car t', 'chimeric antigen',
        'vaccine development', 'immunotherapy', 'therapeutic', 'treatment',
        'clinical trial', 'phase i', 'phase ii', 'phase iii', 'phase 1', 'phase 2',
        'pharmacological', 'drug delivery', 'small molecule', 'biologics',
        'efficacy', 'preclinical', 'pre-clinical', 'ind-enabling', 'ind enabling',
        'formulation', 'pharmacokinetics', 'pharmacodynamics', 'dose-finding'
    ]

    therapeutic_moderate = [
        'therapy', 'treat', 'intervention', 'ameliorate', 'rescue',
        'potential therapeutic', 'novel treatment', 'targeting'
    ]

    # Check for diagnostic indicators
    diagnostic_terms = [
        'diagnostic', 'clinical test', 'biomarker panel', 'early detection',
        'point-of-care', 'poc test', 'companion diagnostic', 'liquid biopsy',
        'screening test', 'clinical biomarker', 'validate biomarker',
        'detection assay', 'clinical assay'
    ]

    # Check for medical device indicators
    device_terms = [
        'medical device', 'implant', 'prosthetic', 'surgical instrument',
        'stent', 'catheter', 'wearable', 'tissue-engineered', 'tissue engineered',
        'brain-computer interface', 'bci', 'neural interface', 'implantable',
        'scaffold', 'biomaterial'
    ]

    # Check for digital health indicators
    digital_health_terms = [
        'mobile app', 'mhealth', 'm-health', 'telemedicine', 'telehealth',
        'clinical decision support', 'ehr', 'electronic health record',
        'remote monitoring', 'digital therapeutic', 'patient-facing',
        'smartphone', 'wearable app', 'health app'
    ]

    # Check for biotools indicators (DEVELOPS not USES)
    biotools_strong = [
        'develop an assay', 'develop a method', 'develop a platform', 'develop a tool',
        'novel assay', 'novel probe', 'novel platform', 'novel method',
        'high-throughput screening platform', 'screening platform',
        'computational pipeline', 'computational tool', 'bioinformatics tool',
        'publicly available database', 'create a database', 'build a database',
        'reference standard', 'reagent development', 'probe development',
        'imaging platform', 'sequencing platform', 'omics platform'
    ]

    biotools_moderate = [
        'we will develop', 'develop and validate', 'create a', 'build a',
        'platform for', 'pipeline for', 'tool for', 'resource for',
        'assay development', 'method development'
    ]

    # Behavioral intervention terms (other, not therapeutics)
    behavioral_terms = [
        'behavioral intervention', 'cognitive behavioral', 'cbt', 'mindfulness',
        'motivational interviewing', 'psychotherapy', 'counseling',
        'lifestyle modification', 'weight management', 'smoking cessation',
        'exercise intervention', 'diet intervention', 'health behavior'
    ]

    # Health services/policy terms (other)
    other_terms = [
        'health services', 'health policy', 'epidemiological', 'cohort study',
        'implementation science', 'health disparities', 'community health',
        'occupational safety', 'environmental health', 'food safety',
        'longitudinal study', 'population-based', 'survey', 'questionnaire'
    ]

    # Score each category
    scores = {
        'therapeutics': 0,
        'diagnostics': 0,
        'medical_device': 0,
        'digital_health': 0,
        'biotools': 0,
        'basic_research': 0,
        'other': 0
    }

    # Check therapeutics
    for term in therapeutic_strong:
        if term in full_text:
            scores['therapeutics'] += 3
    for term in therapeutic_moderate:
        if term in full_text:
            scores['therapeutics'] += 1

    # Check diagnostics
    for term in diagnostic_terms:
        if term in full_text:
            scores['diagnostics'] += 3

    # Check medical device
    for term in device_terms:
        if term in full_text:
            scores['medical_device'] += 3

    # Check digital health
    for term in digital_health_terms:
        if term in full_text:
            scores['digital_health'] += 3

    # Check biotools
    for term in biotools_strong:
        if term in full_text:
            scores['biotools'] += 4
    for term in biotools_moderate:
        if term in full_text:
            scores['biotools'] += 1

    # Check behavioral (goes to other)
    for term in behavioral_terms:
        if term in full_text:
            scores['other'] += 2

    # Check other health services
    for term in other_terms:
        if term in full_text:
            scores['other'] += 1

    # Basic research indicators (understanding, mechanisms, etc.)
    basic_research_terms = [
        'mechanism', 'pathway', 'understand', 'elucidate', 'characterize',
        'role of', 'function of', 'how does', 'determine how', 'investigate',
        'examine', 'study', 'explore', 'dissect', 'define the', 'identify the',
        'neural circuit', 'signaling', 'regulation', 'molecular basis'
    ]

    for term in basic_research_terms:
        if term in full_text:
            scores['basic_research'] += 1

    # SBIR penalty for basic_research
    if is_sbir:
        scores['basic_research'] = 0  # Never basic_research for SBIR
        # Boost commercial categories
        if max(scores.values()) == 0:
            scores['therapeutics'] = 2  # Default guess for SBIR

    # Check for drug mentions in behavioral context
    has_drug = any(term in full_text for term in ['drug', 'pharmacolog', 'medication', 'varenicline',
                                                    'bupropion', 'nicotine replacement', 'naltrexone'])

    # If behavioral without drugs, should be other
    is_behavioral = any(term in full_text for term in behavioral_terms)
    if is_behavioral and not has_drug:
        scores['other'] += 5
        scores['therapeutics'] = max(0, scores['therapeutics'] - 3)

    # Determine primary category
    max_score = max(scores.values())

    if max_score == 0:
        # Default to basic_research for regular grants, therapeutics for SBIR
        if is_sbir:
            primary = 'therapeutics'
            confidence = 70
            reasoning = "SBIR grant, defaulting to therapeutics"
        else:
            primary = 'basic_research'
            confidence = 75
            reasoning = "Default classification, no strong category signals"
    else:
        # Find categories with top scores
        top_cats = [cat for cat, score in scores.items() if score == max_score]
        primary = top_cats[0]

        # Check for secondary
        sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        if len(sorted_scores) > 1 and sorted_scores[1][1] > 0 and sorted_scores[1][1] >= max_score * 0.5:
            secondary = sorted_scores[1][0]

        # Determine confidence
        if max_score >= 6:
            confidence = 88
        elif max_score >= 4:
            confidence = 82
        elif max_score >= 2:
            confidence = 75
        else:
            confidence = 70

        reasoning = f"Primary deliverable: {primary} (score {max_score})"

    return app_id, primary, confidence, secondary, org_type, reasoning

def process_batch(batch_num):
    """Process a single batch file."""
    input_path = f"/Users/tednunes/Projects/granted-bio/etl/review_batches/review_batch_{batch_num:04d}.csv"

    results = []

    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            result = classify_project(row)
            results.append(result)

    return results

def main():
    """Process batches 271-280 and output results."""
    all_results = []

    for batch_num in range(271, 281):
        print(f"Processing batch {batch_num}...")
        results = process_batch(batch_num)
        all_results.extend(results)
        print(f"  Processed {len(results)} projects")

    # Write output
    output_path = "/Users/tednunes/Projects/granted-bio/etl/semantic_results/semantic_271-280.csv"

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['application_id', 'primary_category', 'category_confidence',
                        'secondary_category', 'org_type', 'reasoning'])
        for result in all_results:
            writer.writerow(result)

    print(f"\nTotal projects processed: {len(all_results)}")
    print(f"Output written to: {output_path}")

    # Summary stats
    from collections import Counter
    categories = Counter(r[1] for r in all_results)
    print("\nCategory distribution:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

if __name__ == '__main__':
    main()
