"""
Canonical project classifier for granted.bio.

This module is the SINGLE source of truth for how projects are categorized.
All other code paths — sync_projects_via_api.py (new awards from API),
classify_projects_batched.py (bulk reclassification), reclassify_existing.py
(fixing existing data) — import from here. There is no inline classification
in load_to_supabase.py or any other loader. Whatever ends up in
projects.primary_category came from this function.

The classifier uses Claude Haiku in batched API calls (20 projects per call)
with an embedded prompt that codifies the 9-category schema:
  training | infrastructure | basic_research | biotools | therapeutics
  | diagnostics | medical_device | digital_health | other

Same prompt also assigns org_type (company, university, hospital,
research_institute, other).

History note: Before 2026-06-19 there were ~10 parallel classifier
implementations in etl/ — a 5-tier biotools-only legacy, a deterministic
rule-based "semantic_classifier" not actually wired to production, plus
many one-off batch scripts. All were archived as part of the
classification cleanup (see etl/archive/2026-06-19_classification_consolidation/).
This module is what survived as the canonical path.

Public API:
    classify_projects(projects, abstracts_map) -> list[dict]
        projects: list of dicts with application_id, title, org_name, phr
        abstracts_map: dict mapping application_id -> abstract_text
        returns: list of {application_id, primary_category,
                          category_confidence (0-100), org_type}

The function does NOT write to the DB. Callers decide what to do with the
results (update specific rows, log, validate, etc.).
"""

import json
import os
from typing import Dict, List, Any, Optional, Tuple

# Anthropic client is initialized lazily on first call so that scripts
# importing this module without classifying don't need ANTHROPIC_API_KEY set.
_anthropic_client = None


MODEL = 'claude-3-5-haiku-latest'
PROJECTS_PER_API_CALL = 20

VALID_CATEGORIES = [
    'training',
    'infrastructure',
    'basic_research',
    'biotools',
    'therapeutics',
    'diagnostics',
    'medical_device',
    'digital_health',
    'other',
]

VALID_ORG_TYPES = [
    'company',
    'university',
    'hospital',
    'research_institute',
    'other',
]


