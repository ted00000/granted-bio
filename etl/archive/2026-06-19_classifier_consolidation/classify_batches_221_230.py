#!/usr/bin/env python3
"""
Semantic classification of NIH grants - Batches 221-230
Following rules from PROJECT_PROMPT_SEMANTIC.md
"""

import pandas as pd
import re
import os

# Activity codes that are always training (confidence 95)
TRAINING_CODES = {
    'T32', 'T34', 'T35', 'T90', 'TL1', 'TL4',
    'F30', 'F31', 'F32', 'F33', 'F99',
    'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2', 'K00',
    'D43', 'D71', 'R25', 'R90'
}

# Activity codes that are always infrastructure (confidence 95)
INFRASTRUCTURE_CODES = {
    'P30', 'P50', 'P51', 'S10', 'G20', 'U13', 'R13', 'U24', 'U2C'
}

# SBIR/STTR codes - never basic_research, org_type = company
SBIR_CODES = {'R41', 'R42', 'R43', 'R44', 'SB1', 'U44'}

# Multi-component grants (check for cores)
MULTI_COMPONENT_CODES = {'P01', 'P20', 'P2C', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}

def classify_org_type(org_name, activity_code):
    """Classify organization type"""
    if activity_code in SBIR_CODES:
        return 'company'

    org_lower = org_name.lower() if org_name else ''

    # Company indicators
    company_patterns = ['llc', 'inc.', 'inc,', 'corp.', 'corp,', 'therapeutics', 'biosciences',
                       'pharmaceuticals', 'biotech', 'biopharma', 'pharma', 'sciences, inc',
                       'medical, inc', 'health, inc', ', inc']
    if any(p in org_lower for p in company_patterns):
        return 'company'

    # University indicators
    if 'university' in org_lower or 'college' in org_lower or 'school of' in org_lower:
        return 'university'

    # Research institute indicators
    research_institutes = ['scripps', 'broad institute', 'salk', 'fred hutchinson', 'hutch',
                          'sloan kettering', 'dana-farber', 'cold spring harbor', 'jackson laboratory',
                          'wistar', 'allen institute', 'stowers', 'whitehead', 'van andel',
                          'research institute', 'institute for']
    if any(ri in org_lower for ri in research_institutes):
        return 'research_institute'

    # Hospital indicators
    hospital_patterns = ['hospital', 'medical center', 'health system', 'clinic', "children's",
                        'mayo', 'cleveland clinic']
    if any(h in org_lower for h in hospital_patterns):
        # Exception: if university comes before medical center, it's university
        if 'university' in org_lower:
            univ_pos = org_lower.find('university')
            med_pos = min([org_lower.find(h) for h in hospital_patterns if h in org_lower])
            if univ_pos < med_pos:
                return 'university'
        return 'hospital'

    return 'other'

def is_core_project(title, abstract):
    """Check if this is a core/support project within a multi-component grant"""
    text = f"{title or ''} {abstract or ''}".lower()
    core_indicators = ['administrative core', 'admin core', 'resource core', 'shared facility',
                      'data core', 'biostatistics core', 'imaging core', 'service core',
                      'support core', 'core facility', 'shared resource']
    return any(c in text for c in core_indicators)

def is_mentoring_core(title, abstract):
    """Check if this is a mentoring/career development core"""
    text = f"{title or ''} {abstract or ''}".lower()
    mentoring_indicators = ['mentoring core', 'career development core', 'training core',
                           'education core']
    return any(m in text for m in mentoring_indicators)

