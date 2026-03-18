import re, json
from collections import Counter

def has(text, *patterns):
    t = text.lower()
    return any(p in t for p in patterns)

def is_core_title(title):
    """Returns True if the title identifies a shared resource/core/admin/center component."""
    t = title.lower().strip()
    # Any title with "core" as a whole word → infrastructure
    if re.search(r'\bcore\b', t):
        return True
    # Administrative patterns
    if re.match(r'^admin(istrative)?(\s|$|,)', t):
        return True
    # V2 FIX: Standalone facility patterns
    if re.search(r'\bfacility\b', t):
        return True
    if re.search(r'\bshared resource\b', t):
        return True
    # V2 FIX: Generic resource center (not just "national resource")
    if re.search(r'\bresource center\b', t):
        return True
    if re.search(r'\bresearch facility\b', t):
        return True
    # Research centers and specialized centers → infrastructure
    center_patterns = [
        r'\bresearch (center|programme?)\b',
        r'\bcancer (health disparity|disparit|equity|research) (research )?center\b',
        r'\bhealth disparity (research )?center\b',
        r'\bpilot center\b',
        r'\bc-pam\b',
        r'\bspecialized center\b',
        r'\bcenter of (research|excellence|biomedical)\b',
        r'\bcenter for (research|biomedical|precision|clinical|microbiology)\b',
        r'\bmicrobiology (research )?center\b',
        r'\bprecision animal modeling\b',
    ]
    for pat in center_patterns:
        if re.search(pat, t):
            return True
    # Other infrastructure patterns
    SPECIFIC = [
        r'\bcoordinating center\b', r'\bdata coordinating\b',
        r'\bclinical coordinating\b', r'\bnetwork operations\b',
        r'\brepository\b', r'\bbiobank\b', r'\btissue bank\b',
        r'\bspecimen bank\b', r'\bbiorepository\b', r'\bbiospecimen\b',
        r'\bnational (resource|center for)\b',
        r'\bprimate (resource|center)\b', r'\bspecific pathogen free\b',
        r'\bgenetics center\b', r'\bcaenorhabditis genetics\b',
        r'\binbre\b', r'\bnctn\b', r'\bswog\b', r'\bnetwork group operations\b',
        r'\blibrary of medicine\b',
        r'\bclinical site\b',
        r'\bpopulation research institute\b',
        r'\bclinical research support\b',
        r'\bcobre.*renovation\b', r'\brenovation\b.*\bcobre\b',
        r'\binvestigator development\b',
        r'\bdevelopmental research (program|project)\b',
        r'\bdevelopment(al)? research projects? program\b',
        r'\bdrpp?\b',
        r'\bpilot studies\b',
        r'\bpilot project\b',
    ]
    for pat in SPECIFIC:
        if re.search(pat, t):
            return True
    return False

def strip_project_prefix(title):
    return re.sub(r'^(project\s*[\-–]?\s*[\w\-]+\s*[:\-–\.]\s*)', '', title,
                  flags=re.IGNORECASE).strip()

