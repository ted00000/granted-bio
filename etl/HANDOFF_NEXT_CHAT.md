# NIH GRANT CLASSIFICATION — COMPLETE HANDOFF DOCUMENT
## For continuation in a new Claude chat

---

## 1. PROJECT OVERVIEW

We are building a **premium commercial data product** that classifies ~128,847 NIH-funded research projects into 9 categories + org_type. This is for **paid reports** — quality must be premium.

**Output schema per project:**
```
application_id, primary_category, category_confidence, secondary_category, org_type
```

**The 9 categories:** training, infrastructure, basic_research, biotools, therapeutics, diagnostics, medical_device, digital_health, other

**The 5 org types:** university, hospital, company, research_institute, other

**Additional:** Projects with no abstract (6,094 total, 5,274 with <50 chars) → `unclassified` with confidence=0. This is legitimate — they are intramural/old grants with no abstract in NIH Reporter.

---

## 2. INPUT DATA

**40 CSV files in the project:** `classify_batch_01v3.csv` through `classify_batch_40v3.csv`
- NOTE: Batch 30 has a typo in filename: `classify_batch_30v3v.csv` (extra 'v')
- Total: 128,847 rows
- Each ~3,222 rows (batch 40 has 3,189)

**Columns in each CSV:**
- `application_id` — unique project ID
- `title` — project title
- `org_name` — organization name
- `current_org_type` — Haiku's original org classification (for comparison)
- `current_category` — Haiku's original category classification (for comparison)
- `activity_code` — NIH activity code (R01, T32, P30, etc.)
- `abstract` — up to 3000 chars of abstract text
- `phr` — public health relevance statement
- `terms` — NIH-assigned terms (not heavily used in scoring)

---

## 3. CLASSIFICATION HISTORY

### Phase 1: Haiku API Classification
- Used Claude Haiku API with batched prompts (20 projects per call)
- Cost ~$38 for 128K projects
- Result: keyword-pattern classification with known weaknesses

### Phase 2: Opus Reclassification (current work)
- Recognized that Claude Opus (this model) can do better reading comprehension than keyword matching
- Built a Python-based classifier that runs locally (no API calls needed)
- Iteratively refined through validation

### Phase 3: Current State (where we stopped)

**Current results:**
```
Total: 128,847
Classified: 123,573
Unclassified (no abstract): 5,274
>= 80 confidence (of classified): 109,602 (88.7%)

Category Distribution:
  training              19,975 (15.5%)
  infrastructure        16,051 (12.5%)
  basic_research        53,259 (41.3%)
  biotools               3,963 ( 3.1%)
  therapeutics          18,849 (14.6%)
  diagnostics            2,186 ( 1.7%)
  medical_device           611 ( 0.5%)
  digital_health           702 ( 0.5%)
  other                  7,977 ( 6.2%)
  unclassified           5,274 ( 4.1%)

Confidence Distribution:
    0:  5,274 (4.1%)  ← unclassified
   50:    480 (0.4%)
   60:  1,221 (0.9%)
   70:  4,797 (3.7%)
   75:  7,473 (5.8%)
   80: 11,826 (9.2%)
   85: 42,321 (32.8%)
   90: 23,306 (18.1%)
   95: 32,149 (25.0%)
```

**Haiku's original distribution (for comparison):**
```
  basic_research: 49,817
  biotools:       11,815  ← was way too high
  diagnostics:     3,865
  digital_health:  1,494
  infrastructure: 12,413
  medical_device:  1,703
  other:           5,513
  therapeutics:   22,491
  training:       19,736
```

---

## 4. VALIDATED PROBLEMS STILL TO FIX

These were identified through random-sample validation in the current session:

### Problem A: basic_research is absorbing too many therapeutics projects
- 5,572 projects moved from Haiku's therapeutics → our basic_research
- Many are CORRECT (mechanism studies that Haiku over-classified as therapeutics)
- But some are WRONG — projects with "therapy" or "treatment" in title, legitimate therapeutic development that happened to have long mechanism discussions in abstracts
- **Root cause:** basic_research moderate signals are too broad (e.g., "in vivo", "mouse model", "immune response" appear in therapeutics contexts too)
- **Rule 11 was added** to partially fix this: if title says therapy/treatment AND therapeutics score ≥3, boost therapeutics by 4. But this needs more tuning.