def classify_by_deliverable(title, abstract, phr, activity_code, org_name):
    """
    Classify by primary deliverable following semantic rules.
    Returns (primary_category, confidence, secondary_category, reasoning)
    """
    text = f"{title or ''} {abstract or ''} {phr or ''}".lower()
    title_lower = (title or '').lower()
    abstract_lower = (abstract or '').lower()

    # If abstract is missing or very short
    if not abstract or len(str(abstract).strip()) < 50:
        return 'other', 0, '', 'No abstract available'

    # Behavioral intervention check (without drugs = other)
    behavioral_patterns = ['behavioral intervention', 'cognitive behavioral therapy', 'cbt',
                          'motivational interviewing', 'lifestyle intervention', 'behavior change',
                          'smoking cessation', 'weight management', 'mindfulness',
                          'psychotherapy', 'counseling intervention', 'psychosocial intervention']
    drug_patterns = ['drug', 'pharmacolog', 'medication', 'varenicline', 'bupropion',
                    'pharmaceutical', 'compound', 'molecule', 'inhibitor', 'therapeutic agent']

    is_behavioral = any(b in text for b in behavioral_patterns)
    has_drug = any(d in text for d in drug_patterns)

    if is_behavioral and not has_drug:
        return 'other', 80, '', 'Behavioral intervention without pharmacotherapy'

    # DEVELOPS vs USES - key distinction
    develops_indicators = ['develop', 'create', 'build', 'design', 'engineer', 'fabricate',
                          'novel platform', 'novel tool', 'novel assay', 'novel probe',
                          'new method', 'new approach', 'new platform', 'new tool',
                          'we will develop', 'we will create', 'we will build',
                          'develop and validate', 'develop and test', 'develop a method',
                          'computational pipeline', 'develop an assay', 'develop a platform',
                          'develop a tool', 'reference standard']

    # Check for biotools indicators
    biotools_patterns = ['develop.{0,20}assay', 'develop.{0,20}platform', 'develop.{0,20}tool',
                        'novel probe', 'imaging platform', 'screening platform',
                        'computational tool', 'software tool', 'database', 'resource for',
                        'publicly available', 'community resource', 'shared resource',
                        'develop.{0,20}method', 'new imaging method', 'new analytical method']

    is_biotools = any(re.search(p, text) for p in biotools_patterns)

    # Check for therapeutics indicators
    therapeutics_patterns = ['drug discovery', 'drug development', 'drug candidate', 'lead compound',
                            'clinical trial', 'phase i', 'phase ii', 'phase iii', 'phase 1', 'phase 2',
                            'gene therapy', 'cell therapy', 'car-t', 'car t', 'immunotherapy',
                            'vaccine development', 'therapeutic', 'treatment', 'treat patients',
                            'drug delivery', 'pharmacokinetic', 'pharmacodynamic', 'efficacy',
                            'optimize.{0,20}compound', 'optimize.{0,20}drug', 'clinical efficacy',
                            'preclinical', 'lead optimization', 'hit-to-lead', 'drug target',
                            'antiviral', 'antibody therapy', 'monoclonal antibody']

    is_therapeutics = any(re.search(p, text) for p in therapeutics_patterns) if text else False

    # Check for diagnostics indicators
    diagnostics_patterns = ['diagnostic', 'early detection', 'biomarker panel', 'clinical test',
                           'screening test', 'companion diagnostic', 'point-of-care',
                           'liquid biopsy', 'clinical validation', 'validate.{0,20}biomarker',
                           'detect.{0,20}cancer', 'blood-based detection', 'clinical biomarker']

    is_diagnostics = any(re.search(p, text) for p in diagnostics_patterns)

    # Check for medical device indicators
    device_patterns = ['implant', 'prosthetic', 'surgical instrument', 'stent', 'catheter',
                      'wearable device', 'implantable', 'neural interface', 'brain-computer',
                      'medical device', 'tissue engineered', 'bioresorbable', 'scaffold',
                      'electrode', 'sensor device']

    is_device = any(d in text for d in device_patterns)

    # Check for digital health indicators
    digital_patterns = ['mobile app', 'mhealth', 'm-health', 'telemedicine', 'telehealth',
                       'clinical decision support', 'ehr', 'electronic health record',
                       'remote monitoring', 'digital therapeutic', 'patient-facing',
                       'clinician-facing', 'health app', 'smartphone app']

    is_digital = any(d in text for d in digital_patterns)

    # Check for basic research indicators
    basic_research_patterns = ['mechanism', 'pathway', 'understand', 'elucidate', 'investigate',
                              'determine the role', 'explore', 'characterize', 'identify the',
                              'how does', 'what role', 'molecular basis', 'neural circuits',
                              'signaling pathway', 'gene regulation', 'protein function',
                              'biological process', 'disease mechanism', 'pathogenesis']

    is_basic = any(b in text for b in basic_research_patterns)

    # Check for epidemiology/cohort/population studies
    epi_patterns = ['cohort study', 'epidemiolog', 'population-based', 'longitudinal study',
                   'risk factor', 'health disparity', 'health disparities', 'community health',
                   'public health', 'health services', 'implementation science',
                   'health policy', 'surveillance', 'registry']

    is_epi = any(e in text for e in epi_patterns)

    # Priority-based classification
    # SBIR/STTR: never basic_research
    if activity_code in SBIR_CODES:
        if is_therapeutics:
            return 'therapeutics', 85, '', 'SBIR/STTR drug/therapy development'
        elif is_device:
            return 'medical_device', 85, '', 'SBIR/STTR device development'
        elif is_diagnostics:
            return 'diagnostics', 85, '', 'SBIR/STTR diagnostic development'
        elif is_biotools:
            return 'biotools', 85, '', 'SBIR/STTR research tool development'
        elif is_digital:
            return 'digital_health', 85, '', 'SBIR/STTR digital health product'
        else:
            # Default SBIR to biotools or therapeutics based on content
            return 'therapeutics', 75, '', 'SBIR/STTR commercial development'

    # Clear device
    if is_device and ('develop' in text or 'design' in text or 'fabricate' in text or 'engineer' in text):
        secondary = 'therapeutics' if is_therapeutics else ''
        return 'medical_device', 85, secondary, 'Develops medical device'

    # Clear digital health
    if is_digital and ('develop' in text or 'deploy' in text or 'implement' in text):
        return 'digital_health', 85, '', 'Develops patient/clinician-facing software'

    # Clear diagnostics (developing clinical test)
    if is_diagnostics and any(d in text for d in develops_indicators):
        secondary = 'biotools' if is_biotools else ''
        return 'diagnostics', 85, secondary, 'Develops clinical diagnostic test'

    # Clear therapeutics (drug/therapy development)
    if is_therapeutics and not is_basic:
        # Check if therapeutics is primary focus
        if any(t in title_lower for t in ['therapy', 'therapeutic', 'treatment', 'drug', 'clinical trial']):
            secondary = 'basic_research' if is_basic else ''
            return 'therapeutics', 85, secondary, 'Drug/therapy development or clinical trial'
        elif 'clinical trial' in text or 'phase' in text:
            return 'therapeutics', 90, '', 'Clinical trial'
        else:
            return 'therapeutics', 80, '', 'Therapeutic development'

    # Biotools - developing research tools/methods/platforms
    if is_biotools:
        secondary = 'basic_research' if is_basic else ''
        return 'biotools', 85, secondary, 'Develops research tool/method/platform'

    # Epidemiology and population health
    if is_epi:
        return 'other', 80, '', 'Epidemiology/population health/health services research'

    # Basic research (understanding mechanisms)
    if is_basic:
        # Check if actually using methods to understand biology
        uses_indicators = ['using', 'we will use', 'we use', 'employ', 'utilize', 'apply']
        if any(u in text for u in uses_indicators) and not any(d in text for d in develops_indicators[:6]):
            secondary = ''
            if is_therapeutics:
                secondary = 'therapeutics'
            return 'basic_research', 85, secondary, 'Uses methods to understand biology/mechanisms'
        return 'basic_research', 80, '', 'Knowledge/mechanism discovery'

    # Default to other
    return 'other', 70, '', 'Does not clearly fit other categories'