def classify(g):
    code  = g['activity_code']
    title = g['title']
    tl    = title.lower()
    tl_s  = strip_project_prefix(tl)
    terms = g['terms'].lower() if g['terms'] != 'N/A' else ''
    phr   = g['phr'].lower()   if g['phr']   != 'N/A' else ''
    tp    = f"{tl} {phr}"
    full  = f"{tl} {terms} {phr}"

    # ── STEP 1: Activity-code pre-filter ─────────────────────────────────
    INFRA_CODES = {'P30','P41','P42','P50','P51','S10','G20','U13','R13','U24','U2C'}
    TRAIN_CODES = {'T32','T34','T35','T90','TL1','TL4',
                   'F30','F31','F32','F33','F99','D43','D71','R25','R90'}
    if code in INFRA_CODES:
        return 'infrastructure', 95, \
            f"Activity code {code} always maps to infrastructure per the pre-filter rule."
    if code in TRAIN_CODES or re.match(r'^K\d', code):
        return 'training', 95, \
            f"Activity code {code} always maps to training per the pre-filter rule."

    # ── STEP 1b: V2 FIX - P20/P01 center grants with core titles → infrastructure
    if code in {'P20', 'P01'} and is_core_title(tl):
        return 'infrastructure', 85, \
            f"P20/P01 center grant with core/resource/facility title: \"{title[:70]}\"."

    # ── STEP 2: Core / shared-resource / centers → infrastructure ─────────
    if is_core_title(tl):
        return 'infrastructure', 88, \
            f"Title identifies a core/center/shared-resource component: \"{title[:70]}\"."

    if code in {'P40','U42'}:
        return 'infrastructure', 90, \
            f"Activity code {code} funds animal research resource facilities."
    if code == 'UC7':
        return 'infrastructure', 90, "UC7 funds facility operations (infrastructure)."
    if code == 'UG4':
        return 'infrastructure', 88, "UG4 network administrative grant (infrastructure)."
    if code == 'U10':
        return 'infrastructure', 88, "U10 cooperative clinical research network (infrastructure)."
    if code == 'PL1':
        return 'infrastructure', 85, "PL1 linked clinical research network component (infrastructure)."

    # ── STEP 3: Determine strong basic-research title signals ─────────────
    # Patterns anchored to start of (stripped) title
    BASIC_LEAD_ANCHORED = [
        r'^mechanisms? (of|underlying|for)\b',
        r'^role of\b', r'^function(al)? (analysis|roles?|characteriz)',
        r'^characteriz', r'^biology of\b', r'^regulation of\b',
        r'^molecular basis', r'^cellular basis', r'^biochemical basis',
        r'^probing\b', r'^dissecting\b', r'^elucidating\b',
        r'^understanding\b', r'^investigating\b', r'^examining\b',
        r'^analysis of\b', r'^analyses of\b', r'^analyses on\b',
        r'^study of\b', r'^studies of\b',
        r'^longitudinal\b', r'^a longitudinal\b',
        r'^contributions? of\b',
        r'^sex.specific differences\b',
        r'^genetic (variation|basis|characteriz)\b',
        r'^impact of\b', r'^influence of\b', r'^consequences of\b',
        r'^dynamics of\b',
        r'^structural basis\b', r'^structural and (functional|genetic)\b',
        r'^harnessing\b',
        r'^interplay\b',
        r'^defining\b',       # "Defining the Mechanisms..."
        r'^modeling\b',       # "Modeling Shigella Interaction..."
    ]
    # Patterns that match anywhere in title (secondary)
    BASIC_SECONDARY = [
        r'\bregulation of\b',       # "PI3K Beta regulation of tumor metastasis"
        r'\bstructural basis\b',    # "Genetic and Structural Basis for..."
        r'\breconstitution\b',      # "Biochemical reconstitution and inhibition"
        r'\bmechanisms? of\b',
        r'\brole of\b',
    ]
    strong_basic_title = (
        any(re.search(p, tl)   for p in BASIC_LEAD_ANCHORED) or
        any(re.search(p, tl_s) for p in BASIC_LEAD_ANCHORED) or
        any(re.search(p, tl)   for p in BASIC_SECONDARY) or
        any(re.search(p, tl_s) for p in BASIC_SECONDARY)
    )

    # Override: "identifying disparities / inequities" → NOT basic_research
    if re.search(r'\b(disparit|inequit|identifying disparit)', tl):
        strong_basic_title = False

    # ── STEP 4: TRAINING (title+phr only) ─────────────────────────────────
    if has(tp,
           'training program','career development','postdoctoral training',
           'predoctoral training','mentorship program','peer mentorship',
           'scholar program','fellowship award',
           'administrative, mentoring and education',
           'education outreach','community engagement core',
           'education and community engagement',
           'education core','outreach and education',
           'training and education program',    # "TRAINING AND EDUCATION PROGRAM" in PHR
           'education program',                  # "Cancer research education program"
           'research education program',
           ):
        return 'training', 80, \
            "Title/PHR describes a researcher training, mentorship, or education program."

    # ── STEP 5: EARLY BASIC RESEARCH (strong title, no PHR context needed) ─
    if strong_basic_title and phr == '':
        not_product_title = not has(tl,'drug','gene therapy','cell therapy',
                                     'vaccine candidate','inhibitor','targeting ')
        if not_product_title:
            return 'basic_research', 78, \
                "Title clearly describes a mechanistic/characterization study (no PHR); output is scientific knowledge."

    # ── STEP 6: DIGITAL HEALTH ───────────────────────────────────────────
    dh_title = has(tl, 'telehealth','telemedicine','mhealth',
                   'just-in-time adaptive','jitai',
                   'remote patient monitoring','patient portal',
                   ' ehr ','patient-facing app',
                   'digital health intervention','mobile health intervention',
                   'mobile integrated care','telehealth intervention',
                   'telesimulation','telesim program')
    dh_phr = has(phr,'telehealth','telemedicine','remote patient monitoring',
                 'electronic health record','mhealth app','patient portal',
                 'mobile integrated care')
    patient_clinical = has(full,'patient','clinician','clinical care','health care delivery')
    not_research_tool = not has(full,'research platform','research tool','research use')
    if (dh_title or dh_phr) and patient_clinical and not_research_tool:
        return 'digital_health', 82, \
            "Project develops clinical digital tools or telemedicine for patient care delivery."

    # ── STEP 7: DIAGNOSTICS ──────────────────────────────────────────────
    diag_title = has(tl,
        'point-of-care','point of care',
        'rapid diagnostic','rapid test','lateral flow',
        'early detection of ','clinical detection','disease detection',
        'diagnostic test','diagnostic platform','novel diagnostic',
        'clinical screening test','screening assay',
        'screening tool for','detection tool',
        'detection and tracking',
        'for the detection of',
        'electrochemical sensor',
    )
    diag_phr = has(phr,
        'diagnostic test','point-of-care','novel diagnostic',
        'fda clearance','fda approval','510(k)',
        'clinical sensitivity','clinical specificity',
        'develop a test','develop a diagnostic','diagnostic accuracy',
        'clinical detection','detect disease')
    if diag_title or diag_phr:
        return 'diagnostics', 80, \
            "Project develops a clinical diagnostic test or detection method for patients."
    if has(tl,'biomarker') and has(phr,'clinical','diagnos','detect','screen') \
            and has(phr,'develop','novel','test','assay'):
        return 'diagnostics', 72, \
            "Project develops a clinical biomarker-based diagnostic test."

    # ── STEP 8: MEDICAL DEVICE ───────────────────────────────────────────
    not_care_disparity = not re.search(r'\b(disparit|inequit|identifying|care of)\b', tl)
    if not_care_disparity and has(tl,'implant','prosthetic','medical device',
           'wearable device','neural stimulat','deep brain stimulat','cochlear',
           'retinal prosth','orthotics','exoskeleton') \
            and has(full,'patient','clinical','treatment'):
        return 'medical_device', 80, \
            "Project develops a physical medical device for patient treatment."

    # ── STEP 9: THERAPEUTICS ─────────────────────────────────────────────
    VERY_STRONG_THER = [
        'gene therapy', 'cell therapy', 'car-t', 'car t-cell',
        'oncolytic viro', 'mrna vaccine', 'mrna immunogen',
        'mrna-based immunogen', 'vaccine candidate', 'vaccine development',
        'phase i trial', 'phase ii trial', 'phase iii trial',
        'phase 1 trial', 'phase 2 trial', 'phase 3 trial',
        'clinical trial for', 'first-in-human',
        'pk/pd model', 'intranasal delivery', 'drug delivery system',
        'radioprotect', 'radiosensitiz',
        'therapeutic nanoparticle', 'immunotherapeutic nanoparticle',
        'cryopreservation', 'nanowarming',
        'immunogen for protective',
        'antibiotic-sparing strateg',
    ]
    very_strong_ther = any(p in tl for p in VERY_STRONG_THER)

    # Moderate title signals (require absence of strong basic signal)
    MOD_THER_TITLE = [
        r'\btargeting\b(?! the neural|\s+circui|\s+disparit|\s+inequit)',
        # "inhibition of" only in a clear therapeutic / cancer context
        r'\binhibition of\b(?=.*\b(tumor|cancer|viral|resistance|signaling|kinase|receptor|pathway|immune))',
        r'\binhibitor\b',
        r'\bblocking the binding\b',
        r'\bimmunotherap',
        r'\bmodulation of (anti-tumor|tolerance|autoimmun)',
        r'\bstrategies to (enhance|overcome)\b',
        r'\bovercoming resistance\b',
        r'\bovercome resistance\b',
        r'\bdeveloping immunotherapeutic\b',
        r'\badoptive t.?cell therap',
    ]
    mod_ther_title = any(re.search(p, tl) for p in MOD_THER_TITLE)

    behavioral = has(full,'behavioral intervention','behavior change',
                     'cognitive behavioral','psychotherapy','counseling',
                     'smoking cessation intervention','lifestyle intervention',
                     'motivational interview','mindfulness','dietary intervention',
                     'exercise intervention','physical activity intervention')

    # Active therapeutic development in PHR (strong signals only, no "clinical trial" alone)
    ther_phr_active = (
        has(phr, 'develop a novel therap','developing a drug','drug candidate',
            'lead compound','ind application','gene therapy','cell therapy',
            'vaccine efficacy','oncolytic','treatment of patients',
            'novel treatment','novel therapy','preclinical development',
            'first-in-human',
            'cancer chemotherapeutic leads',  # drug discovery grants
            'cancer chemotherapy') and
        not behavioral
    )

    not_ther = re.search(r'\b(hesitancy|vaccine hesitancy|vaccine uptake|vaccine coverage|vaccine acceptance)\b', tl)

    if not not_ther and not behavioral:
        if very_strong_ther:
            return 'therapeutics', 82, \
                "Project develops a therapeutic (gene therapy, clinical trial, drug delivery, etc.)."
        if mod_ther_title and not strong_basic_title:
            return 'therapeutics', 75, \
                "Project develops a targeted therapeutic or inhibitor for patients."
        if ther_phr_active and not strong_basic_title:
            return 'therapeutics', 75, \
                "PHR describes active development of a therapeutic agent or treatment strategy."

    # ── STEP 10: OTHER (title+phr+terms) ─────────────────────────────────
    # V2 FIX: Also check terms for behavioral/community patterns when PHR empty
    other_tp = has(tp,
        'behavioral intervention','behavior change intervention',
        'health services research','health policy',
        'implementation science','implementation research',
        'prevention program','preventive intervention','health promotion',
        'community-based intervention','community health intervention',
        'smoking cessation','tobacco cessation','tobacco use intervention',
        'nicotine delivery','nicotine product',
        'suicide prevention program','mental health intervention',
        'mental health program','mental health service',
        'obesity intervention','weight loss program',
        'dietary program',
        'exercise intervention','physical activity program',
        'vaccine hesitancy','vaccine uptake','vaccine coverage',
        'shellfish','community-driven food','shellfish consumption',
        'health equity program',
        'disparities in care','identifying disparities','disparit',
        'nursing home payment',
        'plan and provider behavior',
        'health care utilization','health care access',
        'aging in place','caregiver intervention',
        'family meal','stakeholder engagement.*patient',
        'alcohol use disorder treatment','substance use disorder treatment',
        'relapse prevention program','alcohol intervention program',
        'smoking intervention program','tobacco intervention program',
        'injury prevention program','opioid use disorder treatment',
        'addiction treatment program','digital media use',
        'media use pattern','technology use pattern',
        'hospice care for','hospice.*dementia',
        'medicare and beneficiar','medicare beneficiar',
        'medicaid continuous','implications of.*grouping model',
        'patient-driven grouping','home health care utilization',
        'effects of nursing home','nursing home.*payment',
        'administrative burdens','disparities in alzheimer',
        'double danger.*dementia','high-quality primary care.*alzheimer',
        'impact of medicaid',
    )
    # V2 FIX: Check terms for community/behavioral when PHR is empty
    other_terms = has(terms,
        'community health', 'behavioral intervention', 'health disparities',
        'health services', 'community intervention', 'social determinants',
        'health equity', 'prevention research', 'implementation science',
        'tobacco control', 'substance abuse', 'mental health services',
    )
    # Specific strong other signals from terms (very targeted)
    other_full_specific = has(full,
        'nursing home payment','plan and provider behavior',
        'medicare beneficiar','medicaid continuous coverage',
        'hospice care for community',
        'home health care utilization',
        'patient-driven grouping model',
    )
    if (other_tp or other_full_specific or (other_terms and phr == '')) and not very_strong_ther:
        return 'other', 75, \
            "Project involves behavioral intervention, epidemiology, health services, or prevention research."

    # ── STEP 11: STRONG BASIC RESEARCH (title signal) ────────────────────
    if strong_basic_title:
        return 'basic_research', 82, \
            "Title describes a mechanistic or characterization study; output is scientific knowledge."

    # ── STEP 12: BIOTOOLS ────────────────────────────────────────────────
    biotools_title = has(tl,
        'platform development','method development','tool development',
        'assay development','technology development',
        'novel sequencing','sequencing method',
        'imaging method','imaging platform','imaging system for',
        'screening platform','computational tool',
        'algorithm development','algorithm for',
        'biophysical imaging',
        'high-throughput','high throughput',
        'novel assay','novel platform','novel method','novel tool',
        'emerging technologies for',
        'ultrafast','dynamic contrast','optical coherence tomography',
        'tools to probe', 'novel tools to',
        'deep learning method','application of deep learning',
        'bsl2 system','bsl-2 system',
    )
    biotools_phr = has(phr,
        'develop a novel tool','develop a platform','develop an assay',
        'develop a method','develop an algorithm','develop a new method',
        'novel tool for researchers','tool for the research community',
        'high-throughput screen','enable researchers')

    if biotools_title:
        return 'biotools', 75, \
            "Project develops a research tool, method, or platform for use by scientists."
    if biotools_phr and not strong_basic_title:
        return 'biotools', 70, \
            "PHR indicates development of a novel research tool or method."

    # ── STEP 13: BASIC RESEARCH (terms-driven) ───────────────────────────
    basic_terms = has(full,
        'mechanism','role of','function of','characteriz',
        'biology of','regulation','pathway','molecular',
        'cellular biology','cell biology',
        'gene expression','transcription','epigenetic',
        'genomic','transcriptomic','proteomic','metabolomic',
        'neural circuit','synaptic','synapse',
        'developmental biology','cell type','stem cell',
        'immune response','inflammation','protein structure',
        'in vivo','in vitro','mouse model','animal model',
        'genetic','genome','variant','mutation',
    )
    if basic_terms:
        return 'basic_research', 68, \
            "Content describes biological mechanism or characterization; output is scientific knowledge."

    # ── FALLBACK ─────────────────────────────────────────────────────────
    if has(tl,'gene therapy','cell therapy','vaccine candidate','therapeutic agent'):
        if not behavioral:
            return 'therapeutics', 60, "Title suggests therapeutic development."
    if has(tl,'high-throughput screening','platform for screening','method for detection',
           'novel technology for','development of a novel'):
        return 'biotools', 60, "Title suggests research method or technology development."
    if has(tl,'surveillance','epidem','health service','prevention program','disparit',
           'nursing home','insurance','medicaid','medicare','hospice'):
        return 'other', 60, "Title suggests health services or prevention research."
    return 'basic_research', 50, \
        "No clear product/tool/intervention signal detected; defaulting to basic research."


# ── Usage ────────────────────────────────────────────────────────────────
# For each grant g with keys: application_id, activity_code, title, org_name, phr, terms
# Call: category, confidence, reasoning = classify(g)
# Returns: (category_string, confidence_int, reasoning_string)
