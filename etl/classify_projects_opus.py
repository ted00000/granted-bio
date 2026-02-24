"""
FINAL COMPREHENSIVE NIH GRANT CLASSIFIER v3 — VALIDATED
========================================================
Based on Opus's iterative refinement and validation work.
Processes batch files and outputs classified CSVs.

Fixes from validation:
- medical_device: requires development/engineering intent, not just device-adjacent words
- digital_health: requires patient/clinician deployment, not just ML/monitoring keywords
- therapeutics: behavioral interventions without drugs → other
- other: basic_research molecular signals override weak other signals
- biotools: tightened to require tool distribution intent
"""

import csv, re, os, glob
from collections import Counter

TRAINING_CODES = {
    'T32','T34','T35','T90','TL1','TL4',
    'F30','F31','F32','F33','F99',
    'K00','K01','K02','K05','K07','K08','K12','K22','K23','K24','K25','K26','K43','K76','K99','KL2',  # K00 included
    'D43','D71','R25','R90',
    'R00','R36',  # Transition awards (postdoc to independence)
}
# Extended infrastructure codes - center grants, resource grants, equipment grants
INFRASTRUCTURE_CODES = {
    'P30','P50','P51','S10','G20','U13','R13','U24','U2C',
    'P20','P40','P41','P60','U42','UC7',
    'UC2','UC4','UC6',  # Specialized center/consortium grants
}
SBIR_CODES = {'R41','R42','R43','R44','SB1','U44'}
MULTI_COMPONENT_CODES = {'P01','P20','P2C','P30','P50','P51','P60','U19','U54','U24','U2C','UC7','UG4','U42','P40','P41'}
# Clinical/Translational Science Awards - always infrastructure
CTSA_CODES = {'UL1','TL1','KL2'}

def classify_org(org_name, activity_code):
    org = org_name.upper()
    if activity_code in SBIR_CODES:
        return 'company'
    # Company signals
    company_signals = [
        'LLC', 'INC.', 'INC,', ' INC', 'CORP', 'L.L.C', 'L.P.',
        'THERAPEUTICS', 'BIOSCIENCES', 'PHARMACEUTICALS', 'BIOTECH', 'BIOPHARMA',
        'TECHNOLOGIES INC', 'SCIENCES INC', 'DEVICES INC', 'SOLUTIONS INC',
        'HEALTH INC', 'ONCOLOGY INC', 'DIAGNOSTICS INC', 'GENOMICS INC',
        'LABS INC', 'MEDICAL INC', 'PHARMA INC',
    ]
    if any(s in org for s in company_signals):
        return 'company'

    # University signals (expanded to catch abbreviations and international)
    uni_signals = [
        'UNIVERSITY', 'UNIV ', ' UNIV', 'UNIV.', 'UNIVERSIT',  # Catches UNIVERSITAT, UNIVERSITE, etc
        'COLLEGE', 'INSTITUTE OF TECHNOLOGY', 'POLYTECHNIC',
        'SCHOOL OF MEDICINE', 'MEDICAL SCHOOL', 'MEDICAL COLLEGE',
        'SCHOOL OF PUBLIC HEALTH',
    ]
    # Well-known universities that may not have "UNIVERSITY" in org name
    known_universities = [
        'RUTGERS', 'HARVARD', 'STANFORD', 'MIT ', 'CALTECH', 'YALE', 'PRINCETON',
        'COLUMBIA', 'CORNELL', 'DUKE', 'JOHNS HOPKINS', 'EMORY', 'VANDERBILT',
        'NORTHWESTERN', 'UCLA', 'UCSD', 'UCSF', 'USC ', 'NYU ', 'BROWN',
        'DARTMOUTH', 'PENN STATE', 'OHIO STATE', 'MICHIGAN STATE', 'FLORIDA STATE',
        'TEXAS A&M', 'PURDUE', 'WISCONSIN-',
        'ICAHN SCHOOL', 'WEILL CORNELL', 'BAYLOR COLLEGE',
    ]
    is_uni = any(s in org for s in uni_signals) or any(s in org for s in known_universities)

    # Hospital/health system signals
    hosp_signals = [
        'HOSPITAL', 'MEDICAL CENTER', 'HEALTH SYSTEM', 'HEALTH CENTER', 'CLINIC',
        'MAYO', "CHILDREN'S", 'MEDICAL CTR', 'HEALTH CARE', 'HEALTH SCIENCES CENTER',
        'NATIONAL JEWISH HEALTH', 'BANNER HEALTH', 'MOUNT SINAI',
        'MEMORIAL SLOAN', 'MD ANDERSON', 'CITY OF HOPE',
        ' HOSP ', 'HOSP ',  # Abbreviation: "CHILDRENS HOSP MED CTR"
        'CHILDRENS HOSP', "CHILDREN'S HOSP",  # Children's hospitals
    ]
    if any(s in org for s in hosp_signals) and not is_uni:
        return 'hospital'

    # Research institute signals (expanded)
    ri_signals = [
        'RESEARCH INSTITUTE', 'RESEARCH CENTER', 'RESEARCH CTR',
        'INSTITUTE FOR', 'INSTITUTE OF',  # e.g., "LAUREATE INSTITUTE FOR BRAIN RESEARCH"
        'SCRIPPS', 'BROAD INSTITUTE', 'SALK INSTITUTE',
        'FRED HUTCHINSON', 'SLOAN', 'DANA-FARBER', 'COLD SPRING HARBOR',
        'JACKSON LABORATORY', 'WISTAR', 'LA JOLLA INSTITUTE', 'FEINSTEIN',
        'BECKMAN RESEARCH', 'BATTELLE', 'WOODS HOLE', 'STOWERS', 'ALLEN INSTITUTE',
        'WHITEHEAD INSTITUTE', 'CARNEGIE INSTITUTION', 'HUDSON ALPHA', 'VAN ANDEL',
        'PENNINGTON', 'RESEARCH TRIANGLE', 'LAUREATE',  # RTI, Pennington, Laureate
        'BIOMEDICAL RESEARCH', 'PSYCHIATRIC INSTITUTE',
    ]
    if any(s in org for s in ri_signals) and not is_uni:
        return 'research_institute'

    if is_uni:
        return 'university'
    if any(s in org for s in hosp_signals):
        return 'hospital'
    return 'other'