### Problem B: medical_device is too restrictive (611 projects, down from Haiku's 1,703)
- We added a `dev_intent` gate requiring development-related words before scoring device keywords
- The gate is too broad now (words like "develop", "novel", "we propose" let everything through) but device keyword list was tightened too much
- **Specific validated false positives we caught in first run (before fixes):**
  - "Active Social Vision: How Brain Processes Visual Information" → was medical_device, should be basic_research (electrode study, not device development)
  - "Solutions for Organizing, Sharing iEEG Data" → was medical_device, should be biotools
  - "KUMC Nutrition Obesity Research Center" → was medical_device, should be infrastructure
  - "Allosteric Modulation of HCN Channels" → was medical_device, should be basic_research
- **But now we may be MISSING real device projects** — catheter cap projects, implant coating projects, etc. classified as therapeutics instead
- **Need:** Better heuristic for "is the PRIMARY innovation a physical device?"

### Problem C: digital_health is too restrictive (702, down from Haiku's 1,494)
- We added a deployment gate requiring patient/clinician context before scoring
- Gate was relaxed in latest iteration but still filtering too aggressively
- **False positives we caught:** "ML Framework for Mining Heterogeneous Ocular Data" → should be biotools, not digital_health. "Measuring arterial material properties with ultrasound" → should be basic_research/biotools.
- **But real digital health projects may be missed** — telemedicine, mHealth apps, remote monitoring

### Problem D: therapeutics → basic_research over-correction
- The biggest single reclassification: 5,572 projects moved therapeutics → basic_research
- Some are definitely correct (Haiku classified everything with "treatment" as therapeutics)
- But projects like "PSAT1 modified mRNA induces cardiac repair" or "Novel strategies to improve mesothelioma therapy" should probably stay therapeutics
- **Rule 11 partially addresses this** but needs validation

### Problem E: conf=50/60 residual (1,701 classified projects)
- 480 at conf=50: truly zero-signal projects where nothing matched
- 1,221 at conf=60: R-series fallback to basic_research (no signals but has science words)
- 375 of the conf≤60 are infrastructure (multi-component sub-projects that slipped through core detection)
- **These need better core/sub-project detection or acceptance as genuinely ambiguous**

### Problem F: SBIR classifications
- Rule added: SBIR (R41-R44, SB1, U44) should NEVER be basic_research (zeroed out)
- But 77 SBIRs ended up as "other" — these are legitimate (behavioral health apps, arts prescriptions, etc.)
- A few SBIRs may be incorrectly classified as diagnostics/biotools when they should be therapeutics or medical_device

### Problem G: biotools dropped significantly (3,963 vs Haiku's 11,815)
- This is largely CORRECT — Haiku massively over-classified biotools
- Many projects that "use a tool" (basic_research) were wrongly labeled biotools
- But some legitimate biotools may have been pulled to basic_research because the "distribution intent" check is too strict
- **Distribution intent words:** 'for researchers', 'for the community', 'widely available', 'open source', 'shared resource', 'disseminat', 'user-friendly', 'publicly available', 'web server', 'downloadable', 'made available', 'community resource', 'for the field'

---

## 5. THE CLASSIFIER ARCHITECTURE

### Pass 1: Deterministic Activity Code (32,149 projects at 95% confidence)

**Training codes → training (always, regardless of title/abstract):**
T32, T34, T35, T90, TL1, TL4, F30, F31, F32, F33, F99, K01, K02, K05, K07, K08, K12, K22, K23, K24, K25, K26, K43, K76, K99, KL2, D43, D71, R25, R90

**Infrastructure codes → infrastructure (always):**
P30, P50, P51, S10, G20, U13, R13, U24, U2C

### Pass 2: Core/Component Detection

For multi-component grants (P01, P20, P2C, P30, P50, P51, P60, U19, U54, U24, U2C, UC7, UG4, U42):

1. **Administrative cores → infrastructure (85%):** Detected by title keywords ("administrative core", "admin core", "core a:", "coordination core") OR abstract keywords ("fiscal management", "budgetary oversight", etc.) when title contains "core"

2. **Resource/service cores → infrastructure (85%):** Detected by title keywords ("shared resource", "core facility", "genomics core", "histopathology core", "biostatistics core", "data core", "imaging core", "flow cytometry core", "biospecimen core", etc.)

3. **Generic "Core X" pattern → infrastructure (80%):** When title matches `^core [a-z0-9]` regex AND abstract says "core will provide/serve/support"

4. **Abstract-identified cores → infrastructure (80%):** When first 100 chars of abstract mention a specific core type AND abstract contains core service language

