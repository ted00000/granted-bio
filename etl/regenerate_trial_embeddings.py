"""
Regenerate embeddings for clinical studies using enriched data.
Uses: study_title + conditions + brief_summary for richer semantic search.

Usage:
    python etl/regenerate_trial_embeddings.py           # Only trials missing embeddings
    python etl/regenerate_trial_embeddings.py --refresh # Re-embed ALL trials
    python etl/regenerate_trial_embeddings.py --limit 100  # Test with 100 trials
"""

import os
import sys
import argparse
from dotenv import load_dotenv
load_dotenv('.env.local')

import openai
from supabase import create_client

# Flush output immediately
sys.stdout.flush()

# Parse arguments
parser = argparse.ArgumentParser()
parser.add_argument('--refresh', action='store_true', help='Re-embed all trials regardless of existing embeddings')
parser.add_argument('--limit', type=int, help='Limit number of trials to process')
args = parser.parse_args()

# Initialize clients
print("=" * 60)
print("CLINICAL TRIAL EMBEDDING REGENERATION")
print("Using: study_title + conditions + brief_summary")
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


def build_embedding_text(study: dict) -> str:
    """Build rich text for embedding from multiple fields."""
    parts = []

    # Title is primary
    title = study.get('study_title', '')
    if title and title.strip():
        parts.append(title.strip())

    # Conditions array - these often contain synonyms like "Scleroderma" vs "Systemic Sclerosis"
    conditions = study.get('conditions')
    if conditions and isinstance(conditions, list):
        conditions_text = ', '.join(conditions[:10])  # Limit to 10 conditions
        if conditions_text:
            parts.append(f"Conditions: {conditions_text}")

    # Brief summary provides context
    brief_summary = study.get('brief_summary', '')
    if brief_summary and brief_summary.strip():
        # Truncate long summaries
        summary = brief_summary.strip()[:1000]
        parts.append(summary)

    return ' | '.join(parts)


# Check total count
print("\nChecking total clinical studies...", flush=True)
total_result = supabase.table('clinical_studies').select('nct_id', count='exact').execute()
total_studies = total_result.count
print(f"✓ Found {total_studies:,} total clinical studies", flush=True)

# Determine which trials to process
if args.refresh:
    print("Mode: REFRESH - Re-embedding ALL trials", flush=True)
    # Get count of all trials
    total_remaining = total_studies
else:
    print("Mode: INCREMENTAL - Only trials without embeddings", flush=True)
    # Check how many need embeddings
    try:
        without_embed = supabase.table('clinical_studies').select('nct_id', count='exact').is_('study_embedding', 'null').execute()
        total_remaining = without_embed.count
    except:
        total_remaining = total_studies

print(f"✓ {total_remaining:,} clinical studies to process\n", flush=True)

if total_remaining == 0:
    print("All clinical studies already have embeddings! Nothing to do.")
    print("Use --refresh to regenerate all embeddings.")
    sys.exit(0)

# Statistics
total_cost = 0.0
total_tokens = 0
total_generated = 0
total_errors = 0
total_skipped = 0
batch_num = 0
BATCH_SIZE = 500
current_offset = 0  # For pagination in refresh mode

print("=" * 60)
print("STARTING EMBEDDING REGENERATION")
print("=" * 60)
effective_limit = args.limit if args.limit else total_remaining
print(f"Trials to process: {effective_limit:,}")
print(f"Batch size: {BATCH_SIZE}")
print(f"Estimated cost: ${effective_limit * 0.00003:.2f}")  # ~3x more text
print(f"Estimated time: ~{effective_limit * 0.3 / 60:.1f} minutes\n", flush=True)

while total_generated + total_errors < effective_limit:
    batch_num += 1

    print(f"\n{'='*60}")
    print(f"BATCH {batch_num}")
    print(f"{'='*60}", flush=True)

    # Fetch batch with enriched fields
    try:
        query = supabase.table('clinical_studies').select(
            'nct_id, project_number, study_title, conditions, brief_summary'
        )

        if args.refresh:
            # Use offset pagination for refresh mode
            query = query.range(current_offset, current_offset + BATCH_SIZE - 1)
            current_offset += BATCH_SIZE
        else:
            # For incremental mode, just get nulls (they get updated, so next batch is different)
            query = query.is_('study_embedding', 'null').limit(BATCH_SIZE)

        response = query.execute()
    except Exception as e:
        print(f"ERROR fetching batch: {e}", flush=True)
        break

    studies = response.data
    batch_size = len(studies)

    if batch_size == 0:
        print("✓ No more clinical studies to process!", flush=True)
        break

    print(f"Processing {batch_size} clinical studies...", flush=True)

    batch_cost = 0
    batch_generated = 0
    batch_errors = 0
    batch_skipped = 0

    for i, study in enumerate(studies):
        if i % 100 == 0:
            print(f"  [{i}/{batch_size}] Generated: {batch_generated}, Errors: {batch_errors}, Cost: ${batch_cost:.4f}", flush=True)

        try:
            nct_id = study['nct_id']
            project_number = study.get('project_number', '') or ''

            # Build rich embedding text
            embedding_text = build_embedding_text(study)

            if not embedding_text or len(embedding_text) < 10:
                batch_skipped += 1
                total_skipped += 1
                continue

            # Generate embedding
            embedding_response = openai_client.embeddings.create(
                model=model,
                input=embedding_text[:8000]  # OpenAI limit
            )

            embedding = embedding_response.data[0].embedding
            tokens_used = embedding_response.usage.total_tokens
            cost = (tokens_used / 1000) * 0.00002

            batch_cost += cost
            total_cost += cost
            total_tokens += tokens_used

            # Update clinical study with vector
            supabase.table('clinical_studies').update({
                'study_embedding': embedding
            }).eq('nct_id', nct_id).eq('project_number', project_number).execute()

            batch_generated += 1
            total_generated += 1

            # Check limit
            if args.limit and total_generated >= args.limit:
                print(f"\n✓ Reached limit of {args.limit} trials", flush=True)
                break

        except Exception as e:
            batch_errors += 1
            total_errors += 1
            if total_errors <= 20:
                print(f"  ERROR on {study.get('nct_id')}: {str(e)[:80]}", flush=True)

    print(f"\n✓ Batch {batch_num} complete:", flush=True)
    print(f"  Generated: {batch_generated}")
    print(f"  Skipped: {batch_skipped}")
    print(f"  Errors: {batch_errors}")
    print(f"  Batch cost: ${batch_cost:.4f}")
    print(f"  Running total: {total_generated:,} embeddings, ${total_cost:.4f}", flush=True)

    if args.limit and total_generated >= args.limit:
        break

print(f"\n{'='*60}")
print(f"EMBEDDING REGENERATION COMPLETE")
print(f"{'='*60}")
print(f"Total embeddings generated: {total_generated:,}")
print(f"Total skipped: {total_skipped:,}")
print(f"Total errors: {total_errors}")
if total_generated + total_errors > 0:
    print(f"Success rate: {(total_generated/(total_generated+total_errors)*100):.1f}%")
print(f"Total tokens: {total_tokens:,}")
print(f"Total cost: ${total_cost:.4f}")
if total_generated > 0:
    print(f"Average cost per study: ${total_cost/total_generated:.6f}")
print(f"{'='*60}", flush=True)
