#!/usr/bin/env python3
"""
Classify unclassified NIH projects directly from the database.

Two-phase workflow:
1. Automated first-pass with deterministic rules and keyword scoring
2. Projects flagged as REVIEW need manual/Claude inspection

Usage:
    python classify_from_database.py                    # Process all unclassified
    python classify_from_database.py --limit 1000       # Process first 1000
    python classify_from_database.py --dry-run          # Classify but don't update DB
    python classify_from_database.py --export-review    # Export REVIEW projects to CSV
"""

import os
import sys
import argparse
import json
from datetime import datetime
from typing import Dict, List, Tuple, Optional
from collections import Counter
from dotenv import load_dotenv

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True)

load_dotenv('../.env.local')

from supabase import create_client

# ============================================================================
# ACTIVITY CODE DEFINITIONS
# ============================================================================

TRAINING_CODES = {
    'T32', 'T34', 'T35', 'T90', 'TL1', 'TL4',
    'F30', 'F31', 'F32', 'F33', 'F99',
    'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2',
    'D43', 'D71', 'R25', 'R90'
}

INFRASTRUCTURE_CODES = {'P30', 'P50', 'P51', 'S10', 'G20', 'U13', 'R13', 'U24', 'U2C'}

SBIR_STTR_CODES = {'R41', 'R42', 'R43', 'R44', 'SB1', 'U44'}

MULTI_COMPONENT_CODES = {'P01', 'P20', 'P2C', 'P30', 'P50', 'P51', 'P60', 'U19', 'U54', 'U24', 'U2C', 'UC7', 'UG4', 'U42'}

# Intramural research (NIH internal)
INTRAMURAL_CODES = {'ZIA', 'ZIB', 'ZIC', 'ZID', 'ZIE'}

# Contract codes (service/procurement)
CONTRACT_CODES = {'N01', 'N02', 'N43', 'N44'}

# Other transaction agreements
OT_CODES = {'OT1', 'OT2', 'OT3'}

VALID_CATEGORIES = ['training', 'infrastructure', 'basic_research', 'biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']
VALID_ORG_TYPES = ['company', 'university', 'hospital', 'research_institute', 'other']


# ============================================================================
# CLASSIFICATION FUNCTIONS
# ============================================================================

def classify_org_type(org_name: str, activity_code: str) -> str:
    """Determine organization type from name and activity code."""
    if not org_name:
        return 'other'

    org = org_name.upper()

    # SBIR/STTR = always company
    if activity_code in SBIR_STTR_CODES:
        return 'company'

    # Company indicators
    company_signals = ['LLC', 'INC.', 'INC,', 'CORP', 'THERAPEUTICS, INC',
                       'BIOSCIENCES', 'PHARMACEUTICALS', 'BIOTECH', 'BIOPHARMA',
                       'TECHNOLOGIES INC', 'SCIENCES INC', 'DEVICES INC']
    if any(s in org for s in company_signals):
        return 'company'

    # Research institutes
    research_institutes = ['SCRIPPS', 'BROAD INSTITUTE', 'SALK INSTITUTE',
                          'FRED HUTCHINSON', 'SLOAN', 'DANA-FARBER', 'COLD SPRING HARBOR',
                          'JACKSON LABORATORY', 'WISTAR', 'LA JOLLA INSTITUTE',
                          'BECKMAN RESEARCH', 'WOODS HOLE', 'STOWERS', 'ALLEN INSTITUTE',
                          'WHITEHEAD INSTITUTE', 'CARNEGIE INSTITUTION', 'VAN ANDEL']
    if any(s in org for s in research_institutes):
        return 'research_institute'

    # University
    is_university = any(s in org for s in ['UNIVERSITY', 'COLLEGE', 'INSTITUTE OF TECHNOLOGY'])

    # Hospital
    hospital_signals = ['HOSPITAL', 'MEDICAL CENTER', 'HEALTH SYSTEM', 'CLINIC',
                       'MAYO', "CHILDREN'S", 'MEDICAL CTR', 'HEALTH SCIENCES CENTER']
    if any(s in org for s in hospital_signals) and not is_university:
        return 'hospital'

    if is_university:
        return 'university'

    # Hospital affiliated with university
    if any(s in org for s in hospital_signals):
        return 'hospital'

    return 'other'


