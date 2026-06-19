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

If activity code matches above → classify immediately, skip content analysis.

## PASS 2: CONTENT ANALYSIS

Ask: "What is the PRIMARY DELIVERABLE?"
- Knowledge/understanding → basic_research
- Tool/assay/platform FOR researchers → biotools
- Drug/treatment → therapeutics
- Clinical test → diagnostics
- Physical device for patients → medical_device
- Patient-facing software → digital_health
- None of above → other

## 8 DISAMBIGUATION RULES

1. **Assays/probes/model systems → biotools** NOT basic_research (if DEVELOPING the tool)
2. **USES vs DEVELOPS:** "Uses RNA-seq to study X" → basic_research. "Improves RNA-seq method" → biotools
3. **Biomarker intent:** "Identify biomarkers" → basic_research. "Validate clinical panel" → diagnostics. "Build detection platform" → biotools
4. **Drug studies:** "Understand how drug X works" → basic_research. "Optimize drug X for efficacy" → therapeutics
5. **AI/ML by application:** ML for protein folding → basic_research. ML drug screening → therapeutics. ML tool for researchers → biotools. ML clinical decision support → digital_health
6. **digital_health requires patient/clinician deployment:** Software for researchers → biotools
7. **Combination projects:** Classify by PRIMARY innovation (usually title focus or Aim 1)
8. **other = genuinely residual:** Re-read abstract for hidden deliverables before using

## Organization types:
- company: Inc., LLC, Corp., Therapeutics, Biosciences, SBIR/STTR
- university: Academic institutions
- hospital: Medical centers, health systems
- research_institute: Broad, Scripps, Fred Hutchinson, etc.
- other: Government, non-profits

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
