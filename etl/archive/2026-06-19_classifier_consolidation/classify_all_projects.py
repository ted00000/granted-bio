"""
Classify all projects using Claude Haiku API.

Processes projects in batches and updates the database with:
- primary_category
- primary_category_confidence
- org_type
"""

import os
import sys
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client
from anthropic import Anthropic

# Flush output immediately
sys.stdout.flush()

# Initialize clients
print("=" * 60)
print("PROJECT CLASSIFICATION WITH CLAUDE HAIKU")
print("=" * 60)
print("\nConnecting to Supabase...", flush=True)
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase", flush=True)

anthropic_client = Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])
model = "claude-3-5-haiku-20241022"
print(f"✓ Anthropic client ready (model: {model})", flush=True)

# Check total count
print("\nChecking total projects to classify...", flush=True)
count_result = supabase.table('projects').select('application_id', count='exact').execute()
total_projects = count_result.count
print(f"✓ Found {total_projects:,} total projects\n", flush=True)

# Fetch all abstracts once (more efficient)
print("Fetching all abstracts...", flush=True)
abstract_response = supabase.table('abstracts').select('application_id, abstract_text').limit(100000).execute()
abstracts_map = {a['application_id']: a['abstract_text'] for a in abstract_response.data}
print(f"✓ Loaded {len(abstracts_map):,} abstracts\n", flush=True)

# Classification prompt template
PROMPT_TEMPLATE = """Analyze this NIH grant and classify it. Return only valid JSON, no other text.

Project Data:
Title: {title}
Organization: {org_name}
Abstract: {abstract}
Public Health Relevance: {phr}
Keywords: {terms}

Return JSON in this exact format:
{{
  "primary_category": "biotools|therapeutics|diagnostics|medical_device|digital_health|other",
  "category_confidence": 0-100,
  "org_type": "company|university|hospital|research_institute|other"
}}

Category Definitions:
- biotools: Research tools, instruments, platforms, assays, reagents, enabling technologies
- therapeutics: Drug development, treatments, immunotherapy, gene therapy, therapeutic compounds
- diagnostics: Disease detection, screening tests, diagnostic assays, biomarker discovery
- medical_device: Implantable devices, surgical tools, prosthetics, therapeutic devices for patients
- digital_health: Health apps, telemedicine, AI diagnostics, wearables, digital therapeutics
- other: Basic research, epidemiology, health services, policy, education

Organization Type Definitions:
- company: Commercial entities, small businesses, biotech/pharma companies
- university: Academic institutions, colleges, universities
- hospital: Medical centers, clinical institutions, healthcare providers
- research_institute: Independent research organizations, national labs
- other: Government agencies, non-profits, foundations"""

# Statistics
total_cost = 0.0
total_classified = 0
total_errors = 0
batch_num = 0

# Category tracking
category_counts = {
    'biotools': 0,
    'therapeutics': 0,
    'diagnostics': 0,
    'medical_device': 0,
    'digital_health': 0,
    'other': 0
}
org_type_counts = {}

print("=" * 60)
print("STARTING CLASSIFICATION")
print("=" * 60)
print(f"Total projects: {total_projects:,}")
print(f"Batch size: 100 projects")
print(f"Estimated cost: ${total_projects * 0.00025:.2f}")
print(f"Estimated time: ~{total_projects * 2 / 3600:.1f} hours\n", flush=True)