def detect_core_facility(title: str, abstract: str) -> Optional[str]:
    """
    Detect if this is a core facility.
    Returns 'infrastructure', 'training', or None.

    Updated 2026-03: Improved detection for core facilities.
    """
    t = title.lower()
    text = (title + ' ' + abstract).lower()

    # False positives - words containing "core" that aren't core facilities
    not_core_patterns = [
        'coreceptor', 'co-receptor', 'score', 'encore', 'hardcore',
        'core of', 'core domain', 'core protein', 'core region',
        'core sequence', 'core element', 'core structure', 'core complex',
        'catalytic core', 'ribosomal core', 'nucleocapsid core', 'viral core',
        'promoter core', 'enhancer core', 'transcriptional core',
    ]
    if any(fp in t for fp in not_core_patterns):
        return None

    # Core facility patterns in title
    core_title_patterns = [
        ' core', 'core:', 'core -', 'core a', 'core b', 'core c', 'core d',
        'core e', 'core f', 'shared resource', 'shared facility',
    ]
    has_core_pattern = any(p in t for p in core_title_patterns)

    if not has_core_pattern:
        return None

    # Training core types
    training_terms = [
        'training', 'mentoring', 'career development', 'education',
        'research experience', 'professional development', 'trainee',
        'investigator development', 'fellow',
    ]
    if any(term in text for term in training_terms):
        return 'training'

    # Infrastructure core types (most cores are infrastructure)
    infrastructure_terms = [
        'administrative', 'admin', 'coordination', 'data science', 'data core',
        'bioinformatics', 'biostatistics', 'statistics', 'imaging', 'microscopy',
        'genomics', 'sequencing', 'proteomics', 'metabolomics', 'histopathology',
        'flow cytometry', 'biospecimen', 'biobank', 'tissue', 'animal', 'mouse',
        'mass spectrometry', 'structural biology', 'crystallography', 'cryo-em',
        'medicinal chemistry', 'chemistry core', 'assay development', 'screening',
        'bioassay', 'molecular biology', 'viral vector', 'vector core', 'antibody',
        'cell culture', 'pharmacology', 'analytical', 'metabolism', 'immunology',
        'technology', 'tech core', 'resource', 'shared', 'sample', 'clinical',
    ]
    if any(term in text for term in infrastructure_terms):
        return 'infrastructure'

    # Generic core without specific type - assume infrastructure
    if has_core_pattern:
        return 'infrastructure'

    return None


