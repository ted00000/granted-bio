"""
Classify all projects using Claude Haiku API with proper batching.

Sends multiple projects per API call for faster processing.
Uses offset pagination to ensure all projects are processed.
"""

import os
import sys
import json
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client
from anthropic import Anthropic

# Configuration
PROJECTS_PER_API_CALL = 20  # Send 20 projects per Claude call
DB_BATCH_SIZE = 100  # Fetch 100 from DB at a time

# Initialize clients
print("=" * 60)
print("PROJECT CLASSIFICATION WITH CLAUDE HAIKU (BATCHED)")
print("=" * 60)
print("\nInitializing...", flush=True)

supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase", flush=True)

anthropic_client = Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
model = "claude-3-5-haiku-latest"  # Use latest model
print(f"✓ Anthropic client ready (model: {model})", flush=True)

# Get total count
total_result = supabase.table('projects').select('application_id', count='exact').execute()
total_projects = total_result.count
print(f"✓ Total projects: {total_projects:,}\n", flush=True)

# Load abstracts
print("Loading abstracts...", flush=True)
abstracts_response = supabase.table('abstracts').select('application_id, abstract_text').limit(100000).execute()
abstracts_map = {a['application_id']: a['abstract_text'] for a in abstracts_response.data}
print(f"✓ Loaded {len(abstracts_map):,} abstracts\n", flush=True)

# Prompt template for batch classification
BATCH_PROMPT = """Classify each of these NIH grants. Return a JSON array with one object per project.

Projects to classify:
{projects_json}

For each project, return:
{{
  "application_id": "the project's application_id",
  "primary_category": "biotools|therapeutics|diagnostics|medical_device|digital_health|other",
  "category_confidence": 0-100,
  "org_type": "company|university|hospital|research_institute|other"
}}

## ACTIVITY CODE PRE-FILTER (Check FIRST!)
These activity codes ALWAYS = "other" regardless of content:
- T32, T34, T35, TL1, TL4 (Training), F30-F33, F99 (Fellowships)
- K01, K02, K05, K07, K08, K12, K22-K26, K43, K76, K99, KL2 (Career dev)
- P30, P50, P51 (Centers), S10, G20 (Equipment), U13, R13 (Conferences)

## Category definitions:
- biotools: DEVELOPING research tools, assays, platforms, methods. OUTPUT = a tool for researchers.
- therapeutics: DEVELOPING drugs/treatments. OUTPUT = therapy for patients. NOT behavioral interventions.
- diagnostics: DEVELOPING tests for disease detection. OUTPUT = clinical diagnostic.
- medical_device: DEVELOPING physical devices for patient treatment. Must be MEDICAL.
- digital_health: DEPLOYING software/apps for patient care. Telemedicine platforms.
- other: Training grants, basic research, health services, behavioral interventions, epidemiology, infrastructure, non-medical research.

## CRITICAL DISTINCTION - Tool development vs Tool application:
- "Developing a CRISPR screening platform" → biotools (creating the tool)
- "Using CRISPR to treat sickle cell disease" → therapeutics (using tool for treatment)
- "Creating an assay for drug discovery" → biotools (the assay IS the output)
- "Drug discovery using high-throughput screening" → therapeutics (drug IS the output)

## What IS vs ISN'T "other":
USE "other" for: Training/fellowships, basic science ("understanding mechanisms"), behavioral interventions, mental health services, health disparities, epidemiology, cohort studies, recruitment methodologies, non-medical robotics.

## Organization type definitions:
- company: Commercial entities (Inc., LLC, Corp., Therapeutics, Biosciences)
- university: Academic institutions
- hospital: Medical centers, health systems, clinics
- research_institute: Independent research orgs (Broad, Scripps, cancer centers)
- other: Government agencies, non-profits

Return ONLY the JSON array, no other text."""


def classify_batch(projects):
    """Classify a batch of projects with a single API call."""
    # Prepare projects for the prompt
    projects_for_prompt = []
    for p in projects:
        abstract = abstracts_map.get(p['application_id'], '')
        projects_for_prompt.append({
            'application_id': p['application_id'],
            'title': p.get('title', ''),
            'org_name': p.get('org_name', ''),
            'phr': (p.get('phr') or '')[:1000],  # Limit length
            'abstract': abstract[:1500] if abstract else '',  # Limit length
        })

    prompt = BATCH_PROMPT.format(projects_json=json.dumps(projects_for_prompt, indent=2))

    try:
        message = anthropic_client.messages.create(
            model=model,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}]
        )

        # Parse response
        text = message.content[0].text.strip()

        # Handle markdown code blocks
        if text.startswith('```json'):
            text = text[7:]
        if text.startswith('```'):
            text = text[3:]
        if text.endswith('```'):
            text = text[:-3]
        text = text.strip()

        results = json.loads(text)
        return results, None

    except Exception as e:
        return None, str(e)


