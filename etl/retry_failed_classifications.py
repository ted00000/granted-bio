"""
Retry classification for projects that failed during the initial run.
Only processes projects where primary_category_confidence is NULL.
"""

import os
import sys
import json
import time
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client
from anthropic import Anthropic

PROJECTS_PER_API_CALL = 20
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

print("=" * 60)
print("RETRY FAILED CLASSIFICATIONS")
print("=" * 60)

supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase", flush=True)

anthropic_client = Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
model = "claude-3-5-haiku-latest"
print(f"✓ Anthropic client ready", flush=True)

# Load abstracts
abstracts_response = supabase.table('abstracts').select('application_id, abstract_text').limit(100000).execute()
abstracts_map = {a['application_id']: a['abstract_text'] for a in abstracts_response.data}
print(f"✓ Loaded {len(abstracts_map):,} abstracts", flush=True)

# Count failed projects
failed_count = supabase.table('projects').select('application_id', count='exact').is_('primary_category_confidence', 'null').execute()
print(f"\n✓ Found {failed_count.count:,} projects needing classification\n", flush=True)

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

Category definitions:
- biotools: Research tools, instruments, platforms, assays, reagents, enabling technologies
- therapeutics: Drug development, treatments, immunotherapy, gene therapy
- diagnostics: Disease detection, screening tests, diagnostic assays
- medical_device: Implantable devices, surgical tools, therapeutic devices
- digital_health: Health apps, telemedicine, AI diagnostics, wearables
- other: Basic research, epidemiology, health services, policy

Return ONLY the JSON array, no other text."""


def classify_batch_with_retry(projects):
    """Classify with retry logic for overload errors."""
    projects_for_prompt = []
    for p in projects:
        abstract = abstracts_map.get(p['application_id'], '')
        projects_for_prompt.append({
            'application_id': p['application_id'],
            'title': p.get('title', ''),
            'org_name': p.get('org_name', ''),
            'phr': (p.get('phr') or '')[:1000],
            'abstract': abstract[:1500] if abstract else '',
        })

    prompt = BATCH_PROMPT.format(projects_json=json.dumps(projects_for_prompt, indent=2))

    for attempt in range(MAX_RETRIES):
        try:
            message = anthropic_client.messages.create(
                model=model,
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}]
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
            if "529" in str(e) or "overload" in str(e).lower():
                if attempt < MAX_RETRIES - 1:
                    print(f" (retry {attempt + 1}/{MAX_RETRIES})...", end="", flush=True)
                    time.sleep(RETRY_DELAY * (attempt + 1))  # Exponential backoff
                    continue
            return None, str(e)

    return None, "Max retries exceeded"


def update_database(classifications):
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
            print(f"    DB error: {e}")

    return updated


# Main retry loop
total_classified = 0
total_errors = 0
batch_num = 0

while True:
    batch_num += 1

    # Fetch projects that still need classification
    response = supabase.table('projects').select(
        'application_id, title, org_name, phr'
    ).is_('primary_category_confidence', 'null').limit(100).execute()

    projects = response.data
    if not projects:
        print("\n✓ All projects classified!")
        break

    print(f"\nBatch {batch_num}: {len(projects)} projects remaining...", flush=True)

    for i in range(0, len(projects), PROJECTS_PER_API_CALL):
        api_batch = projects[i:i + PROJECTS_PER_API_CALL]
        print(f"  Classifying {len(api_batch)} projects...", end=" ", flush=True)

        results, error = classify_batch_with_retry(api_batch)

        if error:
            print(f"ERROR: {error}")
            total_errors += len(api_batch)
        elif results:
            updated = update_database(results)
            total_classified += updated
            print(f"OK ({updated} updated)")
        else:
            print("No results")
            total_errors += len(api_batch)

    print(f"  Progress: {total_classified:,} classified, {total_errors} errors")

print(f"\n{'='*60}")
print("RETRY COMPLETE")
print("=" * 60)
print(f"Total classified: {total_classified:,}")
print(f"Total errors: {total_errors}")

# Verify
remaining = supabase.table('projects').select('application_id', count='exact').is_('primary_category_confidence', 'null').execute()
print(f"Remaining unclassified: {remaining.count}")
