#!/usr/bin/env python3
"""
Semantic classifier for NIH grants based on PROJECT_PROMPT_SEMANTIC.md rules.

Key principles:
1. Activity codes are deterministic for training/infrastructure
2. USES a method = basic_research; DEVELOPS a method = biotools
3. SBIR/STTR = product development, never basic_research
4. Behavioral interventions without drugs = other
5. Primary deliverable drives classification, not keywords
"""

import pandas as pd
import re
import sys

# Activity codes that determine classification immediately
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

MULTI_COMPONENT_CODES = {'P01', 'P20', 'P2C', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}


def classify_org_type(org_name, activity_code):
    """Determine organization type."""
    if not org_name:
        return 'other'

    org_upper = org_name.upper()

    # SBIR/STTR = always company
    if activity_code in SBIR_STTR_CODES:
        return 'company'

    # Company indicators
    company_terms = ['LLC', 'INC', 'CORP', 'THERAPEUTICS', 'BIOSCIENCES',
                     'PHARMACEUTICALS', 'BIOTECH', 'BIOPHARMA', 'PHARMA',
                     'TECHNOLOGIES', 'SCIENCES INC', 'HEALTH INC', 'LABS INC',
                     'MEDICAL INC', 'SYSTEMS INC']
    for term in company_terms:
        if term in org_upper:
            return 'company'

    # Research institutes
    research_institutes = ['SCRIPPS', 'BROAD INSTITUTE', 'SALK', 'FRED HUTCHINSON',
                          'SLOAN KETTERING', 'DANA-FARBER', 'COLD SPRING HARBOR',
                          'JACKSON LABORATORY', 'WISTAR', 'ALLEN INSTITUTE',
                          'STOWERS', 'WHITEHEAD', 'VAN ANDEL', 'INSTITUTE FOR',
                          'RESEARCH INSTITUTE', 'LA JOLLA INSTITUTE']
    for term in research_institutes:
        if term in org_upper:
            return 'research_institute'

    # University
    if 'UNIVERSITY' in org_upper or 'COLLEGE' in org_upper:
        return 'university'

    # Hospital (not part of university)
    hospital_terms = ['HOSPITAL', 'MEDICAL CENTER', 'HEALTH SYSTEM', 'CLINIC',
                     "CHILDREN'S", 'MAYO', 'CEDARS-SINAI', 'MOUNT SINAI']
    for term in hospital_terms:
        if term in org_upper and 'UNIVERSITY' not in org_upper:
            return 'hospital'

    return 'other'


def is_core_or_facility(title, abstract):
    """Check if this is a core facility within a multi-component grant."""
    text = (title + ' ' + abstract).lower()

    core_terms = ['administrative core', 'resource core', 'shared facility',
                  'data core', 'biostatistics core', 'imaging core',
                  'service core', 'support core', 'core facility',
                  'shared resource', 'core a:', 'core b:', 'core c:', 'core d:']

    for term in core_terms:
        if term in text:
            return 'infrastructure'

    mentoring_terms = ['mentoring core', 'career development core', 'training core']
    for term in mentoring_terms:
        if term in text:
            return 'training'

    return None


def is_behavioral_intervention(title, abstract):
    """
    Check if this is a behavioral intervention WITHOUT drugs.
    These should be classified as 'other', not therapeutics.
    """
    text = (title + ' ' + abstract).lower()

    behavioral_terms = [
        'behavioral intervention', 'smoking cessation', 'weight management',
        'lifestyle intervention', 'lifestyle modification', 'psychotherapy',
        'cognitive behavioral therapy', 'cbt intervention', 'mindfulness',
        'motivational interviewing', 'health education', 'counseling intervention',
        'school-based intervention', 'community-based intervention',
        'exercise intervention', 'diet intervention', 'physical activity intervention',
        'self-management', 'peer support', 'group therapy', 'family therapy',
        'parent training', 'social skills training', 'executive function training',
        'cognitive training', 'school based', 'school-based'
    ]

    has_behavioral = any(term in text for term in behavioral_terms)

    # Check for drug combination - if drugs involved, it's therapeutics
    drug_terms = ['pharmacotherapy', 'medication', 'drug', 'varenicline', 'bupropion',
                  'naltrexone', 'methadone', 'pharmaceutical', 'combined with medication']
    has_drug = any(term in text for term in drug_terms)

    return has_behavioral and not has_drug


