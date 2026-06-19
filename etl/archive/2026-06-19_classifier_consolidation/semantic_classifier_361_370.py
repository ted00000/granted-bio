#!/usr/bin/env python3
"""
Semantic classifier for NIH grants - batches 361-370
Applies classification rules from PROJECT_PROMPT_SEMANTIC.md
"""

import csv
import re
import os

# Activity codes with deterministic classifications
TRAINING_CODES = {
    'T32', 'T34', 'T35', 'T90', 'TL1', 'TL4',
    'F30', 'F31', 'F32', 'F33', 'F99',
    'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2',
    'D43', 'D71', 'R25', 'R90'
}

INFRASTRUCTURE_CODES = {'P30', 'P50', 'P51', 'S10', 'G20', 'U13', 'R13', 'U24', 'U2C'}

SBIR_CODES = {'R41', 'R42', 'R43', 'R44', 'SB1', 'U44'}

MULTI_COMPONENT_CODES = {'P01', 'P20', 'P2C', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}

# Org type classification patterns
COMPANY_PATTERNS = [
    r'\bLLC\b', r'\bInc\.?\b', r'\bCorp\.?\b', r'\bCorporation\b',
    r'\bTherapeutics\b', r'\bBiosciences\b', r'\bPharmaceuticals?\b',
    r'\bBiotech\b', r'\bBiopharma\b', r'\bLtd\.?\b', r'\bLP\b',
    r'\bLimited\b', r'\bPharma\b', r'\bDiagnostics\b', r'\bMedical\s+Inc\b'
]

RESEARCH_INSTITUTE_PATTERNS = [
    r'\bScripps\b', r'\bBroad Institute\b', r'\bSalk\b', r'\bFred Hutch',
    r'\bSloan.?Kettering\b', r'\bDana.?Farber\b', r'\bCold Spring Harbor\b',
    r'\bJackson Lab', r'\bWistar\b', r'\bAllen Institute\b', r'\bStowers\b',
    r'\bWhitehead\b', r'\bVan Andel\b', r'\bResearch Institute\b',
    r'\bInstitute for\b', r'\bInstitute of\b', r'\bHoward Hughes\b',
    r'\bSanford.?Burnham\b', r'\bLa Jolla\b', r'\bBarnabas\b'
]

HOSPITAL_PATTERNS = [
    r'\bHospital\b', r'\bMedical Center\b', r'\bHealth System\b',
    r'\bClinic\b', r'\bChildren\'?s\b', r'\bMayo\b', r'\bCleveland Clinic\b',
    r'\bHealth Care\b', r'\bHealthcare\b'
]


def classify_org_type(org_name, activity_code):
    """Classify organization type based on name and activity code."""
    if not org_name:
        return 'other'

    org_upper = org_name.upper()

    # SBIR/STTR always company
    if activity_code in SBIR_CODES:
        return 'company'

    # Check for company patterns
    for pattern in COMPANY_PATTERNS:
        if re.search(pattern, org_name, re.IGNORECASE):
            return 'company'

    # Check for research institute
    for pattern in RESEARCH_INSTITUTE_PATTERNS:
        if re.search(pattern, org_name, re.IGNORECASE):
            return 'research_institute'

    # Check for university - do this before hospital
    if re.search(r'\bUNIVERSIT', org_upper) or re.search(r'\bCOLLEGE\b', org_upper):
        return 'university'

    # Check for hospital patterns (only if not university)
    for pattern in HOSPITAL_PATTERNS:
        if re.search(pattern, org_name, re.IGNORECASE):
            # But check if it's a university medical center
            if 'UNIVERSITY' in org_upper:
                return 'university'
            return 'hospital'

    # Government/VA/NIH
    if 'VETERANS' in org_upper or re.search(r'\bVA\b', org_upper) or 'NIH' in org_upper:
        return 'other'

    return 'university'  # Default to university for academic-sounding orgs


def is_core_project(title, abstract):
    """Check if project is a core/support facility within a multi-component grant."""
    text = (title + ' ' + (abstract or '')).lower()
    core_patterns = [
        r'\bcore\b', r'\badministrative\b', r'\bshared resource', r'\bshared facility',
        r'\bservice core\b', r'\bdata core\b', r'\bbiostatistics\b.*\bcore',
        r'\bimaging core\b', r'\bresource core\b'
    ]
    for pattern in core_patterns:
        if re.search(pattern, text):
            return True
    return False


