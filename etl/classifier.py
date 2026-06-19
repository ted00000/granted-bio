"""
Canonical project classifier for granted.bio.

Hybrid architecture:
  - Pass 1 (activity-code routing) runs DETERMINISTICALLY in Python below.
    Training and infrastructure codes get assigned the right category here,
    confidence 95, with no API call. This is ~30% of typical NIH samples.
  - Pass 2 (content analysis) runs via Claude Haiku on projects whose
    activity codes don't trigger Pass 1.
  - org_type runs DETERMINISTICALLY in Python (using the existing
    determine_org_type from process_projects.py) for all projects, Pass 1
    or not. The LLM is never trusted with org_type.

Why this shape: validation against historical disagreements showed that
both Haiku and Sonnet were unreliable at honoring explicit deterministic
rules ("K-series → training") when content reasoning competed. Putting
the deterministic rules in code instead of the prompt removes the failure
mode entirely. Models are good at ambiguous content disambiguation —
let them focus there.

Public API:
    classify_projects(projects, abstracts_map, on_progress=None) -> list[dict]
        projects: list of dicts with application_id, activity_code, title,
            org_name, phr. funding_mechanism is optional but improves org_type
            detection.
        abstracts_map: dict mapping application_id -> abstract_text.
        on_progress: optional callable(batch_num, total_batches, classified,
            errors) called after each LLM batch for caller-side progress UI.
        returns: list of {application_id, primary_category, category_confidence,
            org_type}. Projects that fail the LLM call are absent from the
            output — the caller can diff input IDs vs output IDs to find them.

History note: This module supersedes 10+ parallel classifier implementations
in etl/ that were tangled together before 2026-06-19. The 5-tier biotools
legacy, the rule-based semantic_classifier, and various one-off batch
scripts were archived. This module is the single source of truth.
"""

import json
import os
import sys
from typing import Dict, List, Any, Optional, Tuple

# Reuse the existing Python org_type determination from process_projects.
# This sidesteps inconsistent LLM org_type calls and gives us a deterministic
# answer for every project.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from process_projects import determine_org_type


_anthropic_client = None


MODEL = 'claude-haiku-4-5-20251001'
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


# Pass 1 deterministic rules — codified here so the LLM cannot override them.
# Activity codes here were chosen because they are nearly always one category
# in the NIH grant universe. Ambiguous codes (R01, U54, U10, U01, etc.) are
# intentionally NOT in Pass 1 — the LLM gets to use content for those.

# Single-letter prefixes that always route to training. Catches K01-K99 (Career
# Development), F30-F33/F99 (Fellowships), T-series (Training Grants),
# D-series including DP1/DP2/DP5 (Director's awards) and D43/D71.
TRAINING_PREFIXES = ('T', 'F', 'K', 'D')

# Additional codes that go to training, derived from analysis of historical
# correction data:
# - R25: education project
# - R36: dissertation award
# - R38: stimulating access to research in residency
# - R90: residency-based research training
# - UE5: education project cooperative agreement
# - ZIE: NIH intramural training/education
TRAINING_EXACT_CODES = frozenset({'R25', 'R36', 'R38', 'R90', 'UE5', 'ZIE'})

# Exact activity codes that route to infrastructure. Substantially expanded
# 2026-06-19 after disagreement-data analysis showed P01/P20/P40/P41/P42/P60/P2C
# and U41/U42 dominate the infrastructure ground truth.
INFRASTRUCTURE_EXACT_CODES = frozenset({
    # Program projects and center grants
    'P01', 'P20', 'P30', 'P40', 'P41', 'P42', 'P50', 'P51', 'P60', 'P2C',
    # Instrumentation
    'S10', 'G20',
    # Conferences, coordination, and resource cooperative agreements
    'U13', 'R13', 'U24', 'U2C', 'U41', 'U42',
    # NIH intramural (Z series, excluding ZIE which is training)
    'ZIA', 'ZIC', 'ZIJ',
    # Contracts and other transactions
    'N01', 'N02', 'OT2', 'OT3',
    # Institutional support
    'S07', 'S08', 'S09', 'S11',
})