def classify_project(row):
    """Main classification function for a single project"""
    app_id = row['application_id']
    activity_code = str(row['activity_code']).strip() if pd.notna(row['activity_code']) else ''
    title = str(row['title']) if pd.notna(row['title']) else ''
    abstract = str(row['abstract']) if pd.notna(row['abstract']) else ''
    phr = str(row['phr']) if pd.notna(row.get('phr', '')) else ''
    org_name = str(row['org_name']) if pd.notna(row['org_name']) else ''

    # Step 1: Check activity code for deterministic classification
    if activity_code in TRAINING_CODES:
        org_type = classify_org_type(org_name, activity_code)
        return {
            'application_id': app_id,
            'primary_category': 'training',
            'category_confidence': 95,
            'secondary_category': '',
            'org_type': org_type,
            'reasoning': f'Activity code {activity_code} is always training'
        }

    if activity_code in INFRASTRUCTURE_CODES:
        org_type = classify_org_type(org_name, activity_code)
        return {
            'application_id': app_id,
            'primary_category': 'infrastructure',
            'category_confidence': 95,
            'secondary_category': '',
            'org_type': org_type,
            'reasoning': f'Activity code {activity_code} is always infrastructure'
        }

    # Step 2: Check for cores in multi-component grants
    if activity_code in MULTI_COMPONENT_CODES:
        if is_core_project(title, abstract):
            org_type = classify_org_type(org_name, activity_code)
            return {
                'application_id': app_id,
                'primary_category': 'infrastructure',
                'category_confidence': 83,
                'secondary_category': '',
                'org_type': org_type,
                'reasoning': 'Core/support facility within multi-component grant'
            }
        if is_mentoring_core(title, abstract):
            org_type = classify_org_type(org_name, activity_code)
            return {
                'application_id': app_id,
                'primary_category': 'training',
                'category_confidence': 85,
                'secondary_category': '',
                'org_type': org_type,
                'reasoning': 'Mentoring/career development core'
            }

    # Check for U10/UG1 clinical trial network sites
    if activity_code in ['U10', 'UG1']:
        text = f"{title} {abstract}".lower()
        if 'network' in text or 'site' in text or 'clinical trial network' in text:
            org_type = classify_org_type(org_name, activity_code)
            return {
                'application_id': app_id,
                'primary_category': 'infrastructure',
                'category_confidence': 80,
                'secondary_category': '',
                'org_type': org_type,
                'reasoning': 'Clinical trial network site'
            }

    # Check for SEER registries
    text = f"{title} {abstract}".lower()
    if 'seer' in text and ('registry' in text or 'registries' in text):
        org_type = classify_org_type(org_name, activity_code)
        return {
            'application_id': app_id,
            'primary_category': 'infrastructure',
            'category_confidence': 85,
            'secondary_category': '',
            'org_type': org_type,
            'reasoning': 'SEER cancer registry'
        }

    # Step 3: Classify by primary deliverable
    primary_cat, confidence, secondary_cat, reasoning = classify_by_deliverable(
        title, abstract, phr, activity_code, org_name
    )

    org_type = classify_org_type(org_name, activity_code)

    return {
        'application_id': app_id,
        'primary_category': primary_cat,
        'category_confidence': confidence,
        'secondary_category': secondary_cat,
        'org_type': org_type,
        'reasoning': reasoning
    }