BATCH_PROMPT = """Classify each NIH grant. Return a JSON array with one object per project.

Projects to classify:
{projects_json}

For each project, return:
{{
  "application_id": "the project's application_id",
  "primary_category": "training|infrastructure|basic_research|biotools|therapeutics|diagnostics|medical_device|digital_health|other",
  "category_confidence": 0-100,
  "org_type": "company|university|hospital|research_institute|other"
}}

## PASS 1: ACTIVITY CODE PRE-FILTER (Check FIRST!)

**Always → training:** T32, T34, T35, T90, TL1, TL4, F30-F33, F99, K01-K99, D43, D71, R25, R90
**Always → infrastructure:** P30, P50, P51, S10, G20, U13, R13, U24, U2C
**Always → infrastructure (contract / intramural):** ZIA (NIH intramural research projects), N01, N02 (NIH research contracts), OT2, OT3 (other transactions / collaborative agreements), S07, S08, S09, S11 (institutional support)

If activity code matches above → classify immediately, skip content analysis. These codes denote funding mechanisms whose primary deliverable is training, institutional capacity, or services — not new science.

## SBIR / STTR SPECIAL HANDLING

Activity codes R41, R42, R43, R44 are SBIR/STTR — Small Business Innovation Research and Small Business Technology Transfer. By statute, these fund small business product development. They are almost never basic_research, training, or infrastructure.

For SBIR/STTR awards, classify into one of:
- biotools, therapeutics, diagnostics, medical_device, or digital_health
depending on the PRODUCT being developed.

Notes:
- Phase I (R43, R41) is feasibility / proof-of-concept for the product.
- Phase II (R44, R42) is development toward commercialization.
- "Development of," "system," "platform," and "novel" language is normal for SBIR and does NOT by itself signal biotools — apply the standard primary-deliverable test.
- If a SBIR/STTR genuinely doesn't fit any product category, use "other" with confidence ≤ 30 to flag for review.

## PASS 2: CONTENT ANALYSIS

Ask: "What is the PRIMARY DELIVERABLE?"
- Knowledge/understanding → basic_research
- Tool/assay/platform FOR researchers → biotools
- Drug/treatment → therapeutics
- Clinical test → diagnostics
- Physical device for patients → medical_device
- Patient-facing software → digital_health
- None of above → other

## basic_research IS A PRIMARY CATEGORY, NOT A FALLBACK

basic_research is the largest and most heterogeneous category. It covers any project whose primary deliverable is biological knowledge — understanding mechanism, characterizing a phenomenon, or discovering new biology.

Characteristic patterns:
- Mechanism studies (signaling, gene regulation, structure-function)
- Discovery / characterization (new genes, pathways, cell types, phenomena)
- Model system USE for studying biology (developing a model system FOR others to use is biotools — note the distinction)
- Cohort or epidemiological studies of disease biology
- Comparative biology / evolution
- Single-cell / multi-omic profiling for biological understanding
- Imaging studies focused on biological process visualization

If a project mentions a disease, drug, or clinical application but the PRIMARY OUTPUT is biological understanding rather than a tangible deliverable (drug, test, device, software, tool), it is basic_research.

Disease relevance ≠ therapeutic development.
Tool use ≠ tool development.
Diagnostic context ≠ diagnostic development.

## DISAMBIGUATION RULES

1. **Assays/probes/model systems → biotools** NOT basic_research (if DEVELOPING the tool for others to use)

2. **USES vs DEVELOPS:** "Uses RNA-seq to study X" → basic_research. "Improves RNA-seq method" → biotools

3. **Biomarker intent:** "Identify biomarkers" → basic_research. "Validate clinical panel" → diagnostics. "Build detection platform" → biotools

4. **CRITICAL DISTINCTION — studying-a-drug vs developing-a-drug:**

   A project that USES a drug to study biology → basic_research.
   A project that DEVELOPS or OPTIMIZES a drug → therapeutics.

   Three tests, applied in order:

   TEST A — strip the drug name. Does the project still make sense as a basic biology study?
     YES → basic_research (e.g., "We use rapamycin to investigate mTOR signaling in cancer")
     NO → therapeutics (e.g., "Develop a rapamycin analog with improved selectivity")

   TEST B — what is the project DELIVERING at the end?
     Mechanism knowledge → basic_research
     Validated target for future drug development → basic_research
     Improved drug candidate / new dosing / new formulation → therapeutics
     Efficacy data toward an IND or clinical trial → therapeutics

   TEST C — what is the verb in the title or Aim 1?
     "Studying," "investigating," "characterizing," "elucidating," "examining," "exploring" → basic_research
     "Developing," "optimizing," "validating efficacy of," "advancing to clinic," "translating to" → therapeutics

5. **AI/ML by application domain:** ML for protein folding → basic_research. ML drug screening → therapeutics. ML tool for researchers → biotools. ML clinical decision support → digital_health

6. **digital_health requires patient or clinician deployment:** Software for researchers → biotools, not digital_health

7. **Combination projects:** Classify by PRIMARY innovation (usually title focus or Aim 1)

8. **other = genuinely residual:** Re-read abstract for hidden deliverables before using

9. **The "for [disease]" pattern is NOT determinative:**

   Many basic research projects describe their work as "for cancer," "for Alzheimer's," "for autism" etc. without being therapeutic, diagnostic, or biotools work.

   Examples of "for [disease]" that ARE basic_research:
   - "Novel signaling pathway for cancer therapy" (mechanism work with therapeutic implications; not a therapy itself)
   - "New mouse model for Alzheimer's" (model use; unless explicit "for use by other researchers")
   - "Single-cell atlas for liver disease" (descriptive biology with disease context)

   Examples of "for [disease]" that are NOT basic_research:
   - "Developing a diagnostic test for early Alzheimer's" → diagnostics
   - "Optimizing antibody for breast cancer immunotherapy" → therapeutics
   - "Building an open-access cancer organoid biobank" → biotools

   Test: strip the disease context. Is there still a deliverable beyond knowledge?

## THERAPEUTICS KEYWORD EXPANSION

Strong therapeutic signals include the following terms in the title or abstract, especially when paired with disease context or efficacy/safety language:

- "treating [disease/condition]" / "treatment of [disease/condition]"
- "therapeutic" / "therapy" / "therapies"
- "biologic" / "biologics" / "biological agent"
- "radiotherapeutic" / "radiotherapy" / "radio-conjugate"
- "CAR-T" / "CAR-NK" / "CAR-M" / "CAR-microglia" or any "CAR-X" cell therapy
- "ADC" / "antibody-drug conjugate" / "immunoconjugate"
- "mRNA vaccine" / "mRNA therapeutic"
- "nanoparticle" + therapeutic context (delivery, drug, formulation)
- "gene therapy" / "gene editing" with explicit therapeutic intent
- "small molecule" + ("inhibitor" OR "agonist" OR "antagonist") + disease
- "monoclonal antibody" / "mAb" + disease context
- "vaccine" + disease prevention or treatment context

BUT: these terms alone do NOT make a project therapeutic. Apply Rule 4 (USES vs DEVELOPS). Many basic research projects mention these terms while studying biology, not developing a treatment.

## WORKED EXAMPLES (real NIH grants, classifications are ground truth from manual review)

EXAMPLE 1 — therapeutics → basic_research (most common misclassification)

PROJECT:
  title: "Investigating the molecular mechanism of P-gp/NHERF-1 network at feto-maternal interface and role of paracrine signaling of EVs containing drug transporter proteins"
  org: University of Texas Med Br Galveston
  activity: R01

ANALYSIS:
  "Investigating the molecular mechanism" is unambiguous basic_research vocabulary. The mention of "drug transporter proteins" makes this read therapeutically at first glance, but applying Rule 4 Test A: strip "drug transporter" and the project still makes sense as a study of P-gp/NHERF-1 signaling at the placental interface. The deliverable is mechanism knowledge, not a drug. Confidence: high.

CLASSIFICATION: basic_research (confidence 90)

EXAMPLE 2 — biotools → basic_research

PROJECT:
  title: "The role of RNA m6A modification in the regulation of HIV latency and reactivation"
  org: Case Western Reserve University
  activity: R61

ANALYSIS:
  "The role of X in the regulation of Y" is mechanism vocabulary. HIV is a disease context, but Rule 9 reminds us that disease relevance ≠ therapeutic development. The project studies how m6A modification regulates viral latency — knowledge work, not tool development, not therapeutic development. The R61 activity code is exploratory R-series, consistent with mechanism research. Confidence: high.

CLASSIFICATION: basic_research (confidence 90)

EXAMPLE 3 — basic_research → biotools (the developing-a-tool case)

PROJECT:
  title: "Functional MRI Method Development"
  org: National Institute of Mental Health
  activity: ZIA

ANALYSIS:
  Despite ZIA being a Pass 1 infrastructure code, the title explicitly says "Method Development." This is the developing-a-tool case Rule 2 highlights: the deliverable is a new MRI method for other researchers to use, not knowledge produced by USING fMRI. When activity code and content disagree this strongly, content wins. Confidence: moderate-high.

CLASSIFICATION: biotools (confidence 80)

EXAMPLE 4 — basic_research → therapeutics (Phase 2 trial, clear development)

PROJECT:
  title: "Phase 2 Clinical Trial of Ciliary Neurotrophic Factor (CNTF) for Macular Telangiectasia Type 2 (MacTel)"
  org: National Eye Institute
  activity: ZIA

ANALYSIS:
  "Phase 2 Clinical Trial" is unambiguous therapeutic development. The "for [disease]" pattern (Rule 9) usually doesn't determine therapeutics, but a Phase 2 trial is testing efficacy in patients — that's the developing-a-drug end of Rule 4. ZIA activity code would normally route to infrastructure under Pass 1, but a clinical trial is a deliverable, not institutional infrastructure. Confidence: very high.

CLASSIFICATION: therapeutics (confidence 95)

EXAMPLE 5 — SBIR R44 case: software for researchers, not patients

PROJECT:
  title: "Rapid structure-based software to enhance antibody affinity and developability for high-throughput screening: Aiming toward total in silico design of antibodies"
  org: DNASTAR, Inc.
  activity: R44

ANALYSIS:
  R44 is SBIR Phase II — by statute, product development. The product here is software for researchers doing antibody design (biotools per Rule 6: software for researchers → biotools, not digital_health). The "antibody" mention could read therapeutics, but the software is for OTHER scientists to use in their antibody work, not a therapeutic in itself. Confidence: high.

CLASSIFICATION: biotools (confidence 85)
  org_type: company (R44 SBIR + "Inc." suffix)

EXAMPLE 6 — digital_health → biotools (software audience matters)

PROJECT:
  title: "Development of Computational Tools and Their Applications to Various Biological Systems"
  org: Lehigh University
  activity: R35

ANALYSIS:
  "Development of Computational Tools" is biotools (Rule 6: software for researchers → biotools). The phrase "Applications to Various Biological Systems" indicates the tools are used for biological research, not for patient-facing clinical decision support. Rule 6 is explicit: digital_health requires patient or clinician deployment. Confidence: high.

CLASSIFICATION: biotools (confidence 85)

## ORGANIZATION TYPES

### company (private commercial entities)
Signals:
- Names ending in Inc., LLC, Corp., Corporation, Ltd., Co.
- "Therapeutics," "Biosciences," "Pharma," "Diagnostics" in the org name
- All SBIR/STTR awards (activity codes R41/R42/R43/R44) are companies
- "Holdings," "Capital," "Ventures" suffixes (parent companies)

### university (academic degree-granting institutions)
Signals:
- "University of," "University," "College" in name
- "Institute of Technology" (MIT, Caltech, Georgia Tech) — academic
- Includes university medical schools and affiliated medical centers (UCSF, UCLA Health, Johns Hopkins Medicine, etc.)
- State universities and land-grant institutions

### hospital (independent medical centers and health systems)
Signals:
- "Hospital," "Medical Center," "Health System," "Clinic" in name AND NOT university-affiliated
- Independent hospitals: Mayo Clinic, Cleveland Clinic, Mass General Brigham, Memorial Sloan-Kettering, MD Anderson
- VA Medical Centers (Department of Veterans Affairs)
- Children's hospitals: Boston Children's, CHOP, Cincinnati Children's

### research_institute (independent non-profit research orgs)
Signals:
- "Institute" without a university degree-granting parent: Broad, Salk, Scripps, Whitehead, Fred Hutchinson, Cold Spring Harbor, Allen Institute
- Foundation labs: Howard Hughes Medical Institute (HHMI), Chan Zuckerberg (CZI), Wellcome
- Federally Funded Research and Development Centers (FFRDCs)

### other
Signals:
- Government agencies (NIH intramural divisions, FDA, CDC, VA Office)
- Foundations and 501(c)(3) non-profits without dedicated research labs
- Professional societies
- International organizations
- Anything ambiguous after the above rules

Edge cases:
- Hospital + university affiliation: classify by the org_name on the award itself, not by the affiliation
- Industry-academic partnerships: classify by the org_name receiving the award
- If genuinely ambiguous after applying all rules, default to "other". The admin review queue will catch it.

## WHEN YOU ARE GENUINELY UNCERTAIN

If after applying all rules and tests you cannot confidently classify a project into one of the nine categories, set:

  primary_category: "other"
  category_confidence: ≤ 30

Low-confidence "other" classifications surface in the admin review queue for human inspection. It is BETTER to flag for review than to force a confident wrong answer.

DO NOT over-use this escape. Most projects fit cleanly into one of the nine categories. Use the review path only when the abstract is genuinely unparseable, internally contradictory, or describes work that spans multiple categories with no clear primary.

Return ONLY the JSON array, no other text."""