def score_all_categories(title, abstract, phr, activity_code):
    t = title.lower()
    text = (title + ' ' + abstract + ' ' + phr).lower()
    abs_lower = abstract.lower()

    scores = {cat: 0 for cat in ['basic_research','therapeutics','biotools','diagnostics',
                                   'medical_device','digital_health','other']}

    # BASIC RESEARCH
    br_strong = [
        'elucidate the mechanism', 'elucidate the role', 'elucidate how',
        'understand the mechanism', 'understand the role', 'understand how',
        'define the mechanism', 'define the role', 'define how',
        'dissect the mechanism', 'dissect the role',
        'characterize the mechanism', 'characterize the role',
        'determine the mechanism', 'determine the role', 'determine how',
        'investigate the mechanism', 'investigate the role',
        'underlying mechanisms', 'mechanisms responsible',
        'mechanisms by which', 'mechanisms underlying',
        'mechanisms involved in', 'mechanisms that govern',
        'mechanisms that drive', 'mechanisms that mediate',
        'molecular basis of', 'molecular mechanisms',
        'cellular mechanisms', 'neural mechanisms',
        'biological mechanisms', 'pathological mechanisms',
        'cellular and molecular mechanisms',
        'signaling pathway', 'signal transduction',
        'gene regulation', 'transcriptional regulation',
        'epigenetic regulation', 'post-translational',
        'structure-function relationship',
        'fundamental understanding', 'fundamental question',
    ]
    br_moderate = [
        'role of', 'function of', 'mechanism of', 'pathway',
        'regulation of', 'expression of', 'interaction between',
        'genetic basis', 'susceptibility', 'etiology',
        'pathogenesis', 'pathophysiology',
        'in vivo', 'in vitro', 'mouse model', 'animal model',
        'single-cell', 'rna-seq', 'chip-seq', 'atac-seq',
        'transcriptom', 'proteom', 'metabolom',
        'neural circuit', 'synaptic', 'neuronal',
        'immune response', 'inflammatory response', 'cytokine',
        'tumor microenvironment', 'cancer biology',
        'structural biology', 'protein structure',
        'chromatin', 'epigenom', 'methylation',
        'crystal structure', 'cryo-em', 'x-ray crystallography',
        'allosteric', 'conformational',
        'evolutionary', 'phylogenet', 'comparative genomics',
        'host-pathogen', 'viral replication', 'viral pathogenesis',
        'brain region', 'cortical', 'hippocampal', 'amygdala',
        'prefrontal', 'striatum', 'cerebellum', 'thalamus',
        'dopamine', 'serotonin', 'glutamate', 'gaba',
        'optogenetic', 'electrophysiology', 'patch clamp',
        'calcium imaging', 'two-photon', 'fmri',
        'perception', 'sensory processing', 'motor control',
        'memory formation', 'learning and memory', 'fear conditioning',
        'circadian', 'sleep-wake',
        'mitochondri', 'endoplasmic reticulum', 'golgi',
        'autophagy', 'apoptosis', 'cell cycle', 'cell division',
        'stem cell biology', 'cell fate', 'differentiation',
        'organoid', 'spheroid',
        'innate immun', 'adaptive immun',
        'immune signaling', 'immune regulation',
        'genome-wide', 'gwas', 'whole genome', 'exome',
        'crispr', 'gene editing', 'knockout',
        'transcription factor', 'enhancer', 'promoter',
        'microbiome', 'bacterial', 'fungal', 'parasit',
        'protein folding', 'enzyme kinetics', 'binding affinity',
        'thermodynamics', 'kinetics of', 'catalytic',
    ]
    scores['basic_research'] += sum(3 for s in br_strong if s in text)
    scores['basic_research'] += sum(1 for s in br_moderate if s in text)
    for kw in ['mechanism', 'regulation', 'pathway', 'circuit', 'role of',
               'function of', 'biology of', 'basis of', 'dynamics of',
               'evolution of', 'structure of', 'modulation of']:
        if kw in t:
            scores['basic_research'] += 4

    # THERAPEUTICS
    tx_strong = [
        'clinical trial', 'phase i ', 'phase ii', 'phase iii',
        'phase 1 ', 'phase 2 ', 'phase 3 ',
        'drug development', 'drug discovery', 'drug design',
        'drug delivery', 'drug candidate', 'drug target',
        'lead compound', 'lead optimization', 'hit-to-lead',
        'ind-enabling', 'investigational new drug',
        'therapeutic development', 'therapeutic candidate',
        'vaccine development', 'vaccine candidate', 'immunogen',
        'car-t', 'car t cell', 'chimeric antigen receptor',
        'gene therapy for', 'cell therapy for', 'stem cell therapy',
        'antisense oligonucleotide', 'sirna therapeutic',
        'monoclonal antibody therap', 'bispecific antibody',
        'nanoparticle for treat', 'nanoformulation',
        'randomized controlled trial', 'placebo-controlled',
        'efficacy and safety', 'pharmacokinetic', 'pharmacodynamic',
        'toxicology study', 'toxicity study',
        'dose escalation', 'dose-response',
        'preclinical development', 'preclinical efficacy',
        'first-in-human', 'first in human',
        'fda approval', 'ind application',
        'gmp manufacturing', 'good manufacturing',
        'targeted degradation', 'protac', 'peptac',
        'structure-activity relationship',
        'medicinal chemistry', 'drug repurpos',
    ]
    tx_moderate = [
        'treatment of', 'therapy for', 'therapeutic',
        'inhibitor of', 'agonist', 'antagonist', 'modulator',
        'small molecule', 'prodrug', 'formulation',
        'clinical efficacy', 'clinical benefit',
        'tumor regression', 'anti-tumor', 'antitumor',
        'antiviral', 'antimicrobial', 'antibiotic',
        'immune checkpoint', 'immunotherapy',
        'dose', 'dosing', 'dosage',
    ]
    scores['therapeutics'] += sum(3 for s in tx_strong if s in text)
    scores['therapeutics'] += sum(1 for s in tx_moderate if s in text)
    for kw in ['treatment','therapy','therapeutic','drug','vaccine',
               'inhibitor','clinical trial','gene therapy','cell therapy',
               'car-t','immunotherapy','antiviral']:
        if kw in t:
            scores['therapeutics'] += 4

    # BIOTOOLS - requires explicit tool creation/distribution intent
    # Gate: Must have clear indication the PRIMARY output is a tool for community use
    biotools_creation_intent = any(w in text for w in [
        'develop a platform', 'develop a tool', 'develop software',
        'develop a pipeline', 'develop an assay', 'develop a method',
        'create a platform', 'create a tool', 'build a pipeline',
        'novel platform', 'novel tool', 'novel assay', 'novel probe',
        'open source', 'open-source', 'publicly available',
        'widely available', 'community resource', 'for researchers',
        'for the research community', 'for the field',
        'user-friendly', 'web server', 'web tool', 'downloadable',
        'r package', 'python package', 'github', 'software package',
        'reference standard', 'reference material', 'biobank',
        'disseminat', 'made available to',
    ])

    if biotools_creation_intent:
        bt_strong = [
            'develop a platform for', 'develop a tool for', 'develop software for',
            'develop a pipeline for', 'develop an assay for',
            'novel platform for', 'novel tool for', 'novel assay for',
            'novel probe for', 'novel sensor for',
            'high-throughput screening platform',
            'computational pipeline for', 'computational tool for',
            'computational framework for', 'software tool for',
            'database for', 'atlas of',
            'open source', 'open-source', 'publicly available',
            'widely available to', 'community resource',
            'for the research community', 'for researchers',
            'reference standard', 'reference material',
            'r package', 'python package', 'web server', 'web tool',
            'user-friendly interface', 'disseminat',
            'downloadable', 'made available to',
            'accessible to researcher', 'biobank',
        ]
        bt_moderate = [
            'sequencing method', 'imaging method',
            'assay development', 'biosensor development',
            'bioinformatics tool', 'data resource',
            'statistical method', 'statistical framework',
            'machine learning tool', 'repository',
        ]
        scores['biotools'] += sum(3 for s in bt_strong if s in text)
        scores['biotools'] += sum(1 for s in bt_moderate if s in text)
        for kw in ['platform for','pipeline for','tool for','atlas of','database of',
                   'resource for','assay for','probe for',
                   'high-throughput','computational tool','software for']:
            if kw in t:
                scores['biotools'] += 4
    # Without creation intent, only give biotools score for very strong signals
    else:
        if any(w in t for w in ['tool for', 'platform for', 'atlas of', 'database of',
                                'computational tool', 'software for']):
            scores['biotools'] += 2

    # DIAGNOSTICS
    dx_strong = [
        'diagnostic test', 'diagnostic assay', 'diagnostic accuracy',
        'early detection of cancer', 'early detection of disease',
        'screening test for', 'cancer screening',
        'sensitivity and specificity', 'roc curve',
        'companion diagnostic', 'point-of-care test', 'point of care test',
        'liquid biopsy for', 'cell-free dna for diagnos',
        'circulating tumor cell', 'circulating tumor dna',
        'biomarker panel for diagnos', 'biomarker validation for',
        'clinical biomarker', 'validated biomarker',
        'prenatal screening', 'newborn screening',
        'rapid diagnostic test', 'lateral flow assay',
        'prognostic biomarker for', 'predictive biomarker for',
        'clinical validation of', 'analytical validation of',
    ]
    dx_moderate = [
        'diagnostic', 'early detection', 'cancer detection',
        'disease detection', 'screening',
        'biomarker discovery', 'classify patients', 'stratify patients',
        'imaging for detection', 'radiomics',
    ]
    scores['diagnostics'] += sum(3 for s in dx_strong if s in text)
    scores['diagnostics'] += sum(1 for s in dx_moderate if s in text)
    for kw in ['diagnostic','early detection','screening','liquid biopsy',
               'point-of-care','companion diagnostic']:
        if kw in t:
            scores['diagnostics'] += 4

    # MEDICAL DEVICE — requires development intent
    dev_intent = any(w in text for w in [
        'develop', 'design', 'fabricat', 'engineer', 'build',
        'construct', 'manufacture', 'prototype', 'optimize',
        'create a', 'novel', 'new approach', 'we propose',
        'our goal is', 'our objective is', 'aim is to',
        'biocompat', 'implantable',
        '510(k)', 'fda clearance', 'de novo classification',
        'bench testing', 'preclinical testing',
        'first-in-human', 'clinical translation',
    ])
    sbir_device = activity_code in SBIR_CODES and any(w in text for w in [
        'device','implant','catheter','stent','scaffold','electrode',
        'prosthe','sensor','wearable','surgical','instrument',
        'microneedle','needle','patch','insert','cap',
    ])
    if dev_intent or sbir_device:
        md_strong = [
            'implantable device', 'neural implant', 'cochlear implant',
            'prosthetic device', 'prosthesis', 'orthopedic device',
            'surgical instrument', 'surgical robot', 'robotic surgery',
            'brain-computer interface', 'brain computer interface',
            'neural interface', 'neuroprosthe',
            'tissue scaffold for', 'tissue engineering for', 'tissue-engineered',
            'bioresorbable', 'biomaterial for patient', 'biomaterial for tissue',
            'stent design', 'stent for', 'catheter design', 'catheter for',
            'pacemaker', 'defibrillator',
            'wearable device for patient', 'wearable sensor for patient',
            'exoskeleton for', 'orthosis for',
            'microneedle patch', 'microneedle for',
            'microelectrode array for stimulat', 'microelectrode array for record',
            'retinal prosthe', 'visual prosthe',
            'surgical navigation', 'image-guided surgery',
            'bioprinting for tissue', '3d-printed implant',
            'drug-eluting stent', 'drug-coated',
            'hydrogel electrode', 'injectable electrode',
            'endoscop', 'laparoscop',
        ]
        md_moderate = ['implant for', 'scaffold for', 'biocompat', 'biodegrad']
        scores['medical_device'] += sum(3 for s in md_strong if s in text)
        scores['medical_device'] += sum(1 for s in md_moderate if s in text)
        for kw in ['implant','prosthe','stent','catheter','device for',
                    'scaffold for','wearable for','exoskeleton',
                    'microneedle','neural interface','brain-computer',
                    'bionic','cochlear']:
            if kw in t:
                scores['medical_device'] += 4

    # DIGITAL HEALTH — requires deployment context
    deployment = any(w in text for w in [
        'patient', 'clinician', 'provider', 'physician',
        'clinical setting', 'clinical practice', 'clinic',
        'hospital', 'emergency department', 'primary care',
        'deployed', 'implement', 'adoption',
        'end user', 'participant', 'consumer',
        'health system', 'health care',
    ])
    dh_title_signal = any(w in t for w in ['telehealth','telemedicine','mhealth','digital health',
                'remote monitoring','digital therapeutic','ehr','electronic health',
                'mobile health','health app','clinical decision support'])
    if deployment or dh_title_signal:
        dh_strong = [
            'telemedicine', 'telehealth', 'mhealth', 'm-health',
            'digital health intervention', 'digital therapeutic',
            'mobile app for patient', 'smartphone app for',
            'remote patient monitoring',
            'clinical decision support system',
            'electronic health record', 'ehr integration',
            'patient portal', 'digital intervention for',
            'text message intervention', 'sms-based intervention',
        ]
        dh_moderate = [
            'web-based intervention for patient', 'online intervention',
            'chatbot for patient', 'virtual reality therap',
            'patient engagement', 'self-management',
            'telepsychiatry', 'telemonitoring', 'teleconsult',
            'app-based', 'wearable for monitoring',
        ]
        scores['digital_health'] += sum(3 for s in dh_strong if s in text)
        scores['digital_health'] += sum(1 for s in dh_moderate if s in text)
        for kw in ['telehealth','telemedicine','mhealth','digital health',
                    'remote monitoring','digital therapeutic','ehr']:
            if kw in t:
                scores['digital_health'] += 4

    # OTHER
    ot_strong = [
        'health disparit', 'health equity', 'social determinants of health',
        'implementation science', 'implementation strateg',
        'dissemination and implementation',
        'community-based participatory', 'community health worker',
        'behavioral intervention for', 'behavioral treatment for',
        'cohort study', 'longitudinal cohort', 'prospective cohort',
        'epidemiologic study', 'population-based study',
        'health services research', 'health care delivery',
        'quality improvement', 'quality of care',
        'cost-effectiveness analysis', 'cost effectiveness',
        'health policy', 'health insurance',
        'smoking cessation program', 'weight management program',
        'lifestyle modification', 'diet and exercise intervention',
        'motivational interviewing', 'cognitive behavioral therapy for',
        'mindfulness-based intervention', 'psychosocial intervention',
        'culturally tailored intervention', 'cultural adaptation',
        'violence prevention', 'injury prevention',
        'occupational health', 'occupational safety',
        'food safety', 'produce safety', 'food protection',
        'environmental health', 'environmental exposure',
        'hazardous waste', 'hazardous material', 'hazmat',
        'radiation protection', 'radiation control',
        'health literacy', 'health communication',
        'patient navigation program', 'care coordination',
    ]
    ot_moderate = [
        'disparity', 'disparities', 'inequity',
        'social support', 'peer support', 'self-efficacy',
        'stigma', 'discrimination',
        'substance use disorder', 'alcohol use disorder', 'opioid use disorder',
        'adherence', 'retention in care',
        'qualitative study', 'focus group', 'semi-structured interview',
        'community engagement', 'prep ', 'pre-exposure prophylaxis',
        'caregiver', 'caregiving', 'family member',
        'social isolation', 'loneliness',
        'health behavior', 'risk behavior',
        'clinical outcome measure', 'patient-reported outcome',
        'quality of life', 'well-being', 'wellbeing',
        'pain management', 'chronic pain',
        'rehabilitation program', 'recovery program',
    ]
    scores['other'] += sum(3 for s in ot_strong if s in text)
    scores['other'] += sum(1 for s in ot_moderate if s in text)
    for kw in ['disparit','equity','implementation science','behavioral intervention',
               'cessation','violence prevent','occupational','environmental exposure']:
        if kw in t:
            scores['other'] += 4

    # DISAMBIGUATION RULES
    if activity_code in SBIR_CODES:
        scores['therapeutics'] += 3
        scores['medical_device'] += 2
        scores['basic_research'] = 0
    has_distribution = any(w in text for w in [
        'for researchers', 'for the community', 'widely available',
        'open source', 'shared resource', 'disseminat', 'user-friendly',
        'publicly available', 'web server', 'downloadable',
        'made available', 'community resource', 'for the field',
    ])
    if scores['basic_research'] > scores['biotools'] and not has_distribution:
        scores['biotools'] = max(0, scores['biotools'] - 4)
    has_drug = any(w in text for w in ['drug', 'compound', 'small molecule', 'inhibitor',
                                        'nanoparticle', 'antibody therap', 'vaccine',
                                        'gene therapy', 'cell therapy'])
    if scores['other'] >= 5 and scores['therapeutics'] > 0 and not has_drug:
        scores['therapeutics'] = max(0, scores['therapeutics'] - 5)
    is_behavioral = any(w in text for w in ['behavioral', 'lifestyle', 'psychosocial',
                                             'mindfulness', 'motivational interviewing',
                                             'cognitive behavioral', 'physical activity intervention'])
    if is_behavioral and 'randomized' in text and not has_drug:
        scores['other'] += 4
        scores['therapeutics'] = max(0, scores['therapeutics'] - 3)
    is_epi = any(w in text for w in ['cohort study', 'epidemiologic', 'population-based study',
                                      'longitudinal study of risk', 'prospective study of'])
    is_molecular = any(w in text for w in ['mechanism', 'pathway', 'signaling', 'molecular',
                                            'gene expression', 'transcriptom', 'proteom'])
    if is_epi and not is_molecular:
        scores['other'] += 4
        scores['basic_research'] = max(0, scores['basic_research'] - 3)
    if any(w in text for w in ['novel statistical method', 'develop statistical',
                                'develop computational method', 'new algorithm for analyz',
                                'develop machine learning method']):
        scores['biotools'] += 4
    if any(w in text for w in ['mechanism of action', 'how drug', 'how compound',
                                'understand the effect', 'mechanism of resistance']):
        if not any(w in text for w in ['optimize', 'develop', 'clinical trial',
                                        'drug delivery', 'lead optimization']):
            scores['basic_research'] += 3
    if scores['basic_research'] >= 8 and scores['other'] > 0:
        if scores['other'] < scores['basic_research'] * 0.6:
            scores['other'] = max(0, scores['other'] - 3)
    if any(w in text for w in ['drug delivery', 'deliver therapeutic', 'deliver treatment']):
        scores['therapeutics'] += 2
        scores['biotools'] = max(0, scores['biotools'] - 2)
    if any(w in text for w in ['web-app', 'web app', 'physical activity', 'lifestyle']):
        if not any(w in text for w in ['telemedicine', 'telehealth', 'ehr', 'clinical decision support']):
            scores['digital_health'] = max(0, scores['digital_health'] - 3)
            scores['other'] += 1
    therapeutic_title = any(w in t for w in ['therapy', 'treatment', 'therapeutic', 'improve treatment',
                                              'novel strateg', 'repair', 'rescue'])
    if therapeutic_title and scores['basic_research'] > scores['therapeutics']:
        if scores['therapeutics'] >= 3:
            scores['therapeutics'] += 4

    # ADDITIONAL DISAMBIGUATION RULES based on validation

    # Rule 12: Diagnostics vs biotools - if clinical validation/patient detection mentioned, favor diagnostics
    clinical_diagnostic = any(w in text for w in ['early detection', 'cancer detection', 'disease detection',
                                                   'clinical validation', 'diagnostic accuracy',
                                                   'sensitivity and specificity', 'roc curve',
                                                   'detect cancer', 'detect disease', 'screening test'])
    if clinical_diagnostic and scores['biotools'] > scores['diagnostics']:
        scores['diagnostics'] += 3
        scores['biotools'] = max(0, scores['biotools'] - 2)

    # Rule 13: Digital health vs other - cohort studies, T-cell modeling = NOT digital health
    is_cohort_or_modeling = any(w in text for w in ['cohort', 't-cell receptor', 'tcr repertoire',
                                                     'immune repertoire', 'modeling the dynamics',
                                                     'precision medicine cohort'])
    is_digital_intervention = any(w in text for w in ['mhealth', 'mobile app', 'smartphone app',
                                                       'telehealth', 'telemedicine', 'remote monitoring',
                                                       'digital intervention', 'text message intervention'])
    if is_cohort_or_modeling and not is_digital_intervention:
        scores['digital_health'] = max(0, scores['digital_health'] - 4)
        if 'cohort' in text:
            scores['other'] += 2

    # Rule 14: Medical device vs basic research - hearing/cochlear studies without device development
    is_hearing_study = any(w in text for w in ['cochlear', 'hearing', 'auditory', 'efferent'])
    is_device_development = any(w in text for w in ['implant', 'prosthe', 'device', 'electrode array',
                                                     'fabricat', 'manufacture', 'prototype'])
    if is_hearing_study and not is_device_development:
        if scores['medical_device'] > scores['basic_research']:
            scores['basic_research'] += 3
            scores['medical_device'] = max(0, scores['medical_device'] - 3)

    # Rule 15: Policy/document analysis → other, not therapeutics
    is_policy_analysis = any(w in text for w in ['industry documents', 'policy analysis', 'marketing',
                                                  'advertising', 'regulatory', 'opioid industry',
                                                  'pharmaceutical marketing'])
    if is_policy_analysis and not has_drug:
        scores['other'] += 4
        scores['therapeutics'] = max(0, scores['therapeutics'] - 4)

    # Rule 16: Care coordination without digital tools → other, not digital_health
    is_care_coordination = any(w in text for w in ['care coordination', 'onco-primary care',
                                                    'survivorship care', 'care delivery'])
    if is_care_coordination and not is_digital_intervention:
        scores['other'] += 2
        scores['digital_health'] = max(0, scores['digital_health'] - 2)

    # Rule 17: Veterinary diagnostics/capacity → infrastructure or other, not diagnostics
    is_veterinary = any(w in text for w in ['vet-lirn', 'veterinary', 'animal feed', 'animal health'])
    if is_veterinary and activity_code in ('R18', 'U42', 'P40'):
        scores['diagnostics'] = max(0, scores['diagnostics'] - 4)
        scores['other'] += 2

    # Rule 18: Media/storybook/educational interventions → other, not basic_research
    is_educational_intervention = any(w in text for w in ['media intervention', 'storybook',
                                                           'educational intervention', 'literacy intervention',
                                                           'school-based intervention', 'classroom',
                                                           'low-ses preschooler', 'caregiver intervention'])
    if is_educational_intervention:
        scores['other'] += 4
        scores['basic_research'] = max(0, scores['basic_research'] - 3)

    # Rule 19: Fitness/Peloton apps → digital_health, not medical_device
    is_fitness_app = any(w in text for w in ['peloton', 'fitness app', 'fitness mhealth',
                                              'exercise app', 'cardiac rehab app'])
    if is_fitness_app:
        scores['digital_health'] += 3
        scores['medical_device'] = max(0, scores['medical_device'] - 3)

    # Rule 20: Wearable flow sensors, continuous monitoring devices → medical_device
    is_wearable_device = any(w in text for w in ['wearable flow sensor', 'wearable sensor for',
                                                   'continuous monitoring device', 'implantable sensor'])
    if is_wearable_device:
        scores['medical_device'] += 3
        scores['diagnostics'] = max(0, scores['diagnostics'] - 1)

    # Rule 21: Drug delivery systems with targeting → therapeutics, not basic_research
    is_targeted_delivery = any(w in text for w in ['targeted liposome', 'pan-antifungal',
                                                    'targeted nanoparticle', 'drug-loaded',
                                                    'therapeutic delivery'])
    if is_targeted_delivery:
        scores['therapeutics'] += 3
        scores['basic_research'] = max(0, scores['basic_research'] - 2)

    # Rule 22: Portable MRI/imaging for clinical use → diagnostics or medical_device
    is_portable_imaging = any(w in text for w in ['portable mri', 'point-of-care imaging',
                                                   'portable ultrasound', 'handheld imaging'])
    if is_portable_imaging:
        scores['medical_device'] += 2
        scores['diagnostics'] += 2

    # Rule 23: Smartphone-based screeners/apps for clinical use → digital_health
    is_smartphone_health = any(w in text for w in ['smartphone-based', 'smartphone app',
                                                    'mobile phone-based', 'phone-based screening',
                                                    'wound screener', 'wound infection screener',
                                                    'mobile screening', 'app-based screening'])
    if is_smartphone_health:
        scores['digital_health'] += 5
        scores['other'] = max(0, scores['other'] - 3)

    # Rule 24: AI/ML clinical decision support → digital_health
    is_ai_cds = any(w in text for w in ['ai-based clinical decision', 'ai clinical decision support',
                                         'machine learning clinical decision', 'ml-based clinical',
                                         'artificial intelligence for clinical', 'ai for clinical decision',
                                         'clinical decision support system', 'sepsis care with ai',
                                         'ai-based decision support', 'ml decision support'])
    if is_ai_cds:
        scores['digital_health'] += 5
        scores['other'] = max(0, scores['other'] - 3)
        scores['biotools'] = max(0, scores['biotools'] - 2)

    # Rule 25: Force-sensing, wireless medical devices → medical_device
    is_force_sensing_device = any(w in text for w in ['force-sensing', 'force sensing',
                                                       'wireless suture', 'suture anchor',
                                                       'real-time feedback for rehabilitation',
                                                       'post-operative rehabilitation device',
                                                       'rehabilitation device', 'rehab device'])
    if is_force_sensing_device:
        scores['medical_device'] += 5
        scores['other'] = max(0, scores['other'] - 3)

    # Rule 26: Core in title with U54/UL1 but missed by earlier rules → likely infrastructure
    # This catches "MMC" or abbreviated core names
    if activity_code in ('U54', 'UL1', 'P30', 'P50'):
        is_likely_core = any(w in text for w in ['this core', 'the core will', 'core provides',
                                                  'shared resource', 'core facility',
                                                  'support researchers', 'assist investigators'])
        if is_likely_core:
            # Don't change scores, let classify_project handle it with early returns
            pass  # Handled by explicit returns in classify_project

    # Rule 27: Research instrumentation/platforms → biotools (not therapeutics)
    # SBIR/STTR developing imaging/measurement/analysis platforms for research are biotools
    is_research_platform = any(w in text for w in [
        'imaging platform', 'imaging system for', 'parallelized imaging',
        'measurement platform', 'analysis platform', 'screening platform',
        'actuator and detector', 'detector for', 'sensor platform',
        'assessment of.*development', 'long-term assessment',
        'high-throughput platform', 'automated platform',
        'platform for.*research', 'platform for.*analysis',
        'platform for.*assessment', 'platform for.*screening',
    ])
    # Also check title specifically for strong platform signals
    is_platform_in_title = any(w in t for w in [
        'imaging platform', 'platform for', 'actuator', 'detector',
    ])
    if is_research_platform or is_platform_in_title:
        # If this looks like a research tool, boost biotools and reduce therapeutics
        if scores['therapeutics'] > scores['biotools']:
            scores['biotools'] += 5
            scores['therapeutics'] = max(0, scores['therapeutics'] - 3)

    return scores