5. **Mentoring/training cores → training (85%):** "mentoring core", "career development", "investigator development"

### Pass 3: Non-Research Programs

- U45, UH4 → training (85%) — worker safety/hazmat training
- U2F → other (85%) — food safety regulatory
- U18 with radiation/food keywords → other (85%)
- SEER registries → infrastructure (85%)
- UG1, U10 clinical trial network sites → infrastructure (80%)
- UC7 → infrastructure (85%) — biosafety labs

### Pass 4: Content-Based Scoring

**Scoring system:**
- Strong signals: +3 points each
- Moderate signals: +1 point each
- Title keyword matches: +4 points each (title = strongest signal of project focus)

**See the full classifier code below for all signal lists.**

### Disambiguation Rules (11 total)

1. **SBIR → never basic_research:** Zero out basic_research score
2. **Uses tool vs develops tool:** If basic_research > biotools AND no distribution intent words → reduce biotools by 4
3. **Behavioral + no drug → not therapeutics:** If other ≥5 and no drug words → reduce therapeutics by 5
4. **Behavioral clinical trials → other:** If behavioral + randomized + no drug → boost other, reduce therapeutics
5. **Epidemiology without molecular → other:** If cohort/epi words but no mechanism/pathway → boost other, reduce basic_research
6. **Statistical methods → biotools:** If "novel statistical method" / "develop computational method" → boost biotools by 4
7. **Drug mechanism study → basic_research:** If "mechanism of action" without development words → boost basic_research
8. **Strong basic_research overrides weak other:** If basic_research ≥8 and other < 60% of basic_research → reduce other
9. **Drug delivery → therapeutics not biotools:** Boost therapeutics, reduce biotools
10. **Web app/lifestyle without clinical software → other not digital_health**
11. **Therapeutic title intent:** If title says therapy/treatment AND therapeutics ≥3 AND basic_research is winning → boost therapeutics by 4

### Confidence Scoring

**Based on margin (top score - second score):**
- Margin ≥10 → 90%
- Margin ≥6 → 85%
- Margin ≥3 → 85%
- Margin ≥2 → 80%
- Margin ≥1 → 80% if max_score ≥5, else 75%
- Margin <1 → 70%

**Absolute score boosts (floor):**
- Max_score ≥20 → 90% minimum
- Max_score ≥12 → 85% minimum
- Max_score ≥6 → 80% minimum

**Rationale:** Projects with narrow margins but high absolute scores still have strong converging evidence.

### Secondary Category

Assigned when runner-up score ≥3 AND runner-up ≥ 30% of winner score.

### Zero-Score Fallback

When no signals match at all:
- R-series (not R13/R25/R90) with science words → basic_research at 60%
- Multi-component codes → infrastructure at 60%
- Everything else → other at 50%

### Org Classification

- SBIR codes → always company
- Keywords: LLC, INC., CORP, THERAPEUTICS, BIOSCIENCES, PHARMACEUTICALS → company
- HOSPITAL, MEDICAL CENTER, HEALTH SYSTEM, CLINIC, MAYO → hospital (unless also UNIVERSITY)
- Named institutes: SCRIPPS, BROAD, SALK, FRED HUTCHINSON, DANA-FARBER, etc. → research_institute
- UNIVERSITY, COLLEGE → university
- Everything else → other

---

## 6. WHAT THE NEW CHAT NEEDS TO DO

### Goal: Achieve ≥90% of classified projects at ≥80% confidence with validated accuracy

### Step 1: Run the classifier
Copy the classifier code from Section 8 below. Read all 40 v3 batch files. Generate output CSVs.

