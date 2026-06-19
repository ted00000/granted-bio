#!/usr/bin/env python3
"""
Semantic classification of NIH grant projects (batches 131-140).
Applies rules from PROJECT_PROMPT_SEMANTIC.md
"""

import pandas as pd
import re
import csv

# Activity codes that are ALWAYS training (confidence 95)
TRAINING_CODES = {
    'T32', 'T34', 'T35', 'T90', 'TL1', 'TL4',
    'F30', 'F31', 'F32', 'F33', 'F99',
    'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2',
    'D43', 'D71', 'R25', 'R90'
}

# Activity codes that are ALWAYS infrastructure (confidence 95)
INFRASTRUCTURE_CODES = {
    'P30', 'P50', 'P51', 'S10', 'G20', 'U13', 'R13', 'U24', 'U2C'
}

# Multi-component grants that need core checking
MULTI_COMPONENT_CODES = {'P01', 'P20', 'P2C', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}

# SBIR/STTR codes (commercial, never basic_research)
SBIR_CODES = {'R41', 'R42', 'R43', 'R44', 'SB1', 'U44'}


def get_org_type(org_name, activity_code):
    """Determine organization type from name and activity code."""
    org_upper = org_name.upper() if pd.notna(org_name) else ""

    # SBIR/STTR always company
    if activity_code in SBIR_CODES:
        return 'company'

    # Company indicators
    company_patterns = ['LLC', 'INC', 'CORP', 'THERAPEUTICS', 'BIOSCIENCES',
                        'PHARMACEUTICALS', 'BIOTECH', 'BIOPHARMA', 'SCIENCES INC',
                        'TECHNOLOGIES', 'HEALTH INC', 'MEDICAL INC', 'LABS INC']
    for pattern in company_patterns:
        if pattern in org_upper:
            return 'company'

    # University indicators
    if 'UNIVERSITY' in org_upper or 'COLLEGE' in org_upper or 'SCHOOL OF' in org_upper:
        return 'university'

    # Research institutes
    research_institutes = ['SCRIPPS', 'BROAD INSTITUTE', 'SALK', 'FRED HUTCHINSON',
                          'SLOAN KETTERING', 'DANA-FARBER', 'DANA FARBER', 'COLD SPRING HARBOR',
                          'JACKSON LABORATORY', 'WISTAR', 'ALLEN INSTITUTE', 'STOWERS',
                          'WHITEHEAD', 'VAN ANDEL', 'MOFFITT', 'RESEARCH INSTITUTE',
                          'RESEARCH CENTER', 'RESEARCH FOUNDATION', 'INSTITUTE FOR']
    for inst in research_institutes:
        if inst in org_upper:
            return 'research_institute'

    # Hospital indicators
    hospital_patterns = ['HOSPITAL', 'MEDICAL CENTER', 'HEALTH SYSTEM', 'CLINIC',
                         'CHILDREN\'S', 'CHILDRENS']
    for pattern in hospital_patterns:
        if pattern in org_upper and 'UNIVERSITY' not in org_upper:
            return 'hospital'

    return 'other'


def is_core_or_support(title, abstract):
    """Check if project is a core/support facility within multi-component grant."""
    text = (str(title) + ' ' + str(abstract)[:500]).lower()

    core_patterns = [
        'administrative core', 'admin core', 'resource core', 'shared facility',
        'data core', 'biostatistics core', 'statistics core', 'imaging core',
        'service core', 'support core', 'core facility', 'shared resource',
        'biorepository core', 'informatics core', 'animal core', 'tissue core',
        'proteomics core', 'genomics core', 'bioinformatics core', 'core services'
    ]

    for pattern in core_patterns:
        if pattern in text:
            return 'infrastructure'

    mentoring_patterns = ['career development', 'mentoring core', 'training core',
                          'education core', 'pilot project']
    for pattern in mentoring_patterns:
        if pattern in text:
            if 'pilot project' in pattern:
                return None  # Pilot projects within grants are usually research
            return 'training'

    return None


