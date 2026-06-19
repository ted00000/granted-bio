#!/usr/bin/env python3
"""
Semantic classifier for NIH grant projects.
Processes review batches and outputs classifications.
"""

import csv
import re
import sys
from pathlib import Path

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

# SBIR/STTR codes - commercial development, never basic_research
SBIR_CODES = {'R41', 'R42', 'R43', 'R44', 'SB1', 'U44'}

# Multi-component grant codes
MULTI_COMPONENT_CODES = {'P01', 'P20', 'P2C', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}


def get_org_type(org_name, activity_code):
    """Determine organization type."""
    org_lower = org_name.lower() if org_name else ""

    # SBIR/STTR = always company
    if activity_code in SBIR_CODES:
        return "company"

    # Check for company indicators
    company_indicators = ['llc', 'inc.', 'inc,', 'corp.', 'corp,', 'therapeutics', 'biosciences',
                          'pharmaceuticals', 'biotech', 'biopharma', 'pharma', 'sciences, inc',
                          'technologies', 'systems, inc', 'solutions', 'health, inc', 'medical, inc']
    for ind in company_indicators:
        if ind in org_lower:
            return "company"

    # Check for research institutes
    research_institutes = ['scripps', 'broad institute', 'salk', 'fred hutchinson', 'sloan kettering',
                           'dana-farber', 'cold spring harbor', 'jackson laboratory', 'wistar',
                           'allen institute', 'stowers', 'whitehead', 'van andel', 'sanford burnham',
                           'la jolla', 'research institute']
    for inst in research_institutes:
        if inst in org_lower:
            return "research_institute"

    # Check for hospital
    hospital_indicators = ['hospital', 'medical center', 'health system', 'clinic', 'children\'s']
    # But university medical centers are universities
    if 'university' in org_lower or 'college' in org_lower:
        return "university"

    for ind in hospital_indicators:
        if ind in org_lower:
            return "hospital"

    # Check for university
    if 'university' in org_lower or 'college' in org_lower or 'school of' in org_lower:
        return "university"

    # Government and other
    if any(x in org_lower for x in ['veteran', 'va ', 'department of', 'national institutes']):
        return "other"

    return "university"  # Default