def is_knowledge_focused(title, abstract):
    """
    Check if the primary deliverable is KNOWLEDGE (basic_research).
    Look for mechanism/understanding language as the primary focus.
    """
    text = (title + ' ' + abstract).lower()
    title_lower = title.lower()

    # Strong knowledge signals in title
    knowledge_title_terms = [
        'mechanism', 'role of', 'how', 'why', 'regulation of', 'signaling',
        'pathway', 'neural circuit', 'molecular basis', 'genetic basis',
        'structure of', 'function of', 'biology of', 'understanding',
        'dynamics of'
    ]

    title_knowledge = any(term in title_lower for term in knowledge_title_terms)

    # Knowledge/understanding signals in abstract
    knowledge_terms = [
        'we seek to understand', 'we aim to understand', 'goal is to understand',
        'elucidate the mechanism', 'define the mechanism', 'understand how',
        'understand the role', 'characterize the', 'investigate the role',
        'examine the role', 'explore the', 'determine the mechanism',
        'determine how', 'identify the mechanism', 'uncover the',
        'specific aim 1', 'specific aim 2', 'specific aim 3',
        'central hypothesis', 'our hypothesis is', 'we hypothesize that',
        'we propose that', 'we will test the hypothesis',
        'knowledge gap', 'poorly understood', 'remains unclear',
        'little is known', 'not well understood'
    ]

    knowledge_count = sum(1 for term in knowledge_terms if term in text)

    # Research/study verbs that indicate investigation
    study_verbs = ['investigate', 'characterize', 'examine', 'explore',
                   'determine', 'define', 'elucidate', 'dissect', 'uncover']
    study_count = sum(1 for term in study_verbs if term in text)

    # Strong knowledge focus if title has knowledge terms OR multiple abstract signals
    return title_knowledge or knowledge_count >= 2 or study_count >= 3


def is_tool_development(title, abstract):
    """
    Check if the project DEVELOPS tools/methods/platforms (biotools).
    Critical: must develop, not just use, the tool.
    """
    text = (title + ' ' + abstract).lower()
    title_lower = title.lower()

    # Strong biotools signals in title
    tool_title_terms = [
        'platform for', 'pipeline for', 'tool for', 'assay for', 'method for',
        'development of', 'novel assay', 'novel platform', 'novel method',
        'high-throughput', 'database of', 'resource for'
    ]

    if any(term in title_lower for term in tool_title_terms):
        return True

    # Tool development phrases
    develop_terms = [
        'develop an assay', 'develop a platform', 'develop a tool',
        'develop a method', 'develop a computational', 'develop a novel',
        'create a pipeline', 'build a database', 'publicly available database',
        'develop and validate', 'design and implement', 'create and distribute',
        'resource for the research community', 'tool for researchers',
        'develop new methods', 'method development', 'assay development',
        'platform development', 'develop software', 'open-source tool',
        'will be made available', 'community resource', 'shared resource'
    ]

    return any(term in text for term in develop_terms)


def is_drug_development(title, abstract):
    """
    Check for actual drug/therapy DEVELOPMENT (therapeutics).
    Must be developing treatments, not just studying mechanisms.
    """
    text = (title + ' ' + abstract).lower()
    title_lower = title.lower()

    # Strong therapeutics signals - actual development
    therapeutics_title = [
        'therapy for', 'treatment of', 'therapeutic', 'drug development',
        'clinical trial', 'phase i', 'phase ii', 'phase 1', 'phase 2',
        'inhibitor', 'vaccine', 'car-t', 'gene therapy', 'cell therapy'
    ]

    title_therapeutics = any(term in title_lower for term in therapeutics_title)

    # Development-focused therapeutics terms (not just mentioning therapy context)
    development_terms = [
        'drug discovery', 'drug development', 'drug candidate', 'lead compound',
        'lead optimization', 'hit-to-lead', 'clinical trial', 'phase i trial',
        'phase ii trial', 'phase iii trial', 'phase 1 trial', 'phase 2 trial',
        'preclinical development', 'ind-enabling', 'first-in-human',
        'clinical efficacy', 'clinical development', 'therapeutic development',
        'optimize the drug', 'optimize the compound', 'drug delivery system',
        'vaccine development', 'vaccine candidate', 'immunization strategy',
        'gene therapy development', 'cell therapy development', 'car-t therapy',
        'develop a therapy', 'develop a treatment', 'novel therapy',
        'repurpose', 'drug repurposing'
    ]

    return title_therapeutics or any(term in text for term in development_terms)