# Prompt for Pass 2 content classification. Pass 1 routing and org_type
# detection were both moved to Python — neither appears here. The prompt
# returns only primary_category + category_confidence.
BATCH_PROMPT = """Classify each NIH grant. Return a JSON array.

Projects to classify:
{projects_json}

## THE CORE QUESTION

For each project, answer ONE question:

> "What concrete THING will exist at the end of this project that doesn't exist now?"

| If the project produces… | Category |
|---|---|
| A new tool / assay / method / software / resource / model system for OTHER RESEARCHERS to use | **biotools** |
| A new drug, biologic, vaccine, cell therapy, or other treatment for a PATIENT (or under preclinical/clinical development toward one) | **therapeutics** |
| A new clinical TEST used on patients to detect, diagnose, or monitor disease | **diagnostics** |
| A new physical DEVICE used on or by a patient | **medical_device** |
| Patient-facing or clinician-facing SOFTWARE (apps, decision support, telemedicine) | **digital_health** |
| Just new scientific UNDERSTANDING — no tangible artifact at the end | **basic_research** |
| Genuinely doesn't fit any of the above (set confidence ≤ 30) | **other** |

## THE KEY DISTINCTION

basic_research is NOT a thing — it's knowledge. If the deliverable is "we'll understand X better" or "a paper describing Y," it's basic_research.

biotools and therapeutics ARE things:
- A biotool is something another lab can pick up and use.
- A therapy is something a doctor can give to a patient.

When in doubt, ask: at the project's end, what would I be able to put on a table?
- A paper or a database of knowledge → basic_research
- A reagent, kit, software, method, or research resource → biotools
- A drug candidate, vaccine, or treatment regimen → therapeutics
- A clinical assay or biomarker panel for diagnosis → diagnostics
- A wearable, implant, or surgical tool → medical_device
- A patient app or clinical decision support system → digital_health

## COMMON CONFUSIONS

**Mentioning a drug ≠ developing a drug.** A project using rapamycin to study mTOR is producing knowledge about mTOR (basic_research). A project developing a rapamycin analog for clinical use is producing a drug candidate (therapeutics).

**Mentioning a disease ≠ diagnostics or therapeutics.** Most NIH research mentions diseases. Disease relevance doesn't make the deliverable a treatment. Ask: is there a new TREATMENT at the end? A new TEST? Or just new UNDERSTANDING?

**Method development ≠ basic_research.** "Development of a new mass spec method for X" produces a method other researchers will use → biotools. "Using mass spec to characterize X" produces knowledge → basic_research.

**Software audience matters.** Research software for scientists → biotools. Patient or clinician-facing software → digital_health.

## SBIR / STTR

Activity codes R41/R42/R43/R44 fund small-business product development by statute. They will be biotools, therapeutics, diagnostics, medical_device, or digital_health. Pick by what the company is building.

## WORKED EXAMPLES

EXAMPLE 1 — mechanism study with drug context (basic_research)
Title: "Investigating the molecular mechanism of P-gp/NHERF-1 network at feto-maternal interface"
Deliverable: knowledge about P-gp/NHERF-1 signaling. No new drug, no new tool, no new test.
→ basic_research (90)

EXAMPLE 2 — preclinical drug development (therapeutics)
Title: "Preclinical optimization of a bispecific antibody targeting CD3 and CD20 for relapsed B-cell lymphoma"
Deliverable: an optimized antibody candidate for clinical advancement. A thing, intended for patients.
→ therapeutics (85)

EXAMPLE 3 — new research tool (biotools)
Title: "Rapid structure-based software to enhance antibody affinity for high-throughput screening"
Deliverable: software that other researchers will use to design antibodies. The software is the thing.
→ biotools (85)

EXAMPLE 4 — new clinical test (diagnostics)
Title: "Validation of a multi-analyte blood test for early Alzheimer's disease detection"
Deliverable: a clinical test doctors will run on patients to detect Alzheimer's.
→ diagnostics (85)

EXAMPLE 5 — using a tool to study biology (basic_research)
Title: "The role of RNA m6A modification in the regulation of HIV latency and reactivation"
Deliverable: understanding of how m6A regulates viral latency. HIV is a disease context, but the project produces knowledge, not a treatment.
→ basic_research (90)

## WHEN UNCERTAIN

If after applying the test you can't confidently choose, set:
  primary_category: "other"
  category_confidence: ≤ 30

That routes the project to admin review. Better to flag for review than to force a wrong confident answer.

For each project return:
{{
  "application_id": "the project's application_id",
  "primary_category": "basic_research|biotools|therapeutics|diagnostics|medical_device|digital_health|other",
  "category_confidence": 0-100
}}

Return ONLY the JSON array, no other text."""


def _get_client():
    global _anthropic_client
    if _anthropic_client is None:
        from anthropic import Anthropic
        _anthropic_client = Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
    return _anthropic_client


def _classify_by_activity_code(activity_code: str) -> Optional[str]:
    """Pass 1 deterministic activity-code routing.

    Returns the category if the activity code matches a Pass 1 rule, else
    None (caller should send the project to LLM content analysis).
    """
    if not activity_code:
        return None
    code = activity_code.strip().upper()
    if not code:
        return None

    if code in TRAINING_EXACT_CODES:
        return 'training'
    if code[0] in TRAINING_PREFIXES:
        return 'training'
    if code in INFRASTRUCTURE_EXACT_CODES:
        return 'infrastructure'
    return None


