"""
Validation: compare the OLD prompt vs the NEW prompt against ground-truth
corrections from etl/category_disagreements_clean.json.

For each of 500 sampled projects:
  - Run the OLD prompt → record predicted primary_category
  - Run the NEW prompt → record predicted primary_category
  - Compare each against the manually-corrected ground truth

This is READ-ONLY. No database writes. No changes to existing data.
Total expected cost: ~$0.30 (about 50 API calls × 2 prompts).

Usage:
    python3 scripts/validate_classifier_prompt.py [--sample-size 500] [--seed 42]
"""

import argparse
import json
import os
import random
import sys
import time
from collections import Counter, defaultdict
from typing import Dict, List, Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'etl'))

from dotenv import load_dotenv
load_dotenv('.env.local')

from anthropic import Anthropic
from supabase import create_client

# Import the NEW prompt + helpers from the canonical module
from classifier import (
    BATCH_PROMPT as NEW_PROMPT,
    MODEL,
    PROJECTS_PER_API_CALL,
    _normalize_classification,
)


# The OLD prompt — same content that lived in classify_projects_batched.py
# before today's overhaul. Held inline here so this validation script is
# self-contained and won't drift if classify_projects_batched.py is updated
# or archived.
OLD_PROMPT = """Classify each NIH grant. Return a JSON array with one object per project.

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


def get_supabase():
    url = os.environ['NEXT_PUBLIC_SUPABASE_URL']
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ['SUPABASE_SERVICE_ROLE_KEY']
    return create_client(url, key)


def fetch_abstracts(supabase, app_ids: List[str]) -> Dict[str, str]:
    """Fetch abstracts for the sampled application_ids. In chunks to keep
    the IN clause reasonable."""
    abstracts: Dict[str, str] = {}
    chunk = 200
    for i in range(0, len(app_ids), chunk):
        batch = app_ids[i:i + chunk]
        result = supabase.table('abstracts').select('application_id, abstract_text').in_('application_id', batch).execute()
        for row in (result.data or []):
            abstracts[str(row['application_id'])] = row.get('abstract_text') or ''
    return abstracts


def run_prompt(client, prompt_template, projects, abstracts_map):
    """Run one prompt against batches of projects. Returns dict mapping
    application_id → predicted primary_category."""
    predictions: Dict[str, str] = {}

    for i in range(0, len(projects), PROJECTS_PER_API_CALL):
        batch = projects[i:i + PROJECTS_PER_API_CALL]

        prompt_input = []
        for p in batch:
            app_id = p['application_id']
            abstract = abstracts_map.get(app_id, '')
            prompt_input.append({
                'application_id': app_id,
                'title': p.get('title', ''),
                'org_name': p.get('org_name', ''),
                'phr': '',
                'abstract': abstract[:1500] if abstract else '',
            })

        prompt = prompt_template.format(projects_json=json.dumps(prompt_input, indent=2))

        try:
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
            text = text.strip()
            results = json.loads(text)
            for raw in results:
                norm = _normalize_classification(raw)
                if norm:
                    predictions[str(norm['application_id'])] = norm['primary_category']
        except Exception as e:
            print(f'  batch {i // PROJECTS_PER_API_CALL + 1} failed: {str(e)[:150]}', flush=True)

        time.sleep(0.5)  # be polite

    return predictions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample-size', type=int, default=500)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--disagreements', default='etl/category_disagreements_clean.json')
    args = parser.parse_args()

    print('=' * 72)
    print('Classifier prompt validation (READ-ONLY)')
    print('=' * 72)
    print(f'  Sample size: {args.sample_size}')
    print(f'  Random seed: {args.seed}')
    print()

    print(f'Loading disagreements from {args.disagreements}...')
    with open(args.disagreements) as f:
        data = json.load(f)
    pool = data['disagreements']
    print(f'  Pool size: {len(pool):,}')

    rng = random.Random(args.seed)
    sample = rng.sample(pool, min(args.sample_size, len(pool)))
    print(f'  Sampled: {len(sample)}')

    app_ids = [str(p['application_id']) for p in sample]

    print('Fetching abstracts from DB...')
    supabase = get_supabase()
    abstracts = fetch_abstracts(supabase, app_ids)
    print(f'  Got abstracts for {len(abstracts):,} of {len(sample)} sampled projects')
    print()

    # Build the project payload that both prompts consume
    projects = [
        {
            'application_id': str(p['application_id']),
            'title': p.get('title', '') or '',
            'org_name': p.get('org_name', '') or '',
        }
        for p in sample
    ]

    # Ground truth from the disagreement record (the corrected category)
    truth: Dict[str, str] = {
        str(p['application_id']): p['primary_category']
        for p in sample
    }

    client = Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])

    print('-' * 72)
    print('Running OLD prompt...')
    print('-' * 72)
    old_preds = run_prompt(client, OLD_PROMPT, projects, abstracts)

    print()
    print('-' * 72)
    print('Running NEW prompt...')
    print('-' * 72)
    new_preds = run_prompt(client, NEW_PROMPT, projects, abstracts)

    # Score
    old_matches = sum(1 for aid, t in truth.items() if old_preds.get(aid) == t)
    new_matches = sum(1 for aid, t in truth.items() if new_preds.get(aid) == t)
    old_missing = sum(1 for aid in truth if aid not in old_preds)
    new_missing = sum(1 for aid in truth if aid not in new_preds)

    print()
    print('=' * 72)
    print('Results')
    print('=' * 72)
    print(f'  Sample size                  : {len(sample)}')
    print(f'  OLD prompt agreement w/ truth: {old_matches} ({old_matches / len(sample) * 100:.1f}%)')
    print(f'  NEW prompt agreement w/ truth: {new_matches} ({new_matches / len(sample) * 100:.1f}%)')
    print(f'  OLD prompt missing predictions: {old_missing}')
    print(f'  NEW prompt missing predictions: {new_missing}')
    print()

    # Per-category breakdown
    print('Per-category breakdown (NEW prompt):')
    by_truth = defaultdict(list)
    for aid, t in truth.items():
        by_truth[t].append(aid)
    for cat in sorted(by_truth.keys()):
        ids = by_truth[cat]
        old_c = sum(1 for aid in ids if old_preds.get(aid) == cat)
        new_c = sum(1 for aid in ids if new_preds.get(aid) == cat)
        print(f'  {cat:20s}  truth={len(ids):4d}  OLD={old_c:4d} ({old_c/len(ids)*100:5.1f}%)  NEW={new_c:4d} ({new_c/len(ids)*100:5.1f}%)')

    # Top "from → to" disagreements introduced by NEW prompt
    print()
    print('Top NEW prompt mistakes (predicted X, truth was Y):')
    mistakes = Counter()
    for aid, t in truth.items():
        pred = new_preds.get(aid)
        if pred and pred != t:
            mistakes[(pred, t)] += 1
    for (pred, t), n in mistakes.most_common(10):
        print(f'  {pred:18s} → {t:18s}  {n:4d}')

    print()
    print('No DB writes were made.')


if __name__ == '__main__':
    main()