def update_database(classifications):
    """Update the database with classification results."""
    valid_categories = ['biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']
    valid_org_types = ['company', 'university', 'hospital', 'research_institute', 'other']

    updated = 0
    for c in classifications:
        try:
            app_id = c.get('application_id')
            if not app_id:
                continue

            category = c.get('primary_category', 'other').lower()
            if category not in valid_categories:
                category = 'other'

            org_type = c.get('org_type', 'other').lower()
            if org_type not in valid_org_types:
                org_type = 'other'

            confidence = float(c.get('category_confidence', 50))
            confidence = max(0, min(100, confidence))

            supabase.table('projects').update({
                'primary_category': category,
                'primary_category_confidence': confidence,
                'org_type': org_type
            }).eq('application_id', app_id).execute()

            updated += 1
        except Exception as e:
            print(f"    DB error for {c.get('application_id')}: {e}")

    return updated


# Statistics
total_classified = 0
total_errors = 0
total_cost = 0.0
offset = 0

print("=" * 60)
print("STARTING CLASSIFICATION")
print("=" * 60)
api_calls_needed = (total_projects + PROJECTS_PER_API_CALL - 1) // PROJECTS_PER_API_CALL
print(f"Projects per API call: {PROJECTS_PER_API_CALL}")
print(f"Estimated API calls: {api_calls_needed:,}")
print(f"Estimated time: ~{api_calls_needed * 3 / 60:.1f} minutes")
print(f"Estimated cost: ~${total_projects * 0.0003:.2f}\n", flush=True)

while offset < total_projects:
    batch_num = offset // DB_BATCH_SIZE + 1
    print(f"\n{'='*60}")
    print(f"BATCH {batch_num} (offset {offset:,})")
    print(f"{'='*60}", flush=True)

    # Fetch projects from database
    response = supabase.table('projects').select(
        'application_id, title, org_name, phr'
    ).range(offset, offset + DB_BATCH_SIZE - 1).execute()

    projects = response.data
    if not projects:
        print("No more projects to fetch.")
        break

    print(f"Fetched {len(projects)} projects from database", flush=True)

    # Process in smaller batches for API calls
    batch_classified = 0
    batch_errors = 0

    for i in range(0, len(projects), PROJECTS_PER_API_CALL):
        api_batch = projects[i:i + PROJECTS_PER_API_CALL]
        api_batch_num = i // PROJECTS_PER_API_CALL + 1
        total_api_batches = (len(projects) + PROJECTS_PER_API_CALL - 1) // PROJECTS_PER_API_CALL

        print(f"  API call {api_batch_num}/{total_api_batches}: classifying {len(api_batch)} projects...", end=" ", flush=True)

        results, error = classify_batch(api_batch)

        if error:
            print(f"ERROR: {error}")
            batch_errors += len(api_batch)
            total_errors += len(api_batch)
            continue

        if results:
            updated = update_database(results)
            batch_classified += updated
            total_classified += updated

            # Estimate cost
            cost = len(api_batch) * 0.0003
            total_cost += cost

            print(f"OK ({updated} updated)")
        else:
            print("No results returned")
            batch_errors += len(api_batch)
            total_errors += len(api_batch)

    print(f"\n✓ Batch {batch_num} complete: {batch_classified} classified, {batch_errors} errors")
    print(f"  Progress: {total_classified:,} / {total_projects:,} ({total_classified/total_projects*100:.1f}%)")
    print(f"  Total cost: ${total_cost:.2f}", flush=True)

    offset += DB_BATCH_SIZE

print(f"\n{'='*60}")
print("CLASSIFICATION COMPLETE")
print("=" * 60)
print(f"Total classified: {total_classified:,}")
print(f"Total errors: {total_errors}")
print(f"Total cost: ${total_cost:.2f}")

# Get final distribution
print(f"\n{'='*60}")
print("FINAL CATEGORY DISTRIBUTION")
print("=" * 60)
for cat in ['biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']:
    result = supabase.table('projects').select('application_id', count='exact').eq('primary_category', cat).execute()
    pct = (result.count / total_projects * 100) if total_projects > 0 else 0
    print(f"  {cat:20} {result.count:6,} ({pct:5.1f}%)")

print(f"\n{'='*60}")
print("FINAL ORG TYPE DISTRIBUTION")
print("=" * 60)
for org in ['company', 'university', 'hospital', 'research_institute', 'other']:
    result = supabase.table('projects').select('application_id', count='exact').eq('org_type', org).execute()
    pct = (result.count / total_projects * 100) if total_projects > 0 else 0
    print(f"  {org:20} {result.count:6,} ({pct:5.1f}%)")

print("\n" + "=" * 60)