def score_categories(title: str, abstract: str, phr: str, activity_code: str) -> Dict[str, int]:
    """Score all categories based on content analysis."""
    t = title.lower()
    text = (title + ' ' + abstract + ' ' + phr).lower()

    scores = {cat: 0 for cat in ['basic_research', 'therapeutics', 'biotools',
                                  'diagnostics', 'medical_device', 'digital_health', 'other']}

    # ========== BASIC RESEARCH ==========
    br_strong = [
        'elucidate the mechanism', 'understand the mechanism', 'define the mechanism',
        'dissect the mechanism', 'characterize the mechanism', 'underlying mechanisms',
        'mechanisms by which', 'molecular basis of', 'molecular mechanisms',
        'signaling pathway', 'gene regulation', 'transcriptional regulation',
        'structure-function', 'fundamental understanding', 'fundamental question'
    ]
    br_moderate = [
        'role of', 'function of', 'mechanism of', 'pathway', 'regulation of',
        'pathogenesis', 'pathophysiology', 'in vivo', 'mouse model', 'animal model',
        'single-cell', 'rna-seq', 'transcriptom', 'proteom', 'neural circuit',
        'immune response', 'tumor microenvironment', 'chromatin', 'cryo-em',
        'optogenetic', 'electrophysiology', 'calcium imaging', 'mitochondri',
        'autophagy', 'apoptosis', 'stem cell biology', 'organoid', 'crispr',
        'microbiome', 'protein folding', 'enzyme kinetics'
    ]
    scores['basic_research'] += sum(3 for s in br_strong if s in text)
    scores['basic_research'] += sum(1 for s in br_moderate if s in text)
    for kw in ['mechanism', 'regulation', 'pathway', 'circuit', 'role of', 'function of', 'biology of']:
        if kw in t:
            scores['basic_research'] += 4

    # ========== THERAPEUTICS ==========
    tx_strong = [
        'clinical trial', 'phase i ', 'phase ii', 'phase iii', 'phase 1 ', 'phase 2 ', 'phase 3 ',
        'drug development', 'drug discovery', 'drug design', 'drug delivery', 'drug candidate',
        'lead compound', 'lead optimization', 'ind-enabling', 'therapeutic development',
        'vaccine development', 'vaccine candidate', 'car-t', 'car t cell', 'gene therapy for',
        'cell therapy for', 'antisense oligonucleotide', 'monoclonal antibody therap',
        'randomized controlled trial', 'efficacy and safety', 'pharmacokinetic',
        'preclinical development', 'preclinical efficacy', 'first-in-human',
        'structure-activity relationship', 'medicinal chemistry', 'drug repurpos',
        # Phase 2 additions: CAR variants, treatment intent patterns
        'car-nk', 'car-m', 'car-macrophage', 'car-microglia', 'car-natural killer',
        'to treat', 'for treating', 'radiotherapeutic', 'radiotherapy for',
        'nanomedicine', 'nanoparticle therap', 'biologic therapy', 'biologics for'
    ]
    tx_moderate = [
        'treatment of', 'therapy for', 'therapeutic', 'inhibitor of', 'agonist', 'antagonist',
        'small molecule', 'formulation', 'clinical efficacy', 'tumor regression',
        'antitumor', 'antiviral', 'antimicrobial', 'immunotherapy', 'dose'
    ]
    scores['therapeutics'] += sum(3 for s in tx_strong if s in text)
    scores['therapeutics'] += sum(1 for s in tx_moderate if s in text)
    for kw in ['treatment', 'therapy', 'therapeutic', 'drug', 'vaccine', 'inhibitor',
               'clinical trial', 'gene therapy', 'cell therapy', 'car-t', 'immunotherapy',
               'treating', 'car-', 'radiotherap', 'to treat', 'for treating']:
        if kw in t:
            scores['therapeutics'] += 4

    # ========== BIOTOOLS ==========
    bt_strong = [
        'develop a platform for', 'develop a tool for', 'develop software for',
        'develop a pipeline for', 'develop an assay for', 'novel platform for',
        'novel tool for', 'novel assay for', 'high-throughput screening platform',
        'computational pipeline for', 'computational tool for', 'software tool for',
        'database for', 'atlas of', 'open source', 'publicly available',
        'community resource', 'for researchers', 'reference standard',
        'r package', 'python package', 'web server', 'web tool', 'biobank',
        # Phase 2 additions: tool/method development patterns
        'tools for', 'methods for', 'novel method', 'computational method',
        'imaging method for', 'analytical method for'
    ]
    bt_moderate = [
        'platform', 'pipeline', 'workflow', 'sequencing method', 'imaging method',
        'assay development', 'bioinformatics tool', 'data resource', 'repository'
    ]
    scores['biotools'] += sum(3 for s in bt_strong if s in text)
    scores['biotools'] += sum(1 for s in bt_moderate if s in text)
    for kw in ['platform for', 'pipeline for', 'tool for', 'atlas of', 'database of',
               'resource for', 'method for', 'assay for', 'high-throughput', 'software for',
               'tools for', 'methods for', 'novel method', 'computational tool',
               'software tool', 'open-source software', 'toolkit for']:
        if kw in t:
            scores['biotools'] += 4

    # ========== DIAGNOSTICS ==========
    dx_strong = [
        'diagnostic test', 'diagnostic assay', 'diagnostic accuracy',
        'early detection of cancer', 'early detection of disease', 'screening test for',
        'sensitivity and specificity', 'companion diagnostic', 'point-of-care test',
        'liquid biopsy for', 'circulating tumor cell', 'circulating tumor dna',
        'biomarker panel for diagnos', 'clinical biomarker', 'validated biomarker',
        'prenatal screening', 'newborn screening', 'rapid diagnostic test'
    ]
    dx_moderate = ['diagnostic', 'early detection', 'cancer detection', 'screening', 'biomarker discovery']
    scores['diagnostics'] += sum(3 for s in dx_strong if s in text)
    scores['diagnostics'] += sum(1 for s in dx_moderate if s in text)
    for kw in ['diagnostic', 'early detection', 'screening', 'liquid biopsy', 'point-of-care']:
        if kw in t:
            scores['diagnostics'] += 4

    # ========== MEDICAL DEVICE (with development gate) ==========
    dev_intent = any(w in text for w in [
        'develop', 'design', 'fabricat', 'engineer', 'build', 'construct',
        'manufacture', 'prototype', 'optimize', 'create a', 'novel',
        'biocompat', 'implantable', '510(k)', 'fda clearance', 'bench testing'
    ])
    sbir_device = activity_code in SBIR_STTR_CODES and any(w in text for w in [
        'device', 'implant', 'catheter', 'stent', 'scaffold', 'electrode',
        'prosthe', 'sensor', 'wearable', 'surgical', 'microneedle'
    ])
    if dev_intent or sbir_device:
        md_strong = [
            'implantable device', 'neural implant', 'cochlear implant', 'prosthetic device',
            'surgical instrument', 'surgical robot', 'brain-computer interface',
            'neural interface', 'tissue scaffold for', 'tissue-engineered',
            'stent design', 'catheter design', 'pacemaker', 'defibrillator',
            'wearable device for patient', 'exoskeleton for', 'microneedle patch',
            'retinal prosthe', 'surgical navigation', 'bioprinting for tissue'
        ]
        md_moderate = ['implant for', 'scaffold for', 'biocompat', 'biodegrad']
        scores['medical_device'] += sum(3 for s in md_strong if s in text)
        scores['medical_device'] += sum(1 for s in md_moderate if s in text)
        for kw in ['implant', 'prosthe', 'stent', 'catheter', 'device for', 'scaffold for',
                   'wearable for', 'exoskeleton', 'neural interface', 'brain-computer']:
            if kw in t:
                scores['medical_device'] += 4

    # ========== DIGITAL HEALTH (with deployment gate) ==========
    deployment = any(w in text for w in [
        'patient', 'clinician', 'provider', 'physician', 'clinical setting',
        'clinical practice', 'hospital', 'emergency department', 'primary care',
        'deployed', 'end user', 'health system', 'health care'
    ])
    dh_title_signal = any(w in t for w in ['telehealth', 'telemedicine', 'mhealth', 'digital health',
                                            'remote monitoring', 'digital therapeutic', 'ehr', 'mobile health'])
    if deployment or dh_title_signal:
        dh_strong = [
            'telemedicine', 'telehealth', 'mhealth', 'm-health', 'digital health intervention',
            'digital therapeutic', 'mobile app for patient', 'smartphone app for',
            'remote patient monitoring', 'clinical decision support system',
            'electronic health record', 'ehr integration', 'patient portal',
            'text message intervention', 'sms-based intervention'
        ]
        dh_moderate = ['web-based intervention for patient', 'online intervention',
                       'chatbot for patient', 'virtual reality therap', 'patient engagement',
                       'telepsychiatry', 'telemonitoring', 'app-based', 'wearable for monitoring']
        scores['digital_health'] += sum(3 for s in dh_strong if s in text)
        scores['digital_health'] += sum(1 for s in dh_moderate if s in text)
        for kw in ['telehealth', 'telemedicine', 'mhealth', 'digital health', 'remote monitoring', 'digital therapeutic']:
            if kw in t:
                scores['digital_health'] += 4

    # ========== OTHER ==========
    ot_strong = [
        'health disparit', 'health equity', 'social determinants of health',
        'implementation science', 'dissemination and implementation',
        'community-based participatory', 'community health worker',
        'behavioral intervention for', 'cohort study', 'epidemiologic study',
        'health services research', 'quality improvement', 'cost-effectiveness',
        'health policy', 'smoking cessation program', 'weight management program',
        'lifestyle modification', 'cognitive behavioral therapy for',
        'mindfulness-based intervention', 'violence prevention', 'injury prevention',
        'occupational health', 'food safety', 'environmental health'
    ]
    ot_moderate = [
        'disparity', 'disparities', 'social support', 'peer support', 'stigma',
        'substance use disorder', 'adherence', 'qualitative study', 'focus group',
        'community engagement', 'caregiver', 'social isolation', 'health behavior',
        'quality of life', 'well-being', 'chronic pain', 'rehabilitation program'
    ]
    scores['other'] += sum(3 for s in ot_strong if s in text)
    scores['other'] += sum(1 for s in ot_moderate if s in text)
    for kw in ['disparit', 'equity', 'implementation science', 'behavioral intervention',
               'cessation', 'violence prevent', 'occupational', 'environmental exposure']:
        if kw in t:
            scores['other'] += 4

    # ========== DISAMBIGUATION RULES ==========

    # Rule 1: SBIR → never basic_research
    if activity_code in SBIR_STTR_CODES:
        scores['therapeutics'] += 3
        scores['medical_device'] += 2
        scores['basic_research'] = 0

    # Rule 2: Uses vs develops tool
    has_distribution = any(w in text for w in [
        'for researchers', 'for the community', 'widely available', 'open source',
        'shared resource', 'disseminat', 'user-friendly', 'publicly available',
        'web server', 'downloadable', 'made available', 'community resource'
    ])
    if scores['basic_research'] > scores['biotools'] and not has_distribution:
        scores['biotools'] = max(0, scores['biotools'] - 4)

    # Rule 3: Behavioral without drugs → other
    has_drug = any(w in text for w in ['drug', 'compound', 'small molecule', 'inhibitor',
                                        'nanoparticle', 'antibody therap', 'vaccine',
                                        'gene therapy', 'cell therapy'])
    if scores['other'] >= 5 and scores['therapeutics'] > 0 and not has_drug:
        scores['therapeutics'] = max(0, scores['therapeutics'] - 5)

    # Rule 4: Behavioral + randomized without drugs → other
    is_behavioral = any(w in text for w in ['behavioral', 'lifestyle', 'psychosocial',
                                             'mindfulness', 'motivational interviewing',
                                             'cognitive behavioral'])
    if is_behavioral and 'randomized' in text and not has_drug:
        scores['other'] += 4
        scores['therapeutics'] = max(0, scores['therapeutics'] - 3)

    # Rule 5: Epidemiology without molecular → other
    is_epi = any(w in text for w in ['cohort study', 'epidemiologic', 'population-based study',
                                      'longitudinal study of risk', 'prospective study of'])
    is_molecular = any(w in text for w in ['mechanism', 'pathway', 'signaling', 'molecular',
                                            'gene expression', 'transcriptom', 'proteom'])
    if is_epi and not is_molecular:
        scores['other'] += 4
        scores['basic_research'] = max(0, scores['basic_research'] - 3)

    # Rule 6: Statistical methods → biotools
    if any(w in text for w in ['novel statistical method', 'develop statistical',
                                'develop computational method', 'new algorithm for analyz']):
        scores['biotools'] += 4

    # Rule 7: Drug mechanism study → basic_research
    if any(w in text for w in ['mechanism of action', 'how drug', 'mechanism of resistance']):
        if not any(w in text for w in ['optimize', 'clinical trial', 'drug delivery', 'lead optimization']):
            scores['basic_research'] += 3

    # Rule 8: Strong basic_research overrides weak other
    if scores['basic_research'] >= 8 and scores['other'] > 0:
        if scores['other'] < scores['basic_research'] * 0.6:
            scores['other'] = max(0, scores['other'] - 3)

    # Rule 9: Drug delivery → therapeutics
    if any(w in text for w in ['drug delivery', 'deliver therapeutic', 'deliver treatment']):
        scores['therapeutics'] += 2
        scores['biotools'] = max(0, scores['biotools'] - 2)

    # Rule 10: Web app/lifestyle without clinical software → other
    if any(w in text for w in ['web-app', 'web app', 'physical activity', 'lifestyle']):
        if not any(w in text for w in ['telemedicine', 'telehealth', 'ehr', 'clinical decision support']):
            scores['digital_health'] = max(0, scores['digital_health'] - 3)
            scores['other'] += 1

    # Rule 11: Therapeutic title intent
    therapeutic_title = any(w in t for w in ['therapy', 'treatment', 'therapeutic',
                                              'novel strateg', 'repair', 'rescue'])
    if therapeutic_title and scores['basic_research'] > scores['therapeutics']:
        if scores['therapeutics'] >= 3:
            scores['therapeutics'] += 4

    # Rule 15: "to treat" or "for treating" in title → strong therapeutics signal
    # Phase 4: When title explicitly mentions treatment intent, penalize basic_research
    if ('to treat' in t or 'for treating' in t) and scores['therapeutics'] >= 2:
        scores['therapeutics'] += 3
        scores['basic_research'] = max(0, scores['basic_research'] - 2)

    return scores