def _resolve_org_type(project: Dict[str, Any]) -> str:
    """Deterministic org_type via the existing process_projects helper.

    Falls back to 'other' if determine_org_type returns something we don't
    recognize (defensive — shouldn't happen in practice).
    """
    org_name = project.get('org_name') or ''
    funding_mech = project.get('funding_mechanism') or ''
    org_type = determine_org_type(org_name, funding_mech) or 'other'
    if org_type not in VALID_ORG_TYPES:
        return 'other'
    return org_type


def _classify_batch(
    projects: List[Dict[str, Any]], abstracts_map: Dict[str, str]
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """Send one batch to Haiku for Pass 2 content classification."""
    projects_for_prompt = []
    for p in projects:
        app_id = p.get('application_id')
        abstract = abstracts_map.get(app_id, '')
        projects_for_prompt.append({
            'application_id': app_id,
            'activity_code': p.get('activity_code', ''),
            'title': p.get('title', ''),
            'org_name': p.get('org_name', ''),
            'phr': (p.get('phr') or '')[:1000],
            'abstract': abstract[:1500] if abstract else '',
        })

    prompt = BATCH_PROMPT.format(projects_json=json.dumps(projects_for_prompt, indent=2))

    try:
        client = _get_client()
        message = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            messages=[{'role': 'user', 'content': prompt}],
        )
        text = message.content[0].text.strip()
        if text.startswith('```json'):
            text = text[7:]
        if text.startswith('```'):
            text = text[3:]
        if text.endswith('```'):
            text = text[:-3]
        return json.loads(text.strip()), None
    except Exception as e:
        return None, str(e)


def _normalize_llm_result(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Validate + clamp one classification dict from the LLM response.

    Returns just application_id + primary_category + category_confidence.
    org_type is added by the caller from Python's deterministic detection.
    """
    app_id = raw.get('application_id')
    if not app_id:
        return None

    category = (raw.get('primary_category') or 'other').lower()
    # The prompt restricts the LLM to seven content categories — training and
    # infrastructure should never come back from the LLM. If they somehow do,
    # downgrade to 'other' so they surface for review.
    content_categories = {'basic_research', 'biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other'}
    if category not in content_categories:
        category = 'other'

    try:
        confidence = float(raw.get('category_confidence', 50))
    except (TypeError, ValueError):
        confidence = 50.0
    confidence = max(0.0, min(100.0, confidence))

    return {
        'application_id': app_id,
        'primary_category': category,
        'category_confidence': confidence,
    }


def classify_projects(
    projects: List[Dict[str, Any]],
    abstracts_map: Dict[str, str],
    on_progress: Optional[callable] = None,
) -> List[Dict[str, Any]]:
    """Classify a list of projects via Pass 1 (Python) + Pass 2 (Haiku).

    See module docstring for shape contract.
    """
    if not projects:
        return []

    results: List[Dict[str, Any]] = []
    needs_llm: List[Dict[str, Any]] = []

    for p in projects:
        app_id = p.get('application_id')
        org_type = _resolve_org_type(p)

        # Pass 1: deterministic activity-code routing
        pass1 = _classify_by_activity_code(p.get('activity_code', ''))
        if pass1 is not None:
            results.append({
                'application_id': app_id,
                'primary_category': pass1,
                'category_confidence': 95.0,
                'org_type': org_type,
            })
            continue

        # Carry the resolved org_type alongside the project for merging post-LLM
        p_with_orgtype = dict(p)
        p_with_orgtype['_resolved_org_type'] = org_type
        needs_llm.append(p_with_orgtype)

    if not needs_llm:
        return results

    # Pass 2: Haiku content classification on what's left
    errors = 0
    total_batches = (len(needs_llm) + PROJECTS_PER_API_CALL - 1) // PROJECTS_PER_API_CALL

    for i in range(0, len(needs_llm), PROJECTS_PER_API_CALL):
        batch = needs_llm[i:i + PROJECTS_PER_API_CALL]
        batch_num = (i // PROJECTS_PER_API_CALL) + 1

        # Strip the carry-along field before sending to LLM
        batch_for_llm = [
            {k: v for k, v in p.items() if k != '_resolved_org_type'}
            for p in batch
        ]
        org_type_by_id = {
            str(p['application_id']): p['_resolved_org_type']
            for p in batch
        }

        raw_results, error = _classify_batch(batch_for_llm, abstracts_map)
        if error or not raw_results:
            errors += len(batch)
        else:
            for raw in raw_results:
                norm = _normalize_llm_result(raw)
                if norm:
                    app_id_str = str(norm['application_id'])
                    norm['org_type'] = org_type_by_id.get(app_id_str, 'other')
                    results.append(norm)
                else:
                    errors += 1

        if on_progress:
            on_progress(batch_num, total_batches, len(results), errors)

    return results
