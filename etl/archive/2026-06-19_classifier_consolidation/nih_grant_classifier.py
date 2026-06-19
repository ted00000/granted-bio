#!/usr/bin/env python3
"""NIH Grant Classifier — Automated First Pass"""
import csv, re, sys, os
from collections import Counter

TRAINING_CODES = frozenset({'T32','T34','T35','T90','TL1','TL4','F30','F31','F32','F33','F99','K01','K02','K05','K07','K08','K12','K22','K23','K24','K25','K26','K43','K76','K99','KL2','D43','D71','R25','R90'})
INFRASTRUCTURE_CODES = frozenset({'P30','P50','P51','S10','G20','U13','R13','U24','U2C'})
MULTI_COMPONENT_CODES = frozenset({'P01','P20','P2C','P60','U19','U54','U24','U2C','UC7','UG4','U42'})
SBIR_STTR_CODES = frozenset({'R41','R42','R43','R44','SB1','U44'})
CORE_INDICATORS = ['administrative core','admin core','resource core','shared facility','data core','biostatistics core','imaging core','service core','support core','shared resource','genomics core','proteomics core','bioinformatics core','functional genomics core','histology core','core facility','development core','clinical core','technology core','pathology core','analytics core','coordination core','biorepository core','translational core','pilot core','methods core']
CATEGORY_SIGNALS = {
    'therapeutics': {
        'title': ['phase i','phase ii','phase iii','phase 1','phase 2','phase 3','clinical trial','placebo-controlled','placebo controlled','randomized controlled trial','double-blind','double blind','drug delivery','gene therapy','cell therapy','car-t','car t','vaccine development','vaccine candidate','immunotherapy','antibody therapy','monoclonal antibod','bispecific','nanotherap','nanoconjugate','oncolytic','ind-enabling','ind enabling','peptide vaccine','senolytic'],
        'abstract': ['clinical trial','phase i','phase ii','phase iii','placebo','randomized','double-blind','drug candidate','lead compound','small molecule','drug discovery','drug development','therapeutic','pharmacokinetic','pharmacodynamic','dose-finding','dose escalation','maximally tolerated dose','efficacy and safety','safety and efficacy','first-in-human','investigational new drug','fda-approved','fda approved','preclinical development','lead optimization','vaccine efficacy','immunization','immunogen','antiviral','antibiotic','anticancer','antitumor','chemotherapy','radiation therapy','radionuclide therapy','radioligand therapy','nanoparticle','gene therapy','cell therapy','adoptive','car-t','re-purpose','repurpose'],
    },
    'basic_research': {
        'title': ['mechanism','pathway','role of','roles of','regulation of','function of','functions of','signaling','molecular basis','structural basis','understanding','elucidat','characteriz','decipher','dissect','unravel','neural circuit','gene expression','transcription','epigenetic','chromatin','histone','protein structure','protein-protein','cryo-em','pathogenesis','etiology','genetic basis','morphogenesis','differentiation','cell fate','innate immune','neural basis','neurodevelopment'],
        'abstract': ['mechanism','pathway','signaling','elucidate','characterize','understand','role of','molecular basis','underlying','regulate','regulation','function of','neural circuit','gene expression','transcription','epigenetic','chromatin','protein structure','protein-protein interaction','biochemical','biophysical','pathogenesis','in vivo','mouse model','drosophila','c. elegans','zebrafish','transgenic','knockout','we hypothesize','our hypothesis','central hypothesis','we will determine','we will investigate','we will examine','poorly understood','remains unclear','little is known','knowledge gap'],
    },
    'biotools': {
        'title': ['computational tool','computational pipeline','software tool','platform for','high-throughput','assay development','assay for','novel assay','assay to detect','assay to measure','assay to quantify','probe for','biosensor','database','web resource','reference standard','benchmark','atlas','toolkit','pipeline for','workflow for','imaging platform','imaging method','imaging system','microscopy','sequencing method','sequencing platform','mass spectrometry','analytical method','novel method','novel probe','novel tool','data-driven learning framework','screening platform','screening assay','detection platform','measurement platform','analysis platform','bioinformatics','informatics platform','data integration','multi-omics','single-cell platform','spatial transcriptom'],
        'abstract': ['develop a method','develop a tool','develop a platform','develop a pipeline','develop an assay','develop a probe','develop an imaging','develop a screening','novel method','novel tool','novel assay','computational tool','publicly available','open-source','community resource','algorithm for','resource for researchers','research community','widely applicable','broadly applicable','generalizable method','transferable method','validate the assay','optimize the assay','high-throughput screen','screening platform','detection method','quantification method','measurement method','imaging approach','imaging technique','multiplexed','multiplex assay'],
    },
    'diagnostics': {
        'title': ['diagnostic','detection of','screening','biomarker panel','biomarker validation','companion diagnostic','point-of-care','point of care','liquid biopsy','early detection','clinical test','prognostic','precision screening','clinical assay','clinical detection','ctdna','cell-free dna','circulating tumor','blood-based test','blood test for','urine test','saliva test','breath test','rapid test','poc test','ivd','in vitro diagnostic'],
        'abstract': ['diagnostic','detection','screening test','biomarker panel','clinical validation','sensitivity and specificity','diagnostic accuracy','predictive value','clinical utility','point-of-care','companion diagnostic','clinical application','clinical use','patient stratification','risk stratification','prognostic marker','predictive marker','diagnostic marker','clinical assay','clinical test','fda clearance','fda approval','clia','clinical laboratory','reference range','cutoff value','receiver operating','roc curve','auc of','positive predictive','negative predictive'],
    },
    'medical_device': {
        'title': ['device','implant','prosthesis','prosthetic','stent','catheter','wearable sensor','brain-computer interface','brain computer interface','neural interface','cochlear implant','tissue engineer','scaffold','bioprinting','3d printing','biomaterial','implantable','electrode','microelectrode','robotic','exoskeleton','visual prosthesis','intracortical visual','neurostimulat','neuromodulation','deep brain stimulat','vascular graft','lvad','left ventricular assist','thin-film electrode','hearing aid','bandage','stereovision','surgical guidance'],
        'abstract': ['device','implant','prosthesis','electrode array','tissue engineer','scaffold','biomaterial','wearable','brain-computer interface','neural probe','silicon probe','neuromodulation','neurostimulation','deep brain stimulation'],
    },
    'digital_health': {
        'title': ['mobile app','mhealth','telehealth','telemedicine','digital health','digital therapeutic','digital intervention','ehr','electronic health record','clinical decision support','remote monitoring','smartphone','web-based intervention','text message','app-based','e-health','web-intervention'],
        'abstract': ['mobile health','mhealth','telehealth','telemedicine','digital health','digital intervention','electronic health record','clinical decision support','remote monitoring','smartphone'],
    },
    'other': {
        'title': ['health disparit','health equity','community-based','community based','implementation','dissemination','health services','health policy','epidemiolog','cohort study','longitudinal study','population-based','behavioral intervention','psychosocial','mindfulness','cognitive behavioral therapy','motivational interviewing','smoking cessation','weight management','lifestyle','environmental health','occupational','environmental exposure','food safety','nutrition intervention','diet intervention','social determinant','health literacy','qualitative','cost-effectiveness','cost effectiveness','racial/ethnic','racial disparit','social network','caregiver','wellbeing','well-being','prevention intervention','violence prevention','physical activity','exercise intervention','peer-led','peer led'],
        'abstract': ['health disparit','health equity','implementation science','dissemination','health services','epidemiolog','cohort study','longitudinal','population-based','behavioral intervention','psychosocial','mindfulness','community-based','community health','cost-effectiveness','qualitative','social determinant'],
    },
}