def classify_project(row):
    aid = row['application_id']
    title = row.get('title', '').strip()
    org = row.get('org_name', '').strip()
    code = row.get('activity_code', '').strip()
    abstract = row.get('abstract', '').strip()
    phr = row.get('phr', '').strip()
    t = title.lower()
    abs_lower = abstract.lower()
    text = (title + ' ' + abstract + ' ' + phr).lower()
    org_type = classify_org(org, code)

    if len(abstract.strip()) < 50:
        if code in TRAINING_CODES:
            return aid, 'training', 95, '', org_type
        if code in INFRASTRUCTURE_CODES:
            return aid, 'infrastructure', 95, '', org_type
        return aid, 'unclassified', 0, '', org_type

    if code in TRAINING_CODES:
        return aid, 'training', 95, '', org_type
    if code in INFRASTRUCTURE_CODES:
        return aid, 'infrastructure', 95, '', org_type
    # UL1 = Clinical and Translational Science Awards (CTSA) - infrastructure
    if code == 'UL1':
        return aid, 'infrastructure', 95, '', org_type

    if code in MULTI_COMPONENT_CODES:
        admin_title = any(w in t for w in [
            'administrative core','admin core','core a:','core a -','core a,',
            'coordination core','coordinating core','infrastructure core',
            'facility management','operations core','management core',
        ])
        if t.strip() in ['core a','administrative core','admin core',
                          'infrastructure and opportunities fund management core']:
            admin_title = True
        admin_abstract = any(w in abs_lower for w in [
            'administrative support','fiscal management','fiscal oversight',
            'budgetary oversight','administrative and fiscal','general administration',
            'regulatory compliance','administrative leadership',
            'administrative and secretarial','financial management',
        ])
        if admin_title or (admin_abstract and 'core' in t and len(t) < 80):
            return aid, 'infrastructure', 85, '', org_type
        resource_words = [
            'shared resource','core facility','equipment core','instrumentation core',
            'biostatistics core','data core','informatics core','genomics core',
            'proteomics core','imaging core','histopathology core','pathology core',
            'breeding core','mouse core','animal core','biorepository',
            'tissue core','specimen core','technology core','service core',
            'sequencing core','bioinformatics core','flow cytometry core',
            'antibody core','alterations and renovation','web services',
            'enrichment program','pilot and feasibility','biospecimen core',
            'research core','analytic core','analytics core','clinical core',
            'preclinical core','translational core','outreach core',
            'community engagement core','data science core',
        ]
        if any(w in t for w in resource_words):
            return aid, 'infrastructure', 85, '', org_type
        core_pattern = re.match(r'^(core\s+[a-z0-9]|core\s*[:;-])', t)
        if core_pattern and any(w in abs_lower for w in ['core will provide','core will serve',
                'core will support','shared resource','core facility']):
            return aid, 'infrastructure', 80, '', org_type
        abs_first_100 = abs_lower[:100]
        is_core_in_abstract = any(w in abs_first_100 for w in [
            'core b', 'core c', 'core d', 'core e',
            'administrative core', 'data core', 'biostatistics core',
            'genomics core', 'proteomics core', 'imaging core',
            'clinical core', 'analytic core', 'biospecimen core',
            'histopathology core', 'pathology core', 'breeding core',
            'flow cytometry core', 'antibody core', 'outreach core',
            'translational core', 'research core', 'technology core',
        ])
        if is_core_in_abstract and any(w in abs_lower for w in [
                'core will provide','core will serve','core will support',
                'core leader','core facility','shared resource']):
            return aid, 'infrastructure', 80, '', org_type
        if any(w in t for w in ['mentoring core','mentorship','professional development',
                                 'career development','investigator development',
                                 'education core','training core']):
            return aid, 'training', 85, '', org_type

    if code in ('U45','UH4'):
        return aid, 'training', 85, '', org_type
    if code == 'U2F':
        return aid, 'other', 85, '', org_type
    if code == 'U18' and any(w in text for w in ['radiation control','radiation protection',
                                                   'animal feed','food safety','food protection']):
        return aid, 'other', 85, '', org_type
    if any(w in text for w in ['seer program','seer registry','surveillance epidemiology and end results']):
        return aid, 'infrastructure', 85, '', org_type
    if code in ('UG1','U10'):
        if any(w in text for w in ['clinical center','clinical site','network site',
                'clinical trial network','cooperative group','consortium site']):
            return aid, 'infrastructure', 80, '', org_type
    if code == 'UC7':
        return aid, 'infrastructure', 85, '', org_type

    # INBRE/COBRE/IDeA programs → infrastructure (capacity building)
    if any(w in text for w in ['inbre', 'cobre', 'idea program', 'idea network',
                                'biomedical research infrastructure', 'centers of biomedical research excellence',
                                'institutional development award']):
        if code in ('P20', 'P30', 'U54'):
            return aid, 'infrastructure', 85, '', org_type

    # Testing cores and viral testing → infrastructure
    if 'testing core' in t or 'viral testing' in t:
        if code in MULTI_COMPONENT_CODES or code == 'U42':
            return aid, 'infrastructure', 85, '', org_type

    # Engagement cores, community cores → infrastructure
    if any(w in t for w in ['engagement core', 'community core', 'partnership core']):
        if code in MULTI_COMPONENT_CODES:
            return aid, 'infrastructure', 85, '', org_type

    # Coordinating centers → infrastructure
    if any(w in t for w in ['coordinating center', 'coordination center', 'data sharing center',
                            'coordinating and data']):
        return aid, 'infrastructure', 80, '', org_type

    # U54 projects with short titles (likely core abbreviations) + core keywords → infrastructure
    if code == 'U54' and len(t) <= 10:
        is_core_like = any(w in abs_lower for w in ['this core', 'the core will', 'core provides',
                                                     'shared resource', 'core facility',
                                                     'support researchers', 'assist investigators',
                                                     'service to investigators', 'biostatistics support'])
        if is_core_like:
            return aid, 'infrastructure', 80, '', org_type

    scores = score_all_categories(title, abstract, phr, code)
    max_score = max(scores.values())
    if max_score == 0:
        if code.startswith('R') and code not in ('R13','R25','R90'):
            has_science = any(w in text for w in [
                'study', 'research', 'investigat', 'examin', 'analyz',
                'hypothes', 'aim', 'specific aim', 'objective',
                'data', 'result', 'finding', 'method',
            ])
            if has_science:
                return aid, 'basic_research', 60, '', org_type
        if code in MULTI_COMPONENT_CODES:
            return aid, 'infrastructure', 60, '', org_type
        # No signals at all - flag as unclassified
        return aid, 'unclassified', 0, '', org_type

    sorted_cats = sorted(scores.items(), key=lambda x: -x[1])
    winner = sorted_cats[0][0]
    winner_score = sorted_cats[0][1]
    runner_up = sorted_cats[1][0]
    runner_up_score = sorted_cats[1][1]
    margin = winner_score - runner_up_score

    if margin >= 10: confidence = 90
    elif margin >= 6: confidence = 85
    elif margin >= 3: confidence = 85
    elif margin >= 2: confidence = 80
    elif margin >= 1: confidence = 80 if max_score >= 4 else 75  # Lowered from 5 to 4
    else: confidence = 70

    if max_score >= 20: confidence = max(confidence, 90)
    elif max_score >= 12: confidence = max(confidence, 85)
    elif max_score >= 5: confidence = max(confidence, 80)  # Lowered from 6 to 5

    secondary = ''
    if runner_up_score >= 3 and runner_up_score >= winner_score * 0.3:
        secondary = runner_up

    return aid, winner, confidence, secondary, org_type