def _get_client():
    """Lazy init so modules can import classifier without needing the API key."""
    global _anthropic_client
    if _anthropic_client is None:
        from anthropic import Anthropic
        _anthropic_client = Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
    return _anthropic_client


def _classify_batch(
    projects: List[Dict[str, Any]], abstracts_map: Dict[str, str]
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """Classify one batch of up to PROJECTS_PER_API_CALL projects via one API call.

    Returns (results, None) on success or (None, error_message) on failure.
    """
    projects_for_prompt = []
    for p in projects:
        app_id = p.get('application_id')
        abstract = abstracts_map.get(app_id, '')
        projects_for_prompt.append(
            {
                'application_id': app_id,
                'title': p.get('title', ''),
                'org_name': p.get('org_name', ''),
                'phr': (p.get('phr') or '')[:1000],
                'abstract': abstract[:1500] if abstract else '',
            }
        )

    prompt = BATCH_PROMPT.format(projects_json=json.dumps(projects_for_prompt, indent=2))

    try:
        client = _get_client()
        message = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            messages=[{'role': 'user', 'content': prompt}],
        )

        text = message.content[0].text.strip()
        # Strip markdown code fences if the model wraps the JSON
        if text.startswith('```json'):
            text = text[7:]
        if text.startswith('```'):
            text = text[3:]
        if text.endswith('```'):
            text = text[:-3]
        text = text.strip()

        return json.loads(text), None
    except Exception as e:
        return None, str(e)