while True:
    batch_num += 1

    # Fetch next batch of 100 projects
    print(f"\n{'='*60}")
    print(f"BATCH {batch_num}")
    print(f"{'='*60}", flush=True)

    response = supabase.table('projects').select(
        'application_id, title, org_name, phr, terms'
    ).limit(100).execute()

    projects = response.data
    batch_size = len(projects)

    if batch_size == 0:
        print("✓ No more projects to process!", flush=True)
        break

    print(f"Processing {batch_size} projects in this batch...", flush=True)

    batch_cost = 0
    batch_classified = 0
    batch_errors = 0

    for i, project in enumerate(projects):
        if i % 10 == 0:
            print(f"  [{i}/{batch_size}] Batch cost: ${batch_cost:.3f}, Errors: {batch_errors}", flush=True)

        try:
            app_id = project['application_id']

            # Get abstract
            abstract = abstracts_map.get(app_id, '')

            # Build prompt
            prompt = PROMPT_TEMPLATE.format(
                title=project.get('title', 'N/A'),
                org_name=project.get('org_name', 'N/A'),
                abstract=abstract[:5000] if abstract else 'N/A',  # Limit abstract length
                phr=project.get('phr', 'N/A'),
                terms=project.get('terms', 'N/A')
            )

            # Call Claude API
            message = anthropic_client.messages.create(
                model=model,
                max_tokens=256,
                messages=[{"role": "user", "content": prompt}]
            )

            # Parse response
            text_content = next((block.text for block in message.content if hasattr(block, 'text')), None)
            if not text_content:
                raise Exception("No text in response")

            # Handle markdown code blocks
            json_text = text_content.strip()
            if json_text.startswith('```json'):
                json_text = json_text.replace('```json\n', '').replace('\n```', '')
            elif json_text.startswith('```'):
                json_text = json_text.replace('```\n', '').replace('\n```', '')

            import json
            result = json.loads(json_text)

            # Validate and normalize
            valid_categories = ['biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']
            valid_org_types = ['company', 'university', 'hospital', 'research_institute', 'other']

            primary_category = result.get('primary_category', 'other').lower()
            if primary_category not in valid_categories:
                primary_category = 'other'

            org_type = result.get('org_type', 'other').lower()
            if org_type not in valid_org_types:
                org_type = 'other'

            category_confidence = float(result.get('category_confidence', 0))
            category_confidence = max(0, min(100, category_confidence))

            # Update database
            supabase.table('projects').update({
                'primary_category': primary_category,
                'primary_category_confidence': category_confidence,
                'org_type': org_type
            }).eq('application_id', app_id).execute()

            batch_classified += 1
            total_classified += 1

            # Track statistics
            category_counts[primary_category] = category_counts.get(primary_category, 0) + 1
            org_type_counts[org_type] = org_type_counts.get(org_type, 0) + 1

            # Estimate cost (rough)
            # Input: ~500 tokens, Output: ~100 tokens
            cost = (500 * 0.25 / 1_000_000) + (100 * 1.25 / 1_000_000)
            batch_cost += cost
            total_cost += cost

        except Exception as e:
            batch_errors += 1
            total_errors += 1
            if batch_errors <= 5:  # Only print first 5 errors per batch
                print(f"  Error classifying {app_id}: {e}", flush=True)

    print(f"\n✓ Batch {batch_num} complete:")
    print(f"  Classified: {batch_classified}/{batch_size}")
    print(f"  Errors: {batch_errors}")
    print(f"  Batch cost: ${batch_cost:.3f}")
    print(f"  Running total: {total_classified:,} classified, ${total_cost:.2f}", flush=True)

print(f"\n{'='*60}")
print("CLASSIFICATION COMPLETE")
print("=" * 60)
print(f"Total classified: {total_classified:,}")
print(f"Total errors: {total_errors}")
print(f"Total cost: ${total_cost:.2f}")

print("\n" + "=" * 60)
print("CATEGORY DISTRIBUTION")
print("=" * 60)
for category, count in sorted(category_counts.items(), key=lambda x: x[1], reverse=True):
    percentage = (count / total_classified * 100) if total_classified > 0 else 0
    print(f"  {category:20} {count:6,} ({percentage:5.1f}%)")

print("\n" + "=" * 60)
print("ORGANIZATION TYPE DISTRIBUTION")
print("=" * 60)
for org_type, count in sorted(org_type_counts.items(), key=lambda x: x[1], reverse=True):
    percentage = (count / total_classified * 100) if total_classified > 0 else 0
    print(f"  {org_type:20} {count:6,} ({percentage:5.1f}%)")

print("\n" + "=" * 60)