def calculate_confidence(scores: Dict[str, int]) -> Tuple[str, int, str]:
    """Calculate winner, confidence, and secondary category."""
    sorted_cats = sorted(scores.items(), key=lambda x: -x[1])
    winner = sorted_cats[0][0]
    winner_score = sorted_cats[0][1]
    runner_up = sorted_cats[1][0]
    runner_up_score = sorted_cats[1][1]

    margin = winner_score - runner_up_score

    if margin >= 10:
        confidence = 90
    elif margin >= 6:
        confidence = 85
    elif margin >= 3:
        confidence = 85
    elif margin >= 2:
        confidence = 80
    elif margin >= 1:
        confidence = 80 if winner_score >= 5 else 75
    else:
        confidence = 70

    # Boost confidence for high absolute scores
    if winner_score >= 20:
        confidence = max(confidence, 90)
    elif winner_score >= 12:
        confidence = max(confidence, 85)
    elif winner_score >= 6:
        confidence = max(confidence, 80)

    # Secondary category
    secondary = ''
    if runner_up_score >= 3 and runner_up_score >= winner_score * 0.3:
        secondary = runner_up

    return winner, confidence, secondary


def classify_project(project: Dict, abstract: str = '') -> Dict:
    """
    Classify a single project.

    Returns dict with:
        - primary_category
        - category_confidence
        - secondary_category
        - org_type
        - status: 'OK' or 'REVIEW'
        - reason: explanation of classification
    """
    app_id = project['application_id']
    title = project.get('title', '') or ''
    org_name = project.get('org_name', '') or ''
    activity_code = project.get('activity_code', '') or ''
    phr = project.get('phr', '') or ''

    org_type = classify_org_type(org_name, activity_code)

    # ========== PHASE 1: DETERMINISTIC ==========

    # Training codes
    if activity_code in TRAINING_CODES:
        return {
            'primary_category': 'training',
            'category_confidence': 95,
            'secondary_category': '',
            'org_type': org_type,
            'status': 'OK',
            'reason': f'Activity code {activity_code} is deterministic training'
        }

    # Infrastructure codes
    if activity_code in INFRASTRUCTURE_CODES:
        return {
            'primary_category': 'infrastructure',
            'category_confidence': 95,
            'secondary_category': '',
            'org_type': org_type,
            'status': 'OK',
            'reason': f'Activity code {activity_code} is deterministic infrastructure'
        }

    # Core detection - check for multi-component grants OR "core" in title
    title_lower = title.lower()
    if activity_code in MULTI_COMPONENT_CODES or ' core' in title_lower or 'core:' in title_lower or 'core -' in title_lower:
        core_type = detect_core_facility(title, abstract)
        if core_type:
            return {
                'primary_category': core_type,
                'category_confidence': 85,
                'secondary_category': '',
                'org_type': org_type,
                'status': 'OK',
                'reason': f'Core facility detected ({core_type})'
            }

    # SEER registries
    if 'SEER' in title.upper() or 'SEER' in abstract.upper():
        return {
            'primary_category': 'infrastructure',
            'category_confidence': 85,
            'secondary_category': '',
            'org_type': org_type,
            'status': 'OK',
            'reason': 'SEER cancer registry'
        }

    # Special codes
    if activity_code in {'U45', 'UH4'}:
        return {
            'primary_category': 'training',
            'category_confidence': 85,
            'secondary_category': '',
            'org_type': org_type,
            'status': 'OK',
            'reason': 'Worker safety training program'
        }

    if activity_code == 'U2F':
        return {
            'primary_category': 'other',
            'category_confidence': 85,
            'secondary_category': '',
            'org_type': org_type,
            'status': 'OK',
            'reason': 'Food safety regulatory'
        }

    if activity_code == 'UC7':
        return {
            'primary_category': 'infrastructure',
            'category_confidence': 85,
            'secondary_category': '',
            'org_type': org_type,
            'status': 'OK',
            'reason': 'Biosafety lab'
        }

    # Intramural research (NIH internal) - classify by content, capped confidence
    if activity_code in INTRAMURAL_CODES:
        if len(abstract.strip()) < 50:
            return {
                'primary_category': 'basic_research',
                'category_confidence': 60,
                'secondary_category': '',
                'org_type': 'research_institute',
                'status': 'REVIEW',
                'reason': f'Intramural {activity_code} without abstract'
            }
        scores = score_categories(title, abstract, phr, activity_code)
        winner, confidence, secondary = calculate_confidence(scores)
        confidence = min(confidence, 75)  # Cap intramural at 75%
        return {
            'primary_category': winner,
            'category_confidence': confidence,
            'secondary_category': secondary,
            'org_type': 'research_institute',
            'status': 'OK' if confidence >= 70 else 'REVIEW',
            'reason': f'Intramural {activity_code}: {winner}'
        }

    # Contract codes - often service/support
    if activity_code in CONTRACT_CODES:
        if len(abstract.strip()) < 50:
            return {
                'primary_category': 'infrastructure',
                'category_confidence': 60,
                'secondary_category': '',
                'org_type': org_type,
                'status': 'REVIEW',
                'reason': f'Contract {activity_code} without abstract'
            }
        scores = score_categories(title, abstract, phr, activity_code)
        max_score = max(scores.values())
        if max_score >= 5:
            winner, confidence, secondary = calculate_confidence(scores)
            confidence = min(confidence, 75)
        else:
            winner = 'infrastructure'
            confidence = 60
            secondary = ''
        return {
            'primary_category': winner,
            'category_confidence': confidence,
            'secondary_category': secondary,
            'org_type': org_type,
            'status': 'OK' if confidence >= 70 else 'REVIEW',
            'reason': f'Contract {activity_code}: {winner}'
        }

    # Other transaction agreements - classify by content
    if activity_code in OT_CODES:
        if len(abstract.strip()) < 50:
            return {
                'primary_category': 'other',
                'category_confidence': 50,
                'secondary_category': '',
                'org_type': org_type,
                'status': 'REVIEW',
                'reason': f'OT {activity_code} without abstract'
            }
        scores = score_categories(title, abstract, phr, activity_code)
        winner, confidence, secondary = calculate_confidence(scores)
        confidence = min(confidence, 80)  # Slight cap for OT
        return {
            'primary_category': winner,
            'category_confidence': confidence,
            'secondary_category': secondary,
            'org_type': org_type,
            'status': 'OK' if confidence >= 70 else 'REVIEW',
            'reason': f'OT {activity_code}: {winner}'
        }

    # No abstract → cannot classify
    if len(abstract.strip()) < 50:
        return {
            'primary_category': 'other',
            'category_confidence': 0,
            'secondary_category': '',
            'org_type': org_type,
            'status': 'OK',
            'reason': 'No abstract available'
        }

    # ========== PHASE 2: CONTENT-BASED ==========

    # SBIR/STTR special handling
    if activity_code in SBIR_STTR_CODES:
        org_type = 'company'
        scores = score_categories(title, abstract, phr, activity_code)
        winner, confidence, secondary = calculate_confidence(scores)

        # SBIR should never be basic_research
        if winner == 'basic_research':
            sorted_cats = sorted(scores.items(), key=lambda x: -x[1])
            for cat, score in sorted_cats:
                if cat != 'basic_research' and score > 0:
                    winner = cat
                    confidence = 70
                    break
            else:
                winner = 'therapeutics'
                confidence = 60

        return {
            'primary_category': winner,
            'category_confidence': confidence,
            'secondary_category': secondary if secondary != 'basic_research' else '',
            'org_type': org_type,
            'status': 'OK' if confidence >= 75 else 'REVIEW',
            'reason': f'SBIR/STTR: {winner} (score={scores.get(winner, 0)})'
        }

    # Regular content-based scoring
    scores = score_categories(title, abstract, phr, activity_code)
    max_score = max(scores.values())

    # Zero score fallback
    if max_score == 0:
        if activity_code.startswith('R') and activity_code not in ('R13', 'R25', 'R90'):
            has_science = any(w in (title + abstract).lower() for w in [
                'study', 'research', 'investigat', 'examin', 'analyz', 'hypothes', 'aim'
            ])
            if has_science:
                return {
                    'primary_category': 'basic_research',
                    'category_confidence': 60,
                    'secondary_category': '',
                    'org_type': org_type,
                    'status': 'REVIEW',
                    'reason': 'R-series with science words but no category signals'
                }

        if activity_code in MULTI_COMPONENT_CODES:
            return {
                'primary_category': 'infrastructure',
                'category_confidence': 60,
                'secondary_category': '',
                'org_type': org_type,
                'status': 'REVIEW',
                'reason': 'Multi-component grant with no category signals'
            }

        return {
            'primary_category': 'other',
            'category_confidence': 50,
            'secondary_category': '',
            'org_type': org_type,
            'status': 'REVIEW',
            'reason': 'No category signals detected'
        }

    winner, confidence, secondary = calculate_confidence(scores)

    return {
        'primary_category': winner,
        'category_confidence': confidence,
        'secondary_category': secondary,
        'org_type': org_type,
        'status': 'OK' if confidence >= 75 else 'REVIEW',
        'reason': f'{winner} (score={scores[winner]}, margin={scores[winner] - sorted(scores.values())[-2]})'
    }