def classify_org(org_name, activity_code):
    org = (org_name or '').upper().strip()
    if activity_code in SBIR_STTR_CODES: return 'company'
    if any(kw in org for kw in [' LLC','INC.','INC,',', INC',' CORP','CORPORATION','THERAPEUTICS','BIOSCIENCES','PHARMACEUTICALS','BIOTECH','PHARMA ','BIOPHARMA',' LTD']): return 'company'
    if any(kw in org for kw in ['SCRIPPS','BROAD INSTITUTE','SALK','FRED HUTCH','SLOAN KETTERING','MEMORIAL SLOAN','DANA-FARBER','DANA FARBER','COLD SPRING HARBOR','JACKSON LAB','WISTAR','ALLEN INSTITUTE','STOWERS','WHITEHEAD','VAN ANDEL','RESEARCH TRIANGLE','LA JOLLA INST','PENNINGTON BIOMEDICAL',"ST. JUDE CHILDREN'S RESEARCH",'HUDSON ALPHA','MORGRIDGE','CARNEGIE INST','GLADSTONE','WOODS HOLE','BENAROYA','SANFORD BURNHAM','BURNHAM PREBYS','BECKMAN RESEARCH','NATIONAL JEWISH','NEW ENGLAND RESEARCH','SAN DIEGO BIOMEDICAL','LAUREATE INSTITUTE','JAEB CENTER','RESEARCH INST NATIONWIDE','RAND CORPORATION','AMERICAN FEDERATION','WHITMAN-WALKER','BATTELLE']): return 'research_institute'
    if any(kw in org for kw in ['UNIVERSITY','UNIV ','COLLEGE','SCHOOL OF MEDICINE','INSTITUTE OF TECHNOLOGY','POLYTECHNIC','ICAHN SCHOOL','JOHNS HOPKINS','STANFORD','YALE','HARVARD','PRINCETON','CORNELL','DUKE','EMORY','CALTECH','BAYLOR COLLEGE','ALBERT EINSTEIN','MEDICAL COLLEGE','MEDICAL SCHOOL','UNIFORMED SERVICES','MEHARRY','TUFTS','ROCKEFELLER','CARNEGIE-MELLON','MOREHOUSE SCHOOL','NORTHEAST OHIO MEDICAL']): return 'university'
    if any(kw in org for kw in ['HOSPITAL','MEDICAL CENTER','MED CTR','HEALTH SYSTEM','CLINIC','HEALTH CENTER',"CHILDREN'S",'MAYO ','CEDARS-SINAI','KAISER','BRIGHAM','MASS GENERAL','MOUNT SINAI','METHODIST','BETH ISRAEL','BANNER HEALTH','MCLEAN','BOSTON CHILDREN','SEATTLE CHILDREN','CINCINNATI CHILDRENS','RUSH UNIVERSITY MEDICAL']): return 'hospital'
    if any(kw in org for kw in ['VETERANS','VA ','DEPARTMENT OF']): return 'other'
    return 'other'

