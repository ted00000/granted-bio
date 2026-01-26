"""
Generate embeddings for existing projects in Supabase.
Processes all projects that don't have embeddings yet.
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

print("\nFetching projects without embeddings...", flush=True)
# Fetch ALL projects that don't have embeddings (Supabase default limit is 1000, so we need to set a higher range)
response = supabase.table('projects').select(
    'application_id, title, phr, terms'
).is_('abstract_embedding', 'null').limit(50000).execute()  # Set high limit to get all projects

projects = response.data
print(f"✓ Found {len(projects):,} projects needing embeddings", flush=True)

# Fetch abstracts
print("Fetching abstracts...", flush=True)
abstract_response = supabase.table('abstracts').select('application_id, abstract_text').execute()
abstracts_map = {a['application_id']: a['abstract_text'] for a in abstract_response.data}
print(f"✓ Loaded {len(abstracts_map):,} abstracts\n", flush=True)

total_cost = 0.0
total_tokens = 0
embeddings_generated = 0
errors = 0

print("=" * 60)
print("STARTING EMBEDDING GENERATION")
print("=" * 60)
print(f"Total projects: {len(projects):,}")
print(f"Model: {model}")
print(f"Estimated cost: ${len(projects) * 0.000021:.2f}")
print(f"Estimated time: ~{len(projects) * 0.5 / 60:.0f} minutes\n", flush=True)

for i, project in enumerate(projects):
    if i % 100 == 0:
        progress_pct = (i / len(projects)) * 100 if len(projects) > 0 else 0
        print(f"\n[{i:,}/{len(projects):,}] {progress_pct:.1f}% - Cost: ${total_cost:.2f} - Errors: {errors}", flush=True)

    try:
        app_id = project['application_id']

        # Create embedding text from title + phr + terms + abstract
        text = f"{project.get('title', '')} {project.get('phr', '')} {project.get('terms', '')} {abstracts_map.get(app_id, '')}"
        text = text[:8000]  # Truncate

        if not text.strip():
            continue

        # Generate embedding
        response = openai_client.embeddings.create(
            model=model,
            input=text
        )

        embedding = response.data[0].embedding
        tokens_used = response.usage.total_tokens
        cost = (tokens_used / 1000) * 0.00002
        total_cost += cost
        total_tokens += tokens_used

        # Update project with combined embedding (title + phr + terms + abstract)
        supabase.table('projects').update({
            'abstract_embedding': embedding  # Using abstract_embedding for full text search
        }).eq('application_id', app_id).execute()

        embeddings_generated += 1

    except Exception as e:
        errors += 1
        if errors <= 10:  # Only print first 10 errors to avoid spam
            print(f"  ERROR on project {project.get('application_id')}: {str(e)[:100]}", flush=True)

print(f"\n{'='*60}")
print(f"EMBEDDING GENERATION COMPLETE")
print(f"{'='*60}")
print(f"Embeddings generated: {embeddings_generated:,}")
print(f"Errors encountered: {errors}")
print(f"Success rate: {(embeddings_generated/(embeddings_generated+errors)*100) if (embeddings_generated+errors) > 0 else 0:.1f}%")
print(f"Total tokens: {total_tokens:,}")
print(f"Total cost: ${total_cost:.2f}")
print(f"Average cost per project: ${total_cost/max(embeddings_generated,1):.6f}")
print(f"{'='*60}", flush=True)