# =============================================================================
# MAIN EXECUTION
# =============================================================================

if __name__ == '__main__':
    print("=" * 70)
    print("NIH GRANT CLASSIFIER (OPUS RULES)")
    print("=" * 70)

    # Find all input batch files (v3 format with hyphen: classify_batch_XX-v3.csv)
    pattern = 'etl/classify_batch_*v3*.csv'
    files = sorted([f for f in glob.glob(pattern) if 'classified' not in f])

    if not files:
        print(f"No files found matching: {pattern}")
        exit(1)

    print(f"Found {len(files)} batch files to process\n")

    # Statistics
    total_processed = 0
    category_counts = Counter()
    confidence_counts = Counter()
    org_type_counts = Counter()
    secondary_counts = Counter()

    for filepath in files:
        filename = os.path.basename(filepath)
        # Handle v3 naming: classify_batch_XX-v3.csv -> classify_batch_XX-v3_classified.csv
        base_name = filename.replace('.csv', '')
        output_file = f'etl/{base_name}_classified.csv'

        rows_in_batch = 0

        with open(filepath, 'r', encoding='utf-8') as infile:
            reader = csv.DictReader(infile)

            with open(output_file, 'w', newline='', encoding='utf-8') as outfile:
                writer = csv.writer(outfile)
                writer.writerow(['application_id', 'primary_category', 'category_confidence', 'secondary_category', 'org_type'])

                for row in reader:
                    aid, category, confidence, secondary, org_type = classify_project(row)
                    writer.writerow([aid, category, confidence, secondary, org_type])

                    rows_in_batch += 1
                    total_processed += 1
                    category_counts[category] += 1
                    confidence_counts[confidence] += 1
                    org_type_counts[org_type] += 1
                    if secondary:
                        secondary_counts[secondary] += 1

        print(f"  {filename} -> {os.path.basename(output_file)} ({rows_in_batch:,} projects)")

    # Summary
    print("\n" + "=" * 70)
    print("CLASSIFICATION COMPLETE")
    print("=" * 70)
    print(f"Total processed: {total_processed:,}")

    print("\n--- Category Distribution ---")
    for cat in ['training', 'infrastructure', 'basic_research', 'biotools',
                'therapeutics', 'diagnostics', 'medical_device', 'digital_health',
                'other', 'unclassified']:
        count = category_counts.get(cat, 0)
        pct = count / total_processed * 100 if total_processed > 0 else 0
        print(f"  {cat:20} {count:>6,} ({pct:5.1f}%)")

    print("\n--- Confidence Distribution ---")
    for conf in sorted(confidence_counts.keys()):
        count = confidence_counts[conf]
        pct = count / total_processed * 100 if total_processed > 0 else 0
        print(f"  {conf:>3}: {count:>6,} ({pct:5.1f}%)")

    print("\n--- Org Type Distribution ---")
    for org in ['university', 'hospital', 'company', 'research_institute', 'other']:
        count = org_type_counts.get(org, 0)
        pct = count / total_processed * 100 if total_processed > 0 else 0
        print(f"  {org:20} {count:>6,} ({pct:5.1f}%)")

    print("\n--- Secondary Category Distribution ---")
    for cat, count in secondary_counts.most_common():
        pct = count / total_processed * 100 if total_processed > 0 else 0
        print(f"  {cat:20} {count:>6,} ({pct:5.1f}%)")

    # High confidence count
    high_conf = sum(c for conf, c in confidence_counts.items() if conf >= 80)
    classified = total_processed - category_counts.get('unclassified', 0)
    high_conf_pct = high_conf / classified * 100 if classified > 0 else 0

    print(f"\n--- Quality Metrics ---")
    print(f"  Classified:          {classified:,}")
    print(f"  Unclassified:        {category_counts.get('unclassified', 0):,}")
    print(f"  >= 80% confidence:   {high_conf:,} ({high_conf_pct:.1f}% of classified)")

    print("\n" + "=" * 70)
    print("Output files: etl/classify_batch_XX_classified.csv")
    print("=" * 70)
