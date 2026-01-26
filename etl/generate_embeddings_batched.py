"""
Generate embeddings for existing projects in Supabase.
Processes projects in batches of 1000 (Supabase row limit).
"""

import os
import sys
from dotenv import load_dotenv
load_dotenv('.env.local')

import openai
from supabase import create_client

# Flush output immediately
sys.stdout.flush()

# Initialize clients
print("=" * 60)
print("EMBEDDING GENERATION FOR GRANTED.BIO")
print("=" * 60)
print("\nConnecting to Supabase...", flush=True)
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase", flush=True)

openai_client = openai.OpenAI(api_key=os.environ['OPENAI_API_KEY'])
model = "text-embedding-3-small"
print(f"✓ OpenAI client ready (model: {model})", flush=True)

# Check total count
print("\nChecking total projects without embeddings...", flush=True)
count_result = supabase.table('projects').select('application_id', count='exact').is_('abstract_embedding', 'null').execute()
total_remaining = count_result.count
print(f"✓ Found {total_remaining:,} total projects needing embeddings\n", flush=True)

# Fetch all abstracts once (more efficient than repeated queries)
print("Fetching all abstracts...", flush=True)
abstract_response = supabase.table('abstracts').select('application_id, abstract_text').limit(50000).execute()
abstracts_map = {a['application_id']: a['abstract_text'] for a in abstract_response.data}
print(f"✓ Loaded {len(abstracts_map):,} abstracts\n", flush=True)

# Statistics
total_cost = 0.0
total_tokens = 0
total_generated = 0
total_errors = 0
batch_num = 0

print("=" * 60)
print("STARTING EMBEDDING GENERATION")
print("=" * 60)
print(f"Total projects: {total_remaining:,}")
print(f"Batch size: 1000 projects")
print(f"Estimated cost: ${total_remaining * 0.000021:.2f}")
print(f"Estimated time: ~{total_remaining * 0.5 / 3600:.1f} hours\n", flush=True)

while True:
    batch_num += 1

    # Fetch next batch of 1000 projects without embeddings
    print(f"\n{'='*60}")
    print(f"BATCH {batch_num}")
    print(f"{'='*60}", flush=True)

    response = supabase.table('projects').select(
        'application_id, title, phr, terms'
    ).is_('abstract_embedding', 'null').limit(1000).execute()

    projects = response.data
    batch_size = len(projects)

    if batch_size == 0:
        print("✓ No more projects to process!", flush=True)
        break

    print(f"Processing {batch_size} projects in this batch...", flush=True)

    batch_cost = 0
    batch_generated = 0
    batch_errors = 0

    for i, project in enumerate(projects):
        if i % 100 == 0:
            print(f"  [{i}/{batch_size}] Batch cost: ${batch_cost:.2f}, Errors: {batch_errors}", flush=True)

        try:
            app_id = project['application_id']

            # Create embedding text
            text = f"{project.get('title', '')} {project.get('phr', '')} {project.get('terms', '')} {abstracts_map.get(app_id, '')}"
            text = text[:8000]

            if not text.strip():
                continue

            # Generate embedding
            embedding_response = openai_client.embeddings.create(
                model=model,
                input=text
            )

            embedding = embedding_response.data[0].embedding
            tokens_used = embedding_response.usage.total_tokens
            cost = (tokens_used / 1000) * 0.00002

            batch_cost += cost
            total_cost += cost
            total_tokens += tokens_used

            # Update project
            supabase.table('projects').update({
                'abstract_embedding': embedding
            }).eq('application_id', app_id).execute()

            batch_generated += 1
            total_generated += 1

        except Exception as e:
            batch_errors += 1
            total_errors += 1
            if total_errors <= 20:  # Only print first 20 errors
                print(f"  ERROR on {project.get('application_id')}: {str(e)[:80]}", flush=True)

    print(f"\n✓ Batch {batch_num} complete:", flush=True)
    print(f"  Generated: {batch_generated}/{batch_size}")
    print(f"  Errors: {batch_errors}")
    print(f"  Batch cost: ${batch_cost:.2f}")
    print(f"  Running total: {total_generated:,} embeddings, ${total_cost:.2f}", flush=True)

print(f"\n{'='*60}")
print(f"EMBEDDING GENERATION COMPLETE")
print(f"{'='*60}")
print(f"Total embeddings generated: {total_generated:,}")
print(f"Total errors: {total_errors}")
print(f"Success rate: {(total_generated/(total_generated+total_errors)*100) if (total_generated+total_errors) > 0 else 0:.1f}%")
print(f"Total tokens: {total_tokens:,}")
print(f"Total cost: ${total_cost:.2f}")
print(f"Average cost per project: ${total_cost/max(total_generated,1):.6f}")
print(f"{'='*60}", flush=True)