def is_mentoring_core(title, abstract):
    """Check if project is a mentoring/career development core."""
    text = (title + ' ' + (abstract or '')).lower()
    return bool(re.search(r'\bmentor', text) and re.search(r'\bcore\b', text)) or \
           bool(re.search(r'\bcareer development\b.*\bcore', text))


def classify_content(title, abstract, phr, activity_code, org_name):
    """
    Classify based on content analysis.
    Returns (primary_category, confidence, secondary_category, reasoning)
    """
    # Combine text for analysis
    title_lower = (title or '').lower()
    abstract_lower = (abstract or '').lower()
    full_text = title_lower + ' ' + abstract_lower + ' ' + (phr or '').lower()

    # Check for no abstract
    if not abstract or len(abstract.strip()) < 50:
        if activity_code in TRAINING_CODES:
            return ('training', 95, '', 'Activity code deterministic')
        if activity_code in INFRASTRUCTURE_CODES:
            return ('infrastructure', 95, '', 'Activity code deterministic')
        return ('other', 0, '', 'No abstract available')

    # Flags for different categories
    develops_tool = False
    uses_method = False
    therapeutic_intent = False
    diagnostic_intent = False
    device_intent = False
    digital_health_intent = False
    behavioral_only = False
    basic_research_intent = False

    # DEVELOPS indicators (biotools)
    develops_patterns = [
        r'\bdevelop\w*\s+(?:a\s+)?(?:novel\s+)?(?:assay|tool|platform|method|pipeline|probe|algorithm)',
        r'\bcreate\s+(?:a\s+)?(?:computational|software|database)',
        r'\bbuild\s+(?:a\s+)?(?:platform|database|tool|resource)',
        r'\bengineering\s+(?:a\s+)?(?:platform|tool|system)',
        r'\bnovel\s+(?:assay|method|platform|tool|probe)',
        r'\bhigh-?throughput\s+(?:screening\s+)?platform',
        r'\bcomputational\s+(?:tool|pipeline|method|framework)',
        r'\bfor\s+(?:the\s+)?research\s+community',
        r'\bpublicly\s+available\s+(?:database|resource|tool)',
        r'\breference\s+standard',
        r'\bdevelop\w*\s+and\s+valid\w+\s+(?:a\s+)?(?:method|assay|approach)',
        r'\bopen[\s-]source\s+(?:tool|software|platform)',
    ]

    for pattern in develops_patterns:
        if re.search(pattern, full_text):
            develops_tool = True
            break

    # USES method for basic research
    uses_patterns = [
        r'\busing\s+(?:single[\s-]cell|rnaseq|proteomics|metabolomics|transcriptomics)',
        r'\buse\s+(?:mouse|animal|model)\s+(?:models?|system)',
        r'\bemploy\w*\s+(?:advanced|state-of-the-art)',
        r'\bleverage\s+(?:existing|established)',
    ]

    for pattern in uses_patterns:
        if re.search(pattern, full_text):
            uses_method = True
            break

    # Therapeutic intent
    therapeutic_patterns = [
        r'\bdrug\s+(?:discovery|development|candidate)',
        r'\btherapeutic\s+(?:target|approach|strategy|potential)',
        r'\bclinical\s+trial',
        r'\bphase\s+[i12]\b',
        r'\btreat(?:ment|ing)\s+(?:of\s+)?(?:patients?|disease)',
        r'\bcar[\s-]?t\b',
        r'\bgene\s+therapy',
        r'\bcell\s+therapy',
        r'\bvaccine\s+develop',
        r'\bimmunotherapy',
        r'\bdrug\s+delivery',
        r'\blead\s+compound',
        r'\blead\s+optimization',
        r'\bpreclinical\s+(?:study|studies|testing|development)',
        r'\btherapeutic\s+efficacy',
        r'\bpharmacological',
        r'\bantibody\s+(?:therapy|treatment)',
        r'\bsmall\s+molecule\s+(?:inhibitor|therapeutic)',
    ]

    for pattern in therapeutic_patterns:
        if re.search(pattern, full_text):
            therapeutic_intent = True
            break

    # Diagnostic intent
    diagnostic_patterns = [
        r'\bdiagnostic\s+(?:test|assay|tool|marker)',
        r'\bearly\s+detection',
        r'\bscreening\s+test',
        r'\bbiomarker\s+panel\s+for\s+(?:detect|diagnos)',
        r'\bpoint[\s-]of[\s-]care\s+(?:test|device|diagnostic)',
        r'\bliquid\s+biopsy',
        r'\bcompanion\s+diagnostic',
        r'\bclinical\s+biomarker\s+(?:for|panel)',
        r'\bvalidat\w+\s+(?:a\s+)?(?:blood|urine|serum)[\s-]based\s+(?:test|marker|biomarker)',
    ]

    for pattern in diagnostic_patterns:
        if re.search(pattern, full_text):
            diagnostic_intent = True
            break

    # Medical device intent
    device_patterns = [
        r'\bimplant(?:able)?\s+(?:device|neural)',
        r'\bprosthetic',
        r'\bstent\b',
        r'\bcatheter\b',
        r'\bwearable\s+(?:device|therapeutic)',
        r'\bbrain[\s-]computer\s+interface',
        r'\bneural\s+interface',
        r'\bmedical\s+device',
        r'\bbioresorbable',
        r'\btissue[\s-]engineered\s+(?:construct|implant)',
        r'\bsurgical\s+(?:instrument|robot|tool)',
    ]

    for pattern in device_patterns:
        if re.search(pattern, full_text):
            device_intent = True
            break

    # Digital health intent
    digital_patterns = [
        r'\bmobile\s+(?:app|application|health)',
        r'\bmhealth\b',
        r'\btelemedicine',
        r'\btelehealth',
        r'\bremote\s+(?:monitoring|patient)',
        r'\bclinical\s+decision\s+support',
        r'\behr\s+(?:tool|integration)',
        r'\bdigital\s+therapeutic',
        r'\bpatient[\s-]facing\s+(?:app|software)',
        r'\bweb[\s-]based\s+(?:intervention|tool)\s+for\s+(?:patient|self[\s-]manage)',
    ]

    for pattern in digital_patterns:
        if re.search(pattern, full_text):
            digital_health_intent = True
            break

    # Behavioral intervention (without drugs)
    behavioral_patterns = [
        r'\bbehavioral\s+intervention',
        r'\bsmoking\s+cessation',
        r'\bweight\s+(?:loss|management)',
        r'\blifestyle\s+(?:modification|intervention)',
        r'\bcognitive\s+behavioral\s+therapy',
        r'\b(?:cbt|dbt)\b',
        r'\bmindfulness',
        r'\bpsychotherapy',
        r'\bmotivational\s+interview',
        r'\bcommunity[\s-]based\s+intervention',
        r'\bhealth\s+promotion',
        r'\bhealth\s+education',
    ]

    behavioral_only = False
    for pattern in behavioral_patterns:
        if re.search(pattern, full_text):
            # Check if combined with drug
            if not re.search(r'\b(?:medication|drug|pharmacolog|varenicline|bupropion|naltrexone)\b', full_text):
                behavioral_only = True
            else:
                therapeutic_intent = True
            break

    # Basic research indicators (knowledge generation)
    basic_patterns = [
        r'\bmechanism\w*\s+(?:of|by\s+which|underlying|that)',
        r'\bunderstand\w*\s+(?:how|the|why)',
        r'\belucidat\w*\s+(?:the|how|mechanism)',
        r'\binvestigat\w*\s+(?:the\s+)?(?:role|function|mechanism)',
        r'\bcharacteriz\w*\s+(?:the|how)',
        r'\bidentify\w*\s+(?:novel\s+)?(?:gene|pathway|mechanism|target)',
        r'\bdiscover\w*\s+(?:novel|new)',
        r'\brole\s+of\s+\w+\s+in\s+',
        r'\bhow\s+\w+\s+(?:regulate|control|affect|influence)',
        r'\bpathway\w*\s+(?:that|involved|underlying)',
        r'\bsignaling\s+(?:pathway|mechanism)',
        r'\bneural\s+circuit',
        r'\bgene\s+(?:expression|regulation|function)',
        r'\bcellular\s+mechanism',
        r'\bmolecular\s+(?:mechanism|basis)',
    ]

    for pattern in basic_patterns:
        if re.search(pattern, full_text):
            basic_research_intent = True
            break

    # Classification logic
    secondary = ''

    # SBIR/STTR - never basic_research
    if activity_code in SBIR_CODES:
        if device_intent:
            return ('medical_device', 88, secondary, 'SBIR device development')
        if diagnostic_intent:
            return ('diagnostics', 88, secondary, 'SBIR diagnostic development')
        if digital_health_intent:
            return ('digital_health', 85, secondary, 'SBIR digital health')
        if develops_tool:
            return ('biotools', 85, secondary, 'SBIR tool development')
        # Default SBIR to therapeutics
        return ('therapeutics', 80, secondary, 'SBIR commercial development')

    # Primary deliverable classification
    if develops_tool and not therapeutic_intent and not diagnostic_intent:
        if basic_research_intent:
            secondary = 'basic_research'
        return ('biotools', 82, secondary, 'Develops tool/method for research')

    if therapeutic_intent:
        if develops_tool:
            secondary = 'biotools'
        elif diagnostic_intent:
            secondary = 'diagnostics'
        return ('therapeutics', 85, secondary, 'Drug/treatment development')

    if diagnostic_intent:
        if develops_tool:
            secondary = 'biotools'
        return ('diagnostics', 85, secondary, 'Clinical diagnostic development')

    if device_intent:
        return ('medical_device', 85, secondary, 'Medical device development')

    if digital_health_intent:
        return ('digital_health', 82, secondary, 'Digital health tool development')

    if behavioral_only:
        return ('other', 80, secondary, 'Behavioral intervention without drugs')

    # Check for epidemiology/cohort/health services
    if re.search(r'\b(?:cohort|longitudinal)\s+stud', full_text) or \
       re.search(r'\bepidemiolog', full_text) or \
       re.search(r'\bhealth\s+(?:services|disparit|policy)', full_text) or \
       re.search(r'\bimplementation\s+science', full_text):
        return ('other', 78, secondary, 'Epidemiology/health services research')

    # Default to basic_research for knowledge-seeking projects
    if basic_research_intent or uses_method:
        return ('basic_research', 78, secondary, 'Knowledge/mechanism discovery')

    # Very generic - likely basic research
    return ('basic_research', 70, secondary, 'General biomedical research')