# ============================================================================
# DATABASE OPERATIONS
# ============================================================================

def get_supabase_client():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not url or not key:
        raise ValueError("Missing Supabase credentials in environment")
    return create_client(url, key)


def fetch_unclassified_projects(supabase, limit: int = None) -> Tuple[List[Dict], Dict[str, str]]:
    """Fetch unclassified projects and their abstracts."""
    print("Fetching unclassified projects...", flush=True)

    # Fetch projects
    query = supabase.table('projects').select(
        'application_id, title, org_name, activity_code, phr'
    ).is_('primary_category', 'null')

    all_projects = []
    offset = 0
    batch_size = 1000

    while True:
        result = query.range(offset, offset + batch_size - 1).execute()
        if not result.data:
            break
        all_projects.extend(result.data)
        offset += batch_size
        print(f"  Fetched {len(all_projects):,} projects...", flush=True)
        if limit and len(all_projects) >= limit:
            all_projects = all_projects[:limit]
            break
        if len(result.data) < batch_size:
            break

    print(f"  Total: {len(all_projects):,} unclassified projects")

    # Fetch abstracts
    print("Fetching abstracts...", flush=True)
    app_ids = [p['application_id'] for p in all_projects]

    abstracts_map = {}
    for i in range(0, len(app_ids), 1000):
        batch_ids = app_ids[i:i+1000]
        result = supabase.table('abstracts').select(
            'application_id, abstract_text'
        ).in_('application_id', batch_ids).execute()
        for a in result.data:
            abstracts_map[a['application_id']] = a['abstract_text'] or ''
        print(f"  Fetched {len(abstracts_map):,} abstracts...", flush=True)

    print(f"  Total: {len(abstracts_map):,} abstracts loaded")

    return all_projects, abstracts_map