def is_diagnostic_development(title, abstract):
    """Check for diagnostic test DEVELOPMENT."""
    text = (title + ' ' + abstract).lower()
    title_lower = title.lower()

    diag_title = ['diagnostic', 'detection of', 'early detection', 'screening for',
                  'biomarker for', 'liquid biopsy', 'point-of-care']

    if any(term in title_lower for term in diag_title):
        return True

    diagnostics_terms = [
        'diagnostic test', 'diagnostic assay', 'clinical test development',
        'develop a biomarker', 'validate a biomarker', 'biomarker panel',
        'biomarker validation', 'point-of-care test', 'poc test', 'rapid test',
        'liquid biopsy', 'companion diagnostic', 'clinical diagnostic',
        'blood-based test', 'clinical biomarker', 'diagnostic accuracy',
        'sensitivity and specificity', 'clinical validation', 'develop a test'
    ]

    return any(term in text for term in diagnostics_terms)


def is_device_development(title, abstract):
    """Check for medical device DEVELOPMENT."""
    text = (title + ' ' + abstract).lower()
    title_lower = title.lower()

    device_title = ['implant', 'prosthe', 'device', 'stent', 'catheter',
                    'neural interface', 'brain-computer', 'scaffold']

    if any(term in title_lower for term in device_title):
        return True

    device_terms = [
        'develop a device', 'design a device', 'medical device', 'implantable',
        'prosthetic', 'prosthesis', 'surgical instrument', 'bioresorbable',
        'tissue-engineered', 'tissue engineered', 'brain-computer interface',
        'neural interface', 'fabricate', 'implant design', 'scaffold design',
        'biomaterial', 'orthopedic device', 'cardiac device', 'pacemaker'
    ]

    return any(term in text for term in device_terms)


def is_digital_health(title, abstract):
    """Check for digital health product DEVELOPMENT."""
    text = (title + ' ' + abstract).lower()
    title_lower = title.lower()

    digital_title = ['app', 'mobile', 'mhealth', 'telemedicine', 'telehealth',
                     'digital', 'ehealth', 'remote monitoring']

    if any(term in title_lower for term in digital_title):
        return True

    digital_terms = [
        'mobile app', 'smartphone app', 'mhealth', 'm-health', 'telemedicine',
        'telehealth', 'clinical decision support', 'electronic health record',
        'ehr integration', 'remote monitoring', 'digital therapeutic',
        'patient-facing', 'clinician-facing', 'web-based tool', 'digital intervention',
        'wearable monitoring'
    ]

    return any(term in text for term in digital_terms)


def is_health_services_or_epi(title, abstract):
    """Check for health services research, epidemiology, implementation science."""
    text = (title + ' ' + abstract).lower()

    other_terms = [
        'health services', 'health policy', 'implementation science',
        'health disparities', 'community health', 'epidemiological',
        'cohort study', 'longitudinal study', 'population-based study',
        'health outcomes research', 'cost-effectiveness', 'quality of care',
        'health care delivery', 'occupational safety', 'environmental health',
        'food safety', 'implementation trial', 'dissemination'
    ]

    return any(term in text for term in other_terms)