def process_row(row):
    """Process a single grant row and return classification."""
    app_id = row.get('application_id', '')
    title = row.get('title', '')
    abstract = row.get('abstract', '')
    activity_code = row.get('activity_code', '')
    org_name = row.get('org_name', '')
    phr = row.get('phr', '')

    # Step 1: Check activity code first
    if activity_code in TRAINING_CODES:
        org_type = classify_org_type(org_name, activity_code)
        return {
            'application_id': app_id,
            'primary_category': 'training',
            'category_confidence': 95,
            'secondary_category': '',
            'org_type': org_type,
            'reasoning': f'Activity code {activity_code} deterministic'
        }

    if activity_code in INFRASTRUCTURE_CODES:
        org_type = classify_org_type(org_name, activity_code)
        return {
            'application_id': app_id,
            'primary_category': 'infrastructure',
            'category_confidence': 95,
            'secondary_category': '',
            'org_type': org_type,
            'reasoning': f'Activity code {activity_code} deterministic'
        }

    # Step 2: Check for cores in multi-component grants
    if activity_code in MULTI_COMPONENT_CODES:
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
        if is_core_project(title, abstract):
            org_type = classify_org_type(org_name, activity_code)
            return {
                'application_id': app_id,
                'primary_category': 'infrastructure',
                'category_confidence': 82,
                'secondary_category': '',
                'org_type': org_type,
                'reasoning': 'Core/shared facility within multi-component grant'
            }

    # Check for SEER
    if re.search(r'\bSEER\b', title + ' ' + (abstract or '')):
        org_type = classify_org_type(org_name, activity_code)
        return {
            'application_id': app_id,
            'primary_category': 'infrastructure',
            'category_confidence': 85,
            'secondary_category': '',
            'org_type': org_type,
            'reasoning': 'SEER cancer registry'
        }

    # Step 3: Content classification
    primary, confidence, secondary, reasoning = classify_content(title, abstract, phr, activity_code, org_name)
    org_type = classify_org_type(org_name, activity_code)

    return {
        'application_id': app_id,
        'primary_category': primary,
        'category_confidence': confidence,
        'secondary_category': secondary,
        'org_type': org_type,
        'reasoning': reasoning
    }


def main():
    input_dir = '/Users/tednunes/Projects/granted-bio/etl/review_batches'
    output_file = '/Users/tednunes/Projects/granted-bio/etl/semantic_results/semantic_361-370.csv'

    results = []

    for batch_num in range(361, 371):
        batch_file = os.path.join(input_dir, f'review_batch_{batch_num:04d}.csv')
        print(f'Processing {batch_file}...')

        with open(batch_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                result = process_row(row)
                results.append(result)

    # Write output
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ['application_id', 'primary_category', 'category_confidence', 'secondary_category', 'org_type', 'reasoning']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    print(f'\nProcessed {len(results)} grants')
    print(f'Output written to {output_file}')

    # Summary statistics
    from collections import Counter
    categories = Counter(r['primary_category'] for r in results)
    print('\nCategory distribution:')
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f'  {cat}: {count}')


if __name__ == '__main__':
    main()
