"""
Generate embeddings for clinical studies in Supabase.
Processes studies in batches.
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
print("CLINICAL STUDY EMBEDDING GENERATION FOR GRANTED.BIO")
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
print("\nChecking total clinical studies...", flush=True)
total_result = supabase.table('clinical_studies').select('nct_id', count='exact').execute()
total_studies = total_result.count
print(f"✓ Found {total_studies:,} total clinical studies", flush=True)

# Check how many need embeddings
print("Checking clinical studies without embeddings...", flush=True)
try:
    without_embed = supabase.table('clinical_studies').select('nct_id', count='exact').is_('study_embedding', 'null').execute()
    total_remaining = without_embed.count
except:
    # Column might not exist yet, assume all need embeddings
    total_remaining = total_studies
print(f"✓ Found {total_remaining:,} clinical studies needing embeddings\n", flush=True)

if total_remaining == 0:
    print("All clinical studies already have embeddings! Nothing to do.")
    sys.exit(0)

# Statistics
total_cost = 0.0
total_tokens = 0
total_generated = 0
total_errors = 0
batch_num = 0
BATCH_SIZE = 500

print("=" * 60)
print("STARTING CLINICAL STUDY EMBEDDING GENERATION")
print("=" * 60)
print(f"Total clinical studies to process: {total_remaining:,}")
print(f"Batch size: {BATCH_SIZE} studies")
print(f"Estimated cost: ${total_remaining * 0.00001:.2f}")
print(f"Estimated time: ~{total_remaining * 0.3 / 60:.1f} minutes\n", flush=True)

while True:
    batch_num += 1

    # Fetch next batch of studies without embeddings
    print(f"\n{'='*60}")
    print(f"BATCH {batch_num}")
    print(f"{'='*60}", flush=True)

    try:
        response = supabase.table('clinical_studies').select(
            'nct_id, project_number, study_title'
        ).is_('study_embedding', 'null').limit(BATCH_SIZE).execute()
    except Exception as e:
        # If column doesn't exist, select all studies
        print(f"Note: Selecting all studies (column may not exist): {e}", flush=True)
        response = supabase.table('clinical_studies').select(
            'nct_id, project_number, study_title'
        ).limit(BATCH_SIZE).execute()

    studies = response.data
    batch_size = len(studies)

    if batch_size == 0:
        print("✓ No more clinical studies to process!", flush=True)
        break

    print(f"Processing {batch_size} clinical studies in this batch...", flush=True)

    batch_cost = 0
    batch_generated = 0
    batch_errors = 0

    for i, study in enumerate(studies):
        if i % 100 == 0:
            print(f"  [{i}/{batch_size}] Batch cost: ${batch_cost:.4f}, Errors: {batch_errors}", flush=True)

        try:
            nct_id = study['nct_id']
            project_number = study.get('project_number', '')
            study_title = study.get('study_title', '')

            if not study_title or not study_title.strip():
                continue

            # Generate embedding
            embedding_response = openai_client.embeddings.create(
                model=model,
                input=study_title[:8000]
            )

            embedding = embedding_response.data[0].embedding
            tokens_used = embedding_response.usage.total_tokens
            cost = (tokens_used / 1000) * 0.00002

            batch_cost += cost
            total_cost += cost
            total_tokens += tokens_used

            # Update clinical study with vector
            # Use both nct_id and project_number as composite key
            supabase.table('clinical_studies').update({
                'study_embedding': embedding
            }).eq('nct_id', nct_id).eq('project_number', project_number).execute()

            batch_generated += 1
            total_generated += 1

        except Exception as e:
            batch_errors += 1
            total_errors += 1
            if total_errors <= 20:  # Only print first 20 errors
                print(f"  ERROR on {study.get('nct_id')}: {str(e)[:80]}", flush=True)

    print(f"\n✓ Batch {batch_num} complete:", flush=True)
    print(f"  Generated: {batch_generated}/{batch_size}")
    print(f"  Errors: {batch_errors}")
    print(f"  Batch cost: ${batch_cost:.4f}")
    print(f"  Running total: {total_generated:,} embeddings, ${total_cost:.4f}", flush=True)

print(f"\n{'='*60}")
print(f"CLINICAL STUDY EMBEDDING GENERATION COMPLETE")
print(f"{'='*60}")
print(f"Total embeddings generated: {total_generated:,}")
print(f"Total errors: {total_errors}")
print(f"Success rate: {(total_generated/(total_generated+total_errors)*100) if (total_generated+total_errors) > 0 else 0:.1f}%")
print(f"Total tokens: {total_tokens:,}")
print(f"Total cost: ${total_cost:.4f}")
print(f"Average cost per study: ${total_cost/max(total_generated,1):.6f}")
print(f"{'='*60}", flush=True)