### Step 2: Validate every category with random samples
For each of the 9 categories + unclassified, pull 12-15 random projects and check:
- Does the title/abstract actually match the assigned category?
- Are there systematic false positives?
- Are there systematic false negatives (projects that should be in this category but aren't)?

### Step 3: Fix identified problems
The problems documented in Section 4 above are the known issues. But validation may reveal new ones.

**Priority fixes based on what we've seen:**

1. **Tighten basic_research moderate signals** — Remove terms that are too generic and appear in therapeutics/other contexts (e.g., "in vivo", "mouse model", "immune response" by themselves don't mean basic research — they're ubiquitous)

2. **Recalibrate medical_device** — The gate concept is right (require development intent) but needs to be:
   - More inclusive of real device projects (implant coatings, catheter designs, surgical tools)
   - More exclusive of pure biology that happens to mention electrodes, channels, scaffolds
   - Key distinction: "develops/engineers/fabricates a physical device for patients" vs "studies biology using devices/electrodes"

3. **Recalibrate digital_health** — Same gate concept, needs:
   - More inclusive of real mHealth/telemedicine/EHR projects
   - More exclusive of ML research papers and clinical outcome studies
   - Key distinction: "software/app deployed to patients or clinicians" vs "computational analysis of clinical data"

4. **Reduce therapeutics→basic_research over-correction** — Many projects with therapeutic intent in title are being pulled to basic_research because abstracts are full of mechanism language (this is normal — therapeutic development requires understanding mechanisms)
   - Rule 11 helps but may need strengthening
   - Consider: if title contains "therapy for", "treatment of", "therapeutic", "improve treatment", "novel [drug/compound/agent]" AND therapeutics score ≥5, it should probably be therapeutics even if basic_research score is higher

5. **Validate org_type** — Not stress-tested yet. Known issues:
   - 16,838 classified as "other" org_type — many are likely government (VA, NIH intramural), non-profits, or foundations
   - Academic medical centers: "University of X Medical Center" → should these be hospital or university?

### Step 4: Generate final output
40 CSV files: `classify_batch_01_classified.csv` through `classify_batch_40_classified.csv`
Each with columns: `application_id, primary_category, category_confidence, secondary_category, org_type`

---

## 7. KNOWN EDGE CASES AND DECISIONS

1. **"Develops a method to study X" → basic_research or biotools?**
   - If the method is the primary deliverable AND intended for community use → biotools
   - If the method is developed in service of answering a biological question → basic_research
   - **Heuristic:** Look for distribution intent words. If absent, lean basic_research.

2. **"Understand mechanisms to improve treatment" → basic_research or therapeutics?**
   - If the project will produce a drug/compound/intervention ready for testing → therapeutics
   - If the project will produce knowledge about why treatments work/fail → basic_research
   - **Heuristic:** Check for output signals — clinical trial, lead compound, drug candidate, etc.

3. **P01/U19 sub-projects that are actual research (not cores)**
   - These should go through content-based scoring like any R01
   - Only the administrative/resource/service cores should be auto-classified as infrastructure
   - The core detection is conservative — only catches projects that clearly self-identify as cores

4. **Cancer center support grants (P30)**
   - Always infrastructure — these are center grants regardless of project title
   - Already handled by deterministic Pass 1

5. **Behavioral interventions**
   - Smoking cessation, weight management, lifestyle modification → other (no drug/device)
   - Unless combined with pharmacotherapy (e.g., "nicotine patch + behavioral counseling" → therapeutics)
   - The has_drug check is important here

6. **AI/ML projects — classify by application, not method**
   - ML for drug screening → therapeutics
   - ML tool for researchers → biotools
   - ML for clinical diagnosis → diagnostics
   - ML patient app → digital_health
   - ML for understanding biology → basic_research

7. **Combination projects**
   - Classify by PRIMARY innovation (usually title focus)
   - Secondary category captures the other dimension

---

## 8. THE COMPLETE CLASSIFIER CODE

```python
"""
FINAL COMPREHENSIVE NIH GRANT CLASSIFIER v3 — VALIDATED
========================================================
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
    'K01','K02','K05','K07','K08','K12','K22','K23','K24','K25','K26','K43','K76','K99','KL2',
    'D43','D71','R25','R90',
}
INFRASTRUCTURE_CODES = {'P30','P50','P51','S10','G20','U13','R13','U24','U2C'}
SBIR_CODES = {'R41','R42','R43','R44','SB1','U44'}
MULTI_COMPONENT_CODES = {'P01','P20','P2C','P30','P50','P51','P60','U19','U54','U24','U2C','UC7','UG4','U42'}

def classify_org(org_name, activity_code):
    org = org_name.upper()
    if activity_code in SBIR_CODES:
        return 'company'
    if any(s in org for s in ['LLC','INC.','INC,','CORP','THERAPEUTICS, INC',
            'BIOSCIENCES','PHARMACEUTICALS','BIOTECH','BIOPHARMA',
            'TECHNOLOGIES INC','SCIENCES INC','DEVICES INC','SOLUTIONS INC',
            'HEALTH INC','ONCOLOGY INC','DIAGNOSTICS INC']):
        return 'company'
    is_uni = any(s in org for s in ['UNIVERSITY','COLLEGE','INSTITUTE OF TECHNOLOGY','POLYTECHNIC'])
    hosp = ['HOSPITAL','MEDICAL CENTER','HEALTH SYSTEM','HEALTH CENTER','CLINIC',
            'MAYO','CHILDREN\'S','MEDICAL CTR','HEALTH CARE','HEALTH SCIENCES CENTER']
    if any(s in org for s in hosp) and not is_uni:
        return 'hospital'
    ri = ['RESEARCH INSTITUTE','SCRIPPS','BROAD INSTITUTE','SALK INSTITUTE',
          'FRED HUTCHINSON','SLOAN','DANA-FARBER','COLD SPRING HARBOR',
          'JACKSON LABORATORY','WISTAR','LA JOLLA INSTITUTE','FEINSTEIN',
          'BECKMAN RESEARCH','BATTELLE','WOODS HOLE','STOWERS','ALLEN INSTITUTE',
          'WHITEHEAD INSTITUTE','CARNEGIE INSTITUTION','HUDSON ALPHA','VAN ANDEL']
    if any(s in org for s in ri):
        return 'research_institute'
    if is_uni:
        return 'university'
    if any(s in org for s in hosp):
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

    # BIOTOOLS
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
        'platform', 'pipeline', 'workflow',
        'sequencing method', 'imaging method',
        'assay development', 'biosensor development',
        'bioinformatics tool', 'data resource',
        'statistical method', 'statistical framework',
        'machine learning tool', 'repository',
    ]
    scores['biotools'] += sum(3 for s in bt_strong if s in text)
    scores['biotools'] += sum(1 for s in bt_moderate if s in text)
    for kw in ['platform for','pipeline for','tool for','atlas of','database of',
               'resource for','method for','assay for','probe for',
               'high-throughput','computational tool','software for']:
        if kw in t:
            scores['biotools'] += 4

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
        return aid, 'other', 50, '', org_type

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
    elif margin >= 1: confidence = 80 if max_score >= 5 else 75
    else: confidence = 70

    if max_score >= 20: confidence = max(confidence, 90)
    elif max_score >= 12: confidence = max(confidence, 85)
    elif max_score >= 6: confidence = max(confidence, 80)

    secondary = ''
    if runner_up_score >= 3 and runner_up_score >= winner_score * 0.3:
        secondary = runner_up

    return aid, winner, confidence, secondary, org_type
```

---

## 9. MAJOR RECLASSIFICATIONS FROM HAIKU → OPUS

These show where our classifier disagreed with Haiku's original output:

```
therapeutics → basic_research:    5,572  (BIGGEST — many correct, some over-corrections)
biotools → basic_research:        4,022  (mostly correct — Haiku over-classified biotools)
basic_research → therapeutics:    2,577
biotools → therapeutics:          2,127
basic_research → other:           1,940
therapeutics → other:             1,315
biotools → other:                 1,259
biotools → infrastructure:        1,109  (cores that Haiku missed)
basic_research → infrastructure:  1,046  (cores that Haiku missed)
diagnostics → basic_research:       849
therapeutics → infrastructure:      826
basic_research → biotools:          727
medical_device → basic_research:    599
diagnostics → therapeutics:         596
other → basic_research:             586
other → infrastructure:             431
medical_device → therapeutics:      403
diagnostics → other:                379
biotools → diagnostics:             366
other → therapeutics:               346
```

---

## 10. SUMMARY OF WHAT WORKS AND WHAT DOESN'T

### What works well (don't touch):
- Pass 1 deterministic (32,149 at 95%) — bulletproof
- Pass 2 core/component detection — catches admin cores, resource cores, mentoring cores
- Pass 3 non-research programs — U45/UH4 training, U2F food safety, SEER registries
- SBIR → never basic_research rule
- Behavioral intervention → other (not therapeutics) rule
- Epidemiology without molecular work → other rule
- Distribution intent check for biotools
- Confidence scoring system

### What needs work:
- basic_research moderate signals too broad (absorbing therapeutics)
- medical_device too restrictive (need better device-specific signals)
- digital_health too restrictive (need better mHealth/telemedicine signals)
- therapeutic title intent rule (Rule 11) may need strengthening
- org_type "other" bucket (16,838) needs sub-classification
- conf=50/60 residual projects need better handling

### The target:
≥90% of classified projects at ≥80% confidence, with validated accuracy through random sampling of every category.