def classify_project(row):
    """
    Classify a single project according to semantic rules.
    Returns: (primary_category, confidence, secondary_category, org_type, reasoning)
    """
    app_id = row['application_id']
    title = str(row['title']) if pd.notna(row['title']) else ""
    abstract = str(row['abstract']) if pd.notna(row['abstract']) else ""
    activity_code = str(row['activity_code']) if pd.notna(row['activity_code']) else ""
    org_name = str(row['org_name']) if pd.notna(row['org_name']) else ""

    text = (title + ' ' + abstract).lower()
    title_lower = title.lower()

    # Determine org type
    org_type = get_org_type(org_name, activity_code)

    # Step 1: Check activity code FIRST (deterministic rules)
    if activity_code in TRAINING_CODES:
        return ('training', 95, '', org_type, f'Activity code {activity_code} is always training')

    if activity_code in INFRASTRUCTURE_CODES:
        return ('infrastructure', 95, '', org_type, f'Activity code {activity_code} is always infrastructure')

    # Step 2: Check for cores in multi-component grants
    if activity_code in MULTI_COMPONENT_CODES:
        core_type = is_core_or_support(title, abstract)
        if core_type == 'infrastructure':
            return ('infrastructure', 82, '', org_type, f'Core/support facility within {activity_code} grant')
        elif core_type == 'training':
            return ('training', 85, '', org_type, f'Career development/mentoring core within {activity_code} grant')

    # No abstract - unclassified
    if len(abstract) < 50:
        return ('other', 0, '', org_type, 'Insufficient abstract for classification')

    # Step 3: SBIR/STTR - never basic_research
    is_sbir = activity_code in SBIR_CODES

    # Step 4: Content-based classification

    # --- BIOTOOLS detection (DEVELOPS a method/tool/platform) ---
    biotools_signals = [
        'develop a' in text and ('assay' in text or 'platform' in text or 'method' in text or 'tool' in text or 'pipeline' in text),
        'develop an' in text and ('assay' in text or 'algorithm' in text),
        'novel assay' in text,
        'novel probe' in text,
        'novel platform' in text,
        'create a' in text and ('platform' in text or 'database' in text or 'tool' in text or 'pipeline' in text),
        'build a' in text and ('database' in text or 'platform' in text or 'pipeline' in text),
        'computational tool' in text,
        'computational pipeline' in text,
        'reference standard' in text,
        'high-throughput screening platform' in text,
        'imaging platform' in text,
        'develop and validate' in text and ('assay' in text or 'method' in text),
        'publicly available database' in text,
        'develop new' in text and ('method' in text or 'approach' in text or 'technique' in text),
        'novel method' in text and ('develop' in text or 'create' in text),
        'software tool' in text,
        'we will develop' in text and ('method' in text or 'tool' in text or 'platform' in text or 'assay' in text),
        'novel imaging' in text and 'method' in text,
    ]

    # --- THERAPEUTICS detection ---
    therapeutics_signals = [
        'drug discovery' in text,
        'drug development' in text,
        'drug candidate' in text,
        'lead compound' in text,
        'therapeutic' in text and ('develop' in text or 'novel' in text or 'target' in text),
        'gene therapy' in text,
        'cell therapy' in text,
        'car-t' in text or 'car t' in text,
        'vaccine' in text and ('develop' in text or 'design' in text or 'candidate' in text),
        'immunotherapy' in text and ('develop' in text or 'novel' in text),
        'clinical trial' in text,
        'phase i' in text or 'phase ii' in text or 'phase iii' in text,
        'phase 1' in text or 'phase 2' in text or 'phase 3' in text,
        'efficacy' in text and ('compound' in text or 'drug' in text or 'treatment' in text),
        'pharmacological' in text and 'intervention' in text,
        'drug delivery' in text,
        'small molecule' in text and ('inhibitor' in text or 'therapeutic' in text),
        'optimize' in text and ('compound' in text or 'drug' in text or 'therapy' in text),
        'treatment' in text and ('develop' in text or 'novel' in text or 'new' in text),
        'nanoparticle' in text and ('delivery' in text or 'therapeutic' in text),
        'antiviral' in text or 'antibacterial' in text or 'antimicrobial' in text,
        'inhibitor' in text and ('develop' in text or 'novel' in text or 'design' in text),
    ]

    # --- DIAGNOSTICS detection ---
    diagnostics_signals = [
        'diagnostic' in text and ('develop' in text or 'validate' in text or 'clinical' in text),
        'biomarker panel' in text and ('clinical' in text or 'validate' in text),
        'point-of-care' in text or 'point of care' in text,
        'screening test' in text,
        'companion diagnostic' in text,
        'liquid biopsy' in text and ('clinical' in text or 'detection' in text),
        'early detection' in text and ('biomarker' in text or 'test' in text or 'assay' in text),
        'clinical test' in text,
        'blood-based' in text and ('biomarker' in text or 'test' in text or 'detection' in text),
        'diagnostic tool' in text,
        'clinical biomarker' in text,
        'diagnostic assay' in text,
    ]

    # --- MEDICAL DEVICE detection ---
    device_signals = [
        'implant' in text and ('design' in text or 'develop' in text or 'fabricate' in text),
        'prosthetic' in text or 'prosthesis' in text,
        'surgical instrument' in text,
        'stent' in text and ('develop' in text or 'design' in text),
        'catheter' in text and ('develop' in text or 'design' in text or 'novel' in text),
        'wearable' in text and ('device' in text or 'therapeutic' in text),
        'tissue-engineered' in text or 'tissue engineered' in text,
        'brain-computer interface' in text or 'brain computer interface' in text,
        'neural interface' in text and ('implant' in text or 'develop' in text),
        'medical device' in text,
        'bioresorbable' in text,
        'implantable' in text and ('device' in text or 'sensor' in text),
    ]

    # --- DIGITAL HEALTH detection ---
    digital_health_signals = [
        'mobile app' in text or 'mhealth' in text or 'm-health' in text,
        'telemedicine' in text or 'telehealth' in text,
        'clinical decision support' in text,
        'ehr' in text and ('tool' in text or 'system' in text or 'integration' in text),
        'electronic health record' in text,
        'remote monitoring' in text and ('patient' in text or 'system' in text),
        'digital therapeutic' in text,
        'patient-facing' in text and ('app' in text or 'software' in text or 'tool' in text),
        'smartphone' in text and ('intervention' in text or 'app' in text or 'based' in text),
        'digital intervention' in text,
        'web-based' in text and ('intervention' in text or 'platform' in text),
        'digital health' in text,
    ]

    # --- OTHER (behavioral, epidemiology, health services) detection ---
    other_signals = [
        'behavioral intervention' in text and 'drug' not in text and 'pharmacolog' not in text,
        'smoking cessation' in text and 'varenicline' not in text and 'nicotine replacement' not in text,
        'cognitive behavioral therapy' in text or 'cbt' in text,
        'mindfulness' in text and 'intervention' in text,
        'lifestyle' in text and ('modification' in text or 'intervention' in text),
        'community-based' in text and 'intervention' in text,
        'health disparities' in text,
        'implementation science' in text,
        'cohort study' in text or 'longitudinal study' in text,
        'epidemiolog' in text,
        'health services research' in text,
        'health policy' in text,
        'occupational safety' in text or 'occupational health' in text,
        'randomized' in text and 'behavioral' in text and 'drug' not in text,
    ]

    # --- BASIC RESEARCH detection (knowledge/understanding/mechanisms) ---
    basic_signals = [
        'mechanism' in text and ('understand' in text or 'elucidate' in text or 'investigate' in text or 'dissect' in text),
        'role of' in text and ('gene' in text or 'protein' in text or 'pathway' in text),
        'how do' in text or 'how does' in text,
        'neural circuit' in text and 'encode' in text,
        'pathway' in text and ('signal' in text or 'molecular' in text) and 'develop' not in text,
        'understand' in text and ('biology' in text or 'disease' in text or 'process' in text),
        'identify' in text and ('gene' in text or 'protein' in text or 'marker' in text) and 'clinical' not in text,
        'characterize' in text and ('protein' in text or 'cell' in text or 'pathway' in text),
        'investigate' in text and ('role' in text or 'function' in text or 'mechanism' in text),
        'elucidate' in text,
        'determine' in text and ('mechanism' in text or 'role' in text or 'how' in text),
    ]

    # Count signals for each category
    biotools_score = sum(biotools_signals)
    therapeutics_score = sum(therapeutics_signals)
    diagnostics_score = sum(diagnostics_signals)
    device_score = sum(device_signals)
    digital_score = sum(digital_health_signals)
    other_score = sum(other_signals)
    basic_score = sum(basic_signals)

    # Build scores dict
    scores = {
        'biotools': biotools_score,
        'therapeutics': therapeutics_score,
        'diagnostics': diagnostics_score,
        'medical_device': device_score,
        'digital_health': digital_score,
        'other': other_score,
        'basic_research': basic_score
    }

    # Special handling for SBIR/STTR - boost non-basic categories, eliminate basic_research
    if is_sbir:
        scores['basic_research'] = 0  # Never basic_research for SBIR
        # If no clear signals, default to therapeutics for SBIR
        if max(scores.values()) == 0:
            return ('therapeutics', 75, '', 'company', 'SBIR/STTR grant, likely product development')

    # Special case: tobacco/nicotine policy research (not therapeutics)
    if 'nicotine' in text and 'cigarette' in text and ('policy' in text or 'standard' in text or 'regulation' in text):
        if 'vlnc' in text or 'very low nicotine' in text or 'nicotine-limiting' in text or 'nicotine reduction' in text:
            return ('other', 78, '', org_type, 'Tobacco policy/regulation research')

    # Special handling: behavioral intervention with drugs = therapeutics
    if ('behavioral' in text or 'cbt' in text or 'cognitive behavioral' in text):
        if any(drug in text for drug in ['varenicline', 'bupropion', 'naltrexone', 'methadone', 'pharmacotherapy', 'medication']):
            scores['therapeutics'] += 3
            scores['other'] = 0

    # Get top two categories
    sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    primary_cat = sorted_scores[0][0]
    primary_score = sorted_scores[0][1]
    secondary_cat = sorted_scores[1][0] if sorted_scores[1][1] > 0 else ''
    secondary_score = sorted_scores[1][1]

    # If no clear signals, use heuristics
    if primary_score == 0:
        # Default heuristics
        if 'drug' in text or 'treatment' in text or 'therapy' in text:
            # Check if it's about developing or using
            if 'develop' in text or 'design' in text or 'optimize' in text or 'novel' in text:
                primary_cat = 'therapeutics'
                confidence = 65
            else:
                primary_cat = 'basic_research'
                confidence = 60
        elif 'mechanism' in text or 'pathway' in text or 'understand' in text:
            primary_cat = 'basic_research'
            confidence = 65
        else:
            primary_cat = 'basic_research'
            confidence = 55

        return (primary_cat, confidence, '', org_type, 'Low signal classification')

    # Calculate confidence based on signal strength and competition
    if primary_score >= 3:
        confidence = 85
    elif primary_score == 2:
        confidence = 78
    elif primary_score == 1:
        confidence = 68
    else:
        confidence = 58

    # Reduce confidence if secondary category is competitive
    if secondary_score > 0 and secondary_score >= primary_score - 1:
        confidence -= 8
        # Include secondary category if genuinely spans
        if secondary_score >= primary_score - 1:
            pass  # Keep secondary
        else:
            secondary_cat = ''
    else:
        secondary_cat = ''

    # Generate reasoning
    reasoning = f'{primary_cat.replace("_", " ").title()} signals detected'
    if secondary_cat:
        reasoning += f'; secondary {secondary_cat.replace("_", " ")} elements'

    return (primary_cat, confidence, secondary_cat, org_type, reasoning)