def classify_project(row):
    """
    Classify a single NIH project according to semantic rules.
    Returns: (primary_category, confidence, secondary_category, org_type, reasoning)
    """
    app_id = row['application_id']
    title = str(row.get('title', '')) if pd.notna(row.get('title')) else ''
    abstract = str(row.get('abstract', '')) if pd.notna(row.get('abstract')) else ''
    activity_code = str(row.get('activity_code', '')) if pd.notna(row.get('activity_code')) else ''
    org_name = str(row.get('org_name', '')) if pd.notna(row.get('org_name')) else ''

    org_type = classify_org_type(org_name, activity_code)
    secondary = ''

    # ============================================
    # STEP 1: Deterministic activity codes
    # ============================================
    if activity_code in TRAINING_CODES:
        return 'training', 95, '', org_type, f'Activity code {activity_code} is deterministic training'

    if activity_code in INFRASTRUCTURE_CODES:
        return 'infrastructure', 95, '', org_type, f'Activity code {activity_code} is deterministic infrastructure'

    # ============================================
    # STEP 2: Check for cores in multi-component grants
    # ============================================
    if activity_code in MULTI_COMPONENT_CODES:
        core_type = is_core_or_facility(title, abstract)
        if core_type:
            conf = 85 if core_type == 'training' else 82
            return core_type, conf, '', org_type, f'{activity_code} grant with {core_type} core indicators'

    # SEER registries
    if 'SEER' in title.upper() or 'SEER' in abstract.upper():
        return 'infrastructure', 85, '', org_type, 'SEER cancer registry'

    # Special codes
    if activity_code in {'U45', 'UH4'}:
        return 'training', 85, '', org_type, 'Worker safety training program'
    if activity_code == 'U2F':
        return 'other', 85, '', org_type, 'Food safety regulatory'
    if activity_code == 'UC7':
        return 'infrastructure', 85, '', org_type, 'Biosafety lab'

    # ============================================
    # STEP 3: No abstract = unclassified
    # ============================================
    if len(abstract.strip()) < 50:
        return 'other', 0, '', org_type, 'No abstract available'

    # ============================================
    # STEP 4: SBIR/STTR - never basic_research
    # ============================================
    if activity_code in SBIR_STTR_CODES:
        org_type = 'company'
        if is_drug_development(title, abstract):
            return 'therapeutics', 85, '', org_type, 'SBIR/STTR drug/therapy development'
        if is_device_development(title, abstract):
            return 'medical_device', 85, '', org_type, 'SBIR/STTR device development'
        if is_diagnostic_development(title, abstract):
            return 'diagnostics', 85, '', org_type, 'SBIR/STTR diagnostic development'
        if is_digital_health(title, abstract):
            return 'digital_health', 85, '', org_type, 'SBIR/STTR digital health product'
        if is_tool_development(title, abstract):
            return 'biotools', 85, '', org_type, 'SBIR/STTR research tool development'
        return 'therapeutics', 70, '', org_type, 'SBIR/STTR commercial development (default)'

    # ============================================
    # STEP 5: Check for behavioral intervention (-> other)
    # ============================================
    if is_behavioral_intervention(title, abstract):
        return 'other', 82, '', org_type, 'Behavioral intervention without drugs'

    # ============================================
    # STEP 6: Check for clear product development
    # Product development takes priority over knowledge-focused
    # ============================================

    # Check if this is clearly drug development (title-driven)
    title_lower = title.lower()

    # Very strong therapeutics signals in title
    strong_therapeutics_title = [
        'phase i', 'phase ii', 'phase 1', 'phase 2', 'clinical trial',
        'therapy for', 'treatment of', 'therapeutic targeting',
        'drug development', 'vaccine development', 'car-t',
        'cell therapy', 'gene therapy development'
    ]
    if any(term in title_lower for term in strong_therapeutics_title):
        return 'therapeutics', 88, '', org_type, 'Title indicates drug/therapy development'

    # Very strong device signals in title
    strong_device_title = ['implant', 'prosthe', 'stent', 'catheter', 'neural interface']
    if any(term in title_lower for term in strong_device_title):
        return 'medical_device', 85, '', org_type, 'Title indicates device development'

    # Very strong diagnostics signals in title
    strong_diag_title = ['diagnostic', 'early detection', 'screening test', 'liquid biopsy']
    if any(term in title_lower for term in strong_diag_title):
        return 'diagnostics', 85, '', org_type, 'Title indicates diagnostic development'

    # Very strong digital health signals in title
    strong_digital_title = ['app for', 'mobile health', 'mhealth', 'telemedicine', 'telehealth']
    if any(term in title_lower for term in strong_digital_title):
        return 'digital_health', 85, '', org_type, 'Title indicates digital health product'

    # Very strong biotools signals in title
    strong_biotools_title = ['platform for', 'pipeline for', 'tool for', 'method for',
                             'database of', 'resource for', 'assay for']
    if any(term in title_lower for term in strong_biotools_title):
        return 'biotools', 85, '', org_type, 'Title indicates tool/platform development'

    # ============================================
    # STEP 7: Content-based classification
    # Check knowledge vs development focus
    # ============================================

    knowledge_focused = is_knowledge_focused(title, abstract)
    develops_tools = is_tool_development(title, abstract)
    develops_drugs = is_drug_development(title, abstract)
    develops_diagnostics = is_diagnostic_development(title, abstract)
    develops_devices = is_device_development(title, abstract)
    develops_digital = is_digital_health(title, abstract)
    is_epi_hsr = is_health_services_or_epi(title, abstract)

    # Count development signals
    dev_count = sum([develops_tools, develops_drugs, develops_diagnostics,
                     develops_devices, develops_digital])

    # If knowledge-focused AND no strong development signals -> basic_research
    if knowledge_focused and dev_count == 0:
        return 'basic_research', 85, '', org_type, 'Knowledge-focused: understanding mechanisms/biology'

    # If develops tools as primary focus
    if develops_tools and not any([develops_drugs, develops_diagnostics, develops_devices, develops_digital]):
        if knowledge_focused:
            return 'biotools', 80, 'basic_research', org_type, 'Develops tools while studying biology'
        return 'biotools', 85, '', org_type, 'Tool/platform/method development'

    # Clear drug development
    if develops_drugs and not any([develops_tools, develops_diagnostics, develops_devices, develops_digital]):
        return 'therapeutics', 85, '', org_type, 'Drug/therapy development'

    # Clear diagnostics
    if develops_diagnostics and not any([develops_drugs, develops_tools, develops_devices, develops_digital]):
        return 'diagnostics', 85, '', org_type, 'Diagnostic test development'

    # Clear device
    if develops_devices and not any([develops_drugs, develops_diagnostics, develops_tools, develops_digital]):
        return 'medical_device', 85, '', org_type, 'Medical device development'

    # Clear digital health
    if develops_digital and not any([develops_drugs, develops_diagnostics, develops_devices, develops_tools]):
        return 'digital_health', 85, '', org_type, 'Digital health product development'

    # Health services / epidemiology without product development
    if is_epi_hsr and dev_count == 0:
        return 'other', 80, '', org_type, 'Health services research or epidemiology'

    # Multiple development signals - prioritize
    if dev_count > 1:
        priority = [
            ('therapeutics', develops_drugs),
            ('diagnostics', develops_diagnostics),
            ('medical_device', develops_devices),
            ('digital_health', develops_digital),
            ('biotools', develops_tools)
        ]
        primary = None
        for cat, flag in priority:
            if flag:
                if primary is None:
                    primary = cat
                else:
                    secondary = cat
                    break
        if primary:
            return primary, 78, secondary, org_type, f'Multiple signals, prioritizing {primary}'

    # Default: knowledge-focused even without strong signals
    if knowledge_focused:
        return 'basic_research', 80, '', org_type, 'Knowledge-focused with mechanism language'

    # Final fallback
    return 'basic_research', 70, '', org_type, 'Default: unclear deliverable, likely knowledge-focused'