def is_core_project(title):
    t = title.lower()
    for cp in CORE_INDICATORS:
        if cp in t: return True
    if re.search(r'\bcore[-\s]?\d*$', t): return True
    if t.strip().endswith(' core'): return True
    return False

def score_categories(title, abstract, phr):
    t, a = title.lower(), abstract.lower()
    full = t + ' ' + a + ' ' + (phr or '').lower()
    scores = {}
    for cat, signals in CATEGORY_SIGNALS.items():
        score = 0
        for kw in signals.get('title', []):
            if kw in t: score += 15
        for kw in signals.get('abstract', []):
            if kw in a: score += 4
        scores[cat] = score
    if re.search(r'phase\s+[i1234]+[/\\]?[i1234]*', t): scores['therapeutics'] += 25
    if 'clinical trial' in t: scores['therapeutics'] += 20
    if 'placebo' in a and 'randomiz' in a: scores['therapeutics'] += 15
    if re.search(r'phase\s+[i1234]+[/\\]?[i1234]*\s*(trial|study|clinical)', a): scores['therapeutics'] += 12
    if any(kw in t for kw in ['trial', 'treatment of', 'therapy for']): scores['therapeutics'] += 10
    if re.search(r'develop(ment|ing)?\s+(of\s+)?(a\s+)?(novel\s+)?(high[- ]throughput|computational|imaging|new|advanced)', t): scores['biotools'] += 10
    # Stronger assay/platform development signals
    if re.search(r'develop(ment|ing)?\s+(of\s+)?(a\s+|an\s+)?(novel\s+)?assay', full): scores['biotools'] += 15
    if re.search(r'develop(ment|ing)?\s+(of\s+)?(a\s+)?(novel\s+)?platform', full): scores['biotools'] += 12
    if re.search(r'develop(ment|ing)?\s+(of\s+)?(a\s+)?(novel\s+)?method', full): scores['biotools'] += 10
    if 'assay development' in t or 'platform development' in t: scores['biotools'] += 20
    # Clinical assay vs research assay distinction
    clinical_context = any(kw in full for kw in ['clinical use','clinical application','patient','clinical validation','diagnostic','point-of-care','companion diagnostic','clinical utility','clinical test'])
    if clinical_context and ('assay' in t or 'test' in t or 'detection' in t):
        scores['diagnostics'] += 15
    # USES vs DEVELOPS detection - penalize biotools if just using methods
    uses_signals = ['using','we use','we will use','we employ','employing','we applied','applying','we utilized','utilizing']
    if any(sig in a[:500] for sig in uses_signals) and not any(dev in full for dev in ['develop','create','build','design','engineer','optimize','improve','validate','novel']):
        scores['biotools'] = max(0, scores['biotools'] - 10)
    behavioral_kw = ['behavioral intervention','psychotherapy','cognitive behavioral therapy','cbt','mindfulness intervention','motivational interviewing','lifestyle intervention','exercise intervention','physical activity intervention','counseling','family-based treatment','parent-based intervention']
    drug_kw = ['drug','medication','pharmacotherapy','pharmacological','pharmaceutical','compound','inhibitor','vaccine','antiviral','antibiotic']
    is_behavioral = any(kw in full for kw in behavioral_kw)
    has_drug = any(kw in full for kw in drug_kw)
    if is_behavioral and not has_drug:
        scores['other'] += 15; scores['therapeutics'] = max(0, scores['therapeutics'] - 10)
    elif is_behavioral and has_drug: scores['therapeutics'] += 10
    return scores