def main():
    # Load all batches
    all_data = []
    for i in range(131, 141):
        filename = f'review_batches/review_batch_{i:04d}.csv'
        df = pd.read_csv(filename)
        all_data.append(df)

    combined = pd.concat(all_data, ignore_index=True)
    print(f"Processing {len(combined)} projects...")

    # Classify each project
    results = []
    for idx, row in combined.iterrows():
        primary_cat, confidence, secondary_cat, org_type, reasoning = classify_project(row)
        results.append({
            'application_id': row['application_id'],
            'primary_category': primary_cat,
            'category_confidence': confidence,
            'secondary_category': secondary_cat,
            'org_type': org_type,
            'reasoning': reasoning
        })

        if (idx + 1) % 50 == 0:
            print(f"  Processed {idx + 1} projects...")

    # Create output DataFrame
    output_df = pd.DataFrame(results)

    # Write to CSV
    output_path = 'semantic_results/semantic_131-140.csv'
    output_df.to_csv(output_path, index=False, quoting=csv.QUOTE_MINIMAL)
    print(f"\nOutput written to {output_path}")

    # Print summary statistics
    print(f"\nCategory distribution:")
    print(output_df['primary_category'].value_counts())
    print(f"\nAverage confidence: {output_df['category_confidence'].mean():.1f}")
    print(f"Projects with secondary category: {(output_df['secondary_category'] != '').sum()}")
    print(f"\nOrg type distribution:")
    print(output_df['org_type'].value_counts())


if __name__ == '__main__':
    main()