def classify_project(title, abstract, activity_code, org_name, phr=""):
    """
    Classify a project according to semantic rules.
    Returns: (primary_category, confidence, secondary_category, org_type, reasoning)
    """
    title = title or ""
    abstract = abstract or ""
    phr = phr or ""
    activity_code = activity_code or ""

    combined_text = f"{title} {abstract} {phr}".lower()
    title_lower = title.lower()

    org_type = get_org_type(org_name, activity_code)

    # Step 1: Check Activity Code FIRST (deterministic rules)
    if activity_code in TRAINING_CODES:
        return ("training", 95, "", org_type, f"Activity code {activity_code} is always training")

    if activity_code in INFRASTRUCTURE_CODES:
        return ("infrastructure", 95, "", org_type, f"Activity code {activity_code} is always infrastructure")

    # Step 2: Check for cores and non-research programs
    core_keywords = ['administrative core', 'resource core', 'shared facility', 'data core',
                     'biostatistics core', 'imaging core', 'service core', 'support core',
                     'core facility', 'shared resource', 'statistics core', 'informatics core']

    if activity_code in MULTI_COMPONENT_CODES:
        for kw in core_keywords:
            if kw in combined_text:
                return ("infrastructure", 85, "", org_type, f"Multi-component grant core: {kw}")

        if 'mentoring' in combined_text or 'career development' in combined_text:
            if 'core' in combined_text:
                return ("training", 85, "", org_type, "Mentoring/career development core")

    # SEER cancer registries
    if 'seer' in combined_text and ('registry' in combined_text or 'surveillance' in combined_text):
        return ("infrastructure", 85, "", org_type, "SEER cancer registry")

    # Other infrastructure codes
    if activity_code in {'U45', 'UH4'}:
        return ("training", 85, "", org_type, f"{activity_code} worker safety training")
    if activity_code == 'U2F':
        return ("other", 85, "", org_type, "U2F food safety regulatory")
    if activity_code == 'UC7':
        return ("infrastructure", 85, "", org_type, "UC7 biosafety labs")

    # Check for no abstract
    if len(abstract.strip()) < 50:
        return ("other", 0, "", org_type, "No abstract available")

    # Step 3: Classify by primary deliverable
    # SBIR/STTR - never basic_research
    is_sbir = activity_code in SBIR_CODES

    # Check for tool/method DEVELOPMENT indicators (biotools)
    biotools_develop_patterns = [
        r'develop[s]?\s+(?:a|an|the)?\s*(?:novel|new)?\s*(?:assay|platform|tool|pipeline|method|probe|sensor)',
        r'develop\s+and\s+(?:optimize|validate)\s+(?:a|an)?\s*(?:novel|new|advanced)?\s*(?:technique|method|assay)',
        r'creat[es]+\s+(?:a|an|the)?\s*(?:novel|new)?\s*(?:platform|database|resource|tool)',
        r'build[s]?\s+(?:a|an|the)?\s*(?:novel|new)?\s*(?:platform|database|pipeline)',
        r'engineer[s]?\s+(?:a|an|the)?\s*(?:novel|new)?\s*(?:platform|system|tool)',
        r'computational\s+(?:tool|pipeline|platform|method)',
        r'(?:high-throughput|screening)\s+platform',
        r'novel\s+(?:assay|probe|biosensor|imaging\s+method)',
        r'reference\s+standard',
        r'publicly\s+available\s+database',
        r'improve[s]?\s+(?:the)?\s*(?:methodology|method|technique)',
        r'(?:novel|new|advanced)\s+(?:neurochemical\s+)?recording\s+(?:technique|method|technology)',
        r'establish\s+\w+\s+as\s+a\s+(?:reliable|robust)?\s*research\s+tool',
        r'develop[s]?\s+(?:a|an)?\s*(?:novel|new|innovative)\s+(?:in\s+vivo)?\s*(?:voltammetric|electrochemical|imaging)\s+technique',
        r'propose\s+to\s+develop\s+(?:a|an)?\s*(?:novel|new|advanced)',
        r'develop\s+(?:and|a)?\s*(?:validate|optimize)?\s*(?:novel|new|advanced)?\s*(?:technique|method|approach)',
    ]

    develops_tool = any(re.search(pat, combined_text) for pat in biotools_develop_patterns)

    # Also check title for tool/technique development
    title_biotools_patterns = [
        r'development\s+of\s+(?:a|an)?\s*(?:novel|new|innovative)',
        r'(?:novel|new)\s+(?:method|technique|assay|platform|approach)\s+for',
    ]
    develops_tool_title = any(re.search(pat, title_lower) for pat in title_biotools_patterns)
    develops_tool = develops_tool or develops_tool_title

    # Check for therapeutics indicators
    therapeutics_patterns = [
        r'drug\s+(?:discovery|development|candidate)',
        r'phase\s+(?:i|ii|iii|1|2|3)\s+(?:trial|study)',
        r'clinical\s+trial',
        r'therapeutic[s]?\s+(?:target|development|efficacy)',
        r'car-t\s+(?:therapy|cell)',
        r'gene\s+therapy',
        r'cell\s+therapy',
        r'vaccine\s+(?:development|candidate)',
        r'immunotherapy',
        r'pharmacological\s+intervention',
        r'drug\s+delivery',
        r'compound\s+(?:optimization|screening)',
        r'lead\s+(?:compound|optimization)',
        r'(?:small\s+molecule|antibody)\s+(?:therapy|therapeutic|drug)',
        r'preclinical\s+(?:development|testing|studies)',
    ]

    is_therapeutics = any(re.search(pat, combined_text) for pat in therapeutics_patterns)

    # Check for diagnostics indicators
    diagnostics_patterns = [
        r'diagnostic\s+(?:test|assay|tool|biomarker)',
        r'clinical\s+(?:biomarker|test|diagnostic)',
        r'point-of-care\s+(?:test|device|diagnostic)',
        r'early\s+detection\s+(?:test|biomarker)',
        r'companion\s+diagnostic',
        r'liquid\s+biopsy\s+(?:for|to)\s+detect',
        r'screening\s+test\s+for\s+(?:cancer|disease)',
        r'validate[s]?\s+(?:a|the)?\s*biomarker\s+panel',
    ]

    is_diagnostics = any(re.search(pat, combined_text) for pat in diagnostics_patterns)

    # Check for medical device indicators
    device_patterns = [
        r'implant(?:able)?\s+(?:device|neural)',
        r'prosthe(?:tic|sis)',
        r'surgical\s+(?:instrument|device|robot)',
        r'stent',
        r'catheter',
        r'wearable\s+(?:device|therapeutic)',
        r'tissue-engineered\s+(?:construct|implant)',
        r'brain-computer\s+interface',
        r'neural\s+interface',
        r'medical\s+device',
        r'bioresorbable',
    ]

    is_device = any(re.search(pat, combined_text) for pat in device_patterns)

    # Check for digital health indicators
    digital_patterns = [
        r'mobile\s+(?:app|application|health)',
        r'mhealth',
        r'telemedicine',
        r'clinical\s+decision\s+support',
        r'ehr\s+(?:tool|system|integration)',
        r'remote\s+(?:monitoring|patient)',
        r'digital\s+therapeutic',
        r'patient-facing\s+(?:app|software|platform)',
        r'app\s+for\s+(?:diabetes|mental\s+health|self-management)',
    ]

    is_digital = any(re.search(pat, combined_text) for pat in digital_patterns)

    # Check for behavioral intervention (without drugs = other)
    behavioral_patterns = [
        r'behavioral\s+intervention',
        r'smoking\s+cessation',
        r'weight\s+(?:loss|management)',
        r'lifestyle\s+(?:modification|intervention)',
        r'cognitive\s+behavioral\s+therapy|cbt',
        r'mindfulness\s+intervention',
        r'psychotherapy',
        r'motivational\s+interviewing',
    ]

    is_behavioral = any(re.search(pat, combined_text) for pat in behavioral_patterns)

    # Check for drug involvement with behavioral
    has_drug = any(re.search(pat, combined_text) for pat in [
        r'pharmacotherapy', r'varenicline', r'bupropion', r'medication', r'drug\s+(?:and|combined)',
        r'combined\s+with\s+(?:medication|drug)', r'pharmacological'
    ])

    # Check for basic research indicators
    basic_research_patterns = [
        r'mechanism[s]?\s+(?:of|underlying|by\s+which)',
        r'understand(?:ing)?\s+(?:how|the|what)',
        r'elucidat[es]+\s+(?:the)?\s*(?:mechanism|role|function)',
        r'role\s+of\s+(?:gene|protein|pathway)',
        r'signaling\s+pathway',
        r'neural\s+circuit',
        r'molecular\s+basis',
        r'pathogenesis',
        r'disease\s+(?:mechanism|process)',
        r'identify\s+(?:genes|proteins|pathways|biomarkers)',
    ]

    is_basic = any(re.search(pat, combined_text) for pat in basic_research_patterns)

    # Check for "other" category indicators
    other_patterns = [
        r'health\s+(?:services|policy|disparities)',
        r'epidemiolog(?:y|ical)',
        r'cohort\s+study',
        r'implementation\s+science',
        r'community\s+(?:health|intervention|based)',
        r'occupational\s+(?:safety|health)',
        r'environmental\s+health',
        r'food\s+safety',
        r'longitudinal\s+(?:study|cohort)',
        r'survey\s+(?:of|study)',
    ]

    is_other_category = any(re.search(pat, combined_text) for pat in other_patterns)

    # SBIR/STTR classification (never basic_research)
    if is_sbir:
        if is_device:
            return ("medical_device", 88, "", "company", "SBIR/STTR device development")
        if is_diagnostics:
            return ("diagnostics", 88, "", "company", "SBIR/STTR diagnostic development")
        if is_digital:
            return ("digital_health", 88, "", "company", "SBIR/STTR digital health")
        if develops_tool:
            return ("biotools", 88, "", "company", "SBIR/STTR tool development")
        if is_therapeutics:
            return ("therapeutics", 88, "", "company", "SBIR/STTR therapeutic development")
        # Default SBIR to therapeutics or biotools
        return ("therapeutics", 75, "", "company", "SBIR/STTR commercial development")

    # Behavioral without drugs = other
    if is_behavioral and not has_drug:
        return ("other", 85, "", org_type, "Behavioral intervention without drugs")

    # Behavioral with drugs = therapeutics
    if is_behavioral and has_drug:
        return ("therapeutics", 82, "", org_type, "Behavioral intervention combined with pharmacotherapy")

    # Priority classification (most specific first)

    # If develops a tool/method explicitly
    if develops_tool:
        secondary = ""
        if is_therapeutics:
            secondary = "therapeutics"
        elif is_basic:
            secondary = "basic_research"
        return ("biotools", 85, secondary, org_type, "Develops tool/platform/method")

    # Medical devices
    if is_device:
        secondary = ""
        if is_therapeutics:
            secondary = "therapeutics"
        return ("medical_device", 85, secondary, org_type, "Medical device development")

    # Diagnostics
    if is_diagnostics:
        secondary = ""
        if develops_tool:
            secondary = "biotools"
        return ("diagnostics", 85, secondary, org_type, "Diagnostic test/biomarker development")

    # Digital health
    if is_digital:
        return ("digital_health", 85, "", org_type, "Digital health/patient-facing software")

    # Therapeutics
    if is_therapeutics:
        secondary = ""
        if is_basic:
            secondary = "basic_research"
        return ("therapeutics", 85, secondary, org_type, "Therapeutic development/drug discovery")

    # Check for using methods to study biology (basic_research)
    uses_method_patterns = [
        r'using\s+(?:single-cell|scRNA-seq|proteomics|genomics|CRISPR|imaging)',
        r'(?:we|will)\s+(?:use|employ|apply)\s+',
        r'(?:transcriptomics|metabolomics|epigenomics)\s+(?:to|of)',
    ]

    uses_method = any(re.search(pat, combined_text) for pat in uses_method_patterns)

    # Basic research (knowledge is the deliverable)
    if is_basic and not develops_tool and not is_therapeutics:
        confidence = 85 if not uses_method else 80
        return ("basic_research", confidence, "", org_type, "Mechanistic/biological understanding study")

    # Other category
    if is_other_category:
        return ("other", 80, "", org_type, "Health services/epidemiology/community health")

    # Default to basic_research with lower confidence if unclear
    if is_basic:
        return ("basic_research", 75, "", org_type, "Likely mechanistic study")

    # Fallback
    return ("basic_research", 65, "", org_type, "Default classification - unclear deliverable")