def classify_project(row):
    app_id = row['application_id']
    title = (row.get('title') or '').strip()
    org_name = (row.get('org_name') or '').strip()
    activity_code = (row.get('activity_code') or '').strip()
    abstract = (row.get('abstract') or '').strip()
    phr = (row.get('phr') or '').strip()
    org_type = classify_org(org_name, activity_code)
    t_lower, a_lower = title.lower(), abstract.lower()
    full = (title + ' ' + abstract + ' ' + phr).lower()
    is_sbir = activity_code in SBIR_STTR_CODES
    if activity_code in TRAINING_CODES: return app_id, 'training', 95, '', org_type, 'OK'
    if activity_code in INFRASTRUCTURE_CODES: return app_id, 'infrastructure', 95, '', org_type, 'OK'
    if activity_code in MULTI_COMPONENT_CODES:
        if is_core_project(title):
            if any(w in t_lower for w in ['mentor','career','training']): return app_id, 'training', 85, '', org_type, 'OK'
            return app_id, 'infrastructure', 82, '', org_type, 'OK'
    if activity_code in {'U45','UH4'}: return app_id, 'training', 85, '', org_type, 'OK'
    if activity_code == 'U2F': return app_id, 'other', 85, '', org_type, 'OK'
    if activity_code == 'UC7': return app_id, 'infrastructure', 85, '', org_type, 'OK'
    if activity_code == 'UG1':
        if any(w in full for w in ['network','coordinating center','cooperative group','investigator group']): return app_id, 'infrastructure', 80, '', org_type, 'OK'
    if 'seer' in t_lower: return app_id, 'infrastructure', 85, '', org_type, 'OK'
    if len(abstract) < 50:
        if re.search(r'phase\s+[i1234]', t_lower): return app_id, 'therapeutics', 70, '', org_type, 'REVIEW'
        return app_id, 'other', 0, '', org_type, 'REVIEW'
    scores = score_categories(title, abstract, phr)
    if is_sbir: scores['basic_research'] = 0
    if activity_code == 'P40': scores['biotools'] += 40
    if activity_code == 'R24': scores['biotools'] += 20
    ranked = sorted(scores.items(), key=lambda x: -x[1])
    best_cat, best_score = ranked[0]
    second_cat, second_score = ranked[1]
    if best_score == 0:
        if 'trial' in t_lower or 'trial' in a_lower[:300]: best_cat, best_score = 'therapeutics', 15
        elif is_sbir: best_cat, best_score = 'biotools', 10
        else: best_cat, best_score = 'basic_research', 10
    if best_score >= 80: conf = 95
    elif best_score >= 60: conf = 90
    elif best_score >= 45: conf = 85
    elif best_score >= 30: conf = 80
    elif best_score >= 20: conf = 75
    elif best_score >= 10: conf = 68
    else: conf = 60
    secondary = second_cat if (second_score > 0 and second_score >= best_score * 0.45) else ''
    margin = best_score - second_score
    # VERY conservative OK threshold - only skip review when we're essentially certain
    flag = 'OK' if (conf >= 90 and margin >= 30 and best_score >= 60) else 'REVIEW'
    return app_id, best_cat, conf, secondary, org_type, flag

def process_batch(input_path, output_path):
    with open(input_path, 'r', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    results = [classify_project(row) for row in rows]
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        f.write('application_id,primary_category,category_confidence,secondary_category,org_type,review_flag\n')
        for r in results:
            f.write(f'{r[0]},{r[1]},{r[2]},{r[3]},{r[4]},{r[5]}\n')
    return results

def main():
    if len(sys.argv) < 2:
        print("Usage: python nih_grant_classifier.py <input.csv> [output.csv]")
        sys.exit(1)
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else input_path.replace('.csv', '_firstpass.csv')
    results = process_batch(input_path, output_path)
    total = len(results)
    ok_count = sum(1 for r in results if r[5] == 'OK')
    review_count = sum(1 for r in results if r[5] == 'REVIEW')
    cats = Counter(r[1] for r in results)
    print(f'Processed {total}: {ok_count} OK, {review_count} REVIEW')
    print(f'Categories: {sorted(cats.items(), key=lambda x: -x[1])}')

if __name__ == '__main__':
    main()