def _normalize_classification(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Validate + clamp one classification dict from the LLM response."""
    app_id = raw.get('application_id')
    if not app_id:
        return None

    category = (raw.get('primary_category') or 'other').lower()
    if category not in VALID_CATEGORIES:
        category = 'other'

    org_type = (raw.get('org_type') or 'other').lower()
    if org_type not in VALID_ORG_TYPES:
        org_type = 'other'

    try:
        confidence = float(raw.get('category_confidence', 50))
    except (TypeError, ValueError):
        confidence = 50.0
    confidence = max(0.0, min(100.0, confidence))

    return {
        'application_id': app_id,
        'primary_category': category,
        'category_confidence': confidence,
        'org_type': org_type,
    }


def classify_projects(
    projects: List[Dict[str, Any]],
    abstracts_map: Dict[str, str],
    on_progress: Optional[callable] = None,
) -> List[Dict[str, Any]]:
    """Classify a list of projects.

    Args:
        projects: list of dicts. Each must have application_id, title,
            org_name, phr.
        abstracts_map: dict mapping application_id -> abstract_text.
            Pass {} if abstracts aren't available; classification will
            still run on title + phr but accuracy may drop.
        on_progress: optional callable(batch_num, total_batches, classified,
            errors) called after each batch for caller-side progress UI.

    Returns:
        list of classification dicts (one per successfully classified
        project): application_id, primary_category, category_confidence,
        org_type. Projects that failed classification (LLM error, parse
        failure, etc.) are NOT in the output — the caller can diff input
        IDs against output IDs to find them.
    """
    if not projects:
        return []

    results: List[Dict[str, Any]] = []
    errors = 0
    total_batches = (len(projects) + PROJECTS_PER_API_CALL - 1) // PROJECTS_PER_API_CALL

    for i in range(0, len(projects), PROJECTS_PER_API_CALL):
        batch = projects[i : i + PROJECTS_PER_API_CALL]
        batch_num = (i // PROJECTS_PER_API_CALL) + 1

        raw_results, error = _classify_batch(batch, abstracts_map)
        if error or not raw_results:
            errors += len(batch)
        else:
            for raw in raw_results:
                normalized = _normalize_classification(raw)
                if normalized:
                    results.append(normalized)
                else:
                    errors += 1

        if on_progress:
            on_progress(batch_num, total_batches, len(results), errors)

    return results