def process_batch(input_path, output_data):
    """Process a single batch CSV and append results to output_data."""
    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            app_id = row.get('application_id', '')
            title = row.get('title', '')
            abstract = row.get('abstract', '')
            activity_code = row.get('activity_code', '')
            org_name = row.get('org_name', '')
            phr = row.get('phr', '')

            primary, confidence, secondary, org_type, reasoning = classify_project(
                title, abstract, activity_code, org_name, phr
            )

            output_data.append({
                'application_id': app_id,
                'primary_category': primary,
                'category_confidence': confidence,
                'secondary_category': secondary,
                'org_type': org_type,
                'reasoning': reasoning
            })

    return len(output_data)


def main():
    base_path = Path('/Users/tednunes/Projects/granted-bio/etl/review_batches')
    output_path = Path('/Users/tednunes/Projects/granted-bio/etl/semantic_results/semantic_061-070.csv')

    output_data = []

    # Process batches 61-70
    for batch_num in range(61, 71):
        input_file = base_path / f'review_batch_{batch_num:04d}.csv'
        if input_file.exists():
            count_before = len(output_data)
            process_batch(input_file, output_data)
            count_after = len(output_data)
            print(f"Processed batch {batch_num}: {count_after - count_before} projects")
        else:
            print(f"Warning: {input_file} not found")

    # Write output
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'application_id', 'primary_category', 'category_confidence',
            'secondary_category', 'org_type', 'reasoning'
        ])
        writer.writeheader()
        writer.writerows(output_data)

    print(f"\nTotal projects classified: {len(output_data)}")
    print(f"Output written to: {output_path}")

    # Print category distribution
    from collections import Counter
    categories = Counter(row['primary_category'] for row in output_data)
    print("\nCategory distribution:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")


if __name__ == '__main__':
    main()