def main():
    # Load all batch files
    batch_dir = '/Users/tednunes/Projects/granted-bio/etl/review_batches'
    dfs = []
    for i in range(221, 231):
        path = f'{batch_dir}/review_batch_{i:04d}.csv'
        df = pd.read_csv(path)
        dfs.append(df)

    combined = pd.concat(dfs, ignore_index=True)
    print(f"Total projects to classify: {len(combined)}")

    # Classify each project
    results = []
    for idx, row in combined.iterrows():
        result = classify_project(row)
        results.append(result)
        if (idx + 1) % 100 == 0:
            print(f"Classified {idx + 1}/{len(combined)} projects")

    # Create results DataFrame
    results_df = pd.DataFrame(results)

    # Output to CSV
    output_path = '/Users/tednunes/Projects/granted-bio/etl/semantic_results/semantic_221-230.csv'
    results_df.to_csv(output_path, index=False)
    print(f"\nResults saved to {output_path}")

    # Print summary statistics
    print("\n=== Classification Summary ===")
    print(results_df['primary_category'].value_counts())
    print(f"\nMean confidence: {results_df['category_confidence'].mean():.1f}")
    print(f"\nOrg type distribution:")
    print(results_df['org_type'].value_counts())
    print(f"\nProjects with secondary category: {(results_df['secondary_category'] != '').sum()}")

if __name__ == '__main__':
    main()