def update_classifications(supabase, classifications: List[Dict], dry_run: bool = False) -> int:
    """Update database with classification results."""
    if dry_run:
        print("DRY RUN: Skipping database updates")
        return len(classifications)

    print(f"Updating database with {len(classifications):,} classifications...", flush=True)

    updated = 0
    errors = 0

    for i, c in enumerate(classifications):
        try:
            update_data = {
                'primary_category': c['primary_category'],
                'primary_category_confidence': c['category_confidence'],
                'org_type': c['org_type']
            }

            # Add secondary category if present
            if c.get('secondary_category'):
                update_data['secondary_categories'] = json.dumps({
                    c['secondary_category']: 50  # Default secondary confidence
                })

            supabase.table('projects').update(update_data).eq(
                'application_id', c['application_id']
            ).execute()

            updated += 1

            if (i + 1) % 500 == 0:
                print(f"  Progress: {updated:,}/{len(classifications):,} ({100*updated//len(classifications)}%)", flush=True)

        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"  Error updating {c['application_id']}: {str(e)[:60]}")

    print(f"  Updated: {updated:,}, Errors: {errors}")
    return updated


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Classify unclassified NIH projects')
    parser.add_argument('--limit', type=int, help='Limit number of projects to process')
    parser.add_argument('--dry-run', action='store_true', help='Classify but do not update database')
    parser.add_argument('--export-review', action='store_true', help='Export REVIEW projects to CSV')
    args = parser.parse_args()

    print("=" * 60)
    print("NIH PROJECT CLASSIFICATION")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print(f"Dry run: {args.dry_run}")
    if args.limit:
        print(f"Limit: {args.limit:,}")
    print()

    supabase = get_supabase_client()
    print("Connected to Supabase\n")

    # Fetch data
    projects, abstracts_map = fetch_unclassified_projects(supabase, args.limit)

    if not projects:
        print("No unclassified projects found!")
        return

    # Classify
    print(f"\nClassifying {len(projects):,} projects...")
    print("-" * 60)

    classifications = []
    category_counts = Counter()
    org_type_counts = Counter()
    status_counts = Counter()
    confidence_counts = Counter()

    for i, project in enumerate(projects):
        app_id = project['application_id']
        abstract = abstracts_map.get(app_id, '')

        result = classify_project(project, abstract)
        result['application_id'] = app_id
        classifications.append(result)

        category_counts[result['primary_category']] += 1
        org_type_counts[result['org_type']] += 1
        status_counts[result['status']] += 1

        conf = result['category_confidence']
        if conf >= 85:
            confidence_counts['high (85+)'] += 1
        elif conf >= 70:
            confidence_counts['medium (70-84)'] += 1
        else:
            confidence_counts['low (<70)'] += 1

        if (i + 1) % 1000 == 0:
            print(f"  Classified {i+1:,}/{len(projects):,}...", flush=True)

    print(f"\nClassification complete: {len(classifications):,} projects")

    # Statistics
    print("\n" + "=" * 60)
    print("CATEGORY DISTRIBUTION")
    print("=" * 60)
    for cat in VALID_CATEGORIES:
        count = category_counts.get(cat, 0)
        pct = 100 * count / len(classifications) if classifications else 0
        print(f"  {cat:20} {count:6,} ({pct:5.1f}%)")

    print("\n" + "=" * 60)
    print("ORG TYPE DISTRIBUTION")
    print("=" * 60)
    for org in VALID_ORG_TYPES:
        count = org_type_counts.get(org, 0)
        pct = 100 * count / len(classifications) if classifications else 0
        print(f"  {org:20} {count:6,} ({pct:5.1f}%)")

    print("\n" + "=" * 60)
    print("CLASSIFICATION STATUS")
    print("=" * 60)
    for status in ['OK', 'REVIEW']:
        count = status_counts.get(status, 0)
        pct = 100 * count / len(classifications) if classifications else 0
        print(f"  {status:20} {count:6,} ({pct:5.1f}%)")

    print("\n" + "=" * 60)
    print("CONFIDENCE DISTRIBUTION")
    print("=" * 60)
    for band in ['high (85+)', 'medium (70-84)', 'low (<70)']:
        count = confidence_counts.get(band, 0)
        pct = 100 * count / len(classifications) if classifications else 0
        print(f"  {band:20} {count:6,} ({pct:5.1f}%)")

    # Export REVIEW projects
    if args.export_review:
        review_projects = [c for c in classifications if c['status'] == 'REVIEW']
        if review_projects:
            filename = f"review_projects_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            import csv
            with open(filename, 'w', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=[
                    'application_id', 'primary_category', 'category_confidence',
                    'secondary_category', 'org_type', 'reason'
                ])
                writer.writeheader()
                for c in review_projects:
                    writer.writerow({
                        'application_id': c['application_id'],
                        'primary_category': c['primary_category'],
                        'category_confidence': c['category_confidence'],
                        'secondary_category': c.get('secondary_category', ''),
                        'org_type': c['org_type'],
                        'reason': c['reason']
                    })
            print(f"\nExported {len(review_projects):,} REVIEW projects to {filename}")

    # Update database
    if not args.dry_run:
        print("\n" + "=" * 60)
        print("UPDATING DATABASE")
        print("=" * 60)
        updated = update_classifications(supabase, classifications)
        print(f"\nSuccessfully updated {updated:,} projects")

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == '__main__':
    main()