def process_batch(filepath):
    """Process a single batch file and return classified results."""
    df = pd.read_csv(filepath)
    results = []

    for idx, row in df.iterrows():
        primary, conf, secondary, org_type, reasoning = classify_project(row)
        results.append({
            'application_id': row['application_id'],
            'primary_category': primary,
            'category_confidence': conf,
            'secondary_category': secondary,
            'org_type': org_type,
            'reasoning': reasoning
        })

    return pd.DataFrame(results)


def main():
    """Process batches 21-30."""
    batch_dir = '/Users/tednunes/Projects/granted-bio/etl/review_batches'
    output_file = '/Users/tednunes/Projects/granted-bio/etl/semantic_results/semantic_021-030.csv'

    all_results = []

    for batch_num in range(21, 31):
        filepath = f'{batch_dir}/review_batch_{batch_num:04d}.csv'
        print(f'Processing {filepath}...')
        batch_results = process_batch(filepath)
        all_results.append(batch_results)
        print(f'  Processed {len(batch_results)} projects')

    # Combine all results
    combined = pd.concat(all_results, ignore_index=True)

    # Save to CSV
    combined.to_csv(output_file, index=False)
    print(f'\nSaved {len(combined)} classifications to {output_file}')

    # Print summary
    print('\nCategory distribution:')
    print(combined['primary_category'].value_counts())
    print('\nOrg type distribution:')
    print(combined['org_type'].value_counts())
    print('\nConfidence distribution:')
    print(combined['category_confidence'].describe())


if __name__ == '__main__':
    main()
