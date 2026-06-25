"""
Generate embeddings for publications in Supabase. Batched for throughput.

For each batch:
  1. Fetch up to BATCH_SIZE publications with NULL publication_embedding +
     non-null pub_title.
  2. Call OpenAI ONCE with all titles (text-embedding-3-small supports up
     to 2048 inputs per request). Returns one embedding vector per title.
  3. Upsert all rows in ONE Supabase call using on_conflict='pmid' — this
     UPDATEs only the publication_embedding column (other fields untouched).

Throughput vs. the previous per-row implementation: ~50-100x faster.
The previous script made one OpenAI call + one Supabase UPDATE per row;
each round-trip was ~0.3-0.5 sec dominated by network latency. Batching
collapses that to ~2 round-trips per BATCH_SIZE rows.
"""

import os
import sys
import time
from dotenv import load_dotenv
load_dotenv('.env.local')

import openai
from supabase import create_client


BATCH_SIZE = 500              # publications per OpenAI + Supabase round-trip
TITLE_MAX_CHARS = 8000        # truncate before sending to OpenAI
MODEL = "text-embedding-3-small"
COST_PER_1K_TOKENS = 0.00002  # text-embedding-3-small pricing


def main() -> None:
    print("=" * 60)
    print("PUBLICATION EMBEDDING GENERATION (batched)")
    print("=" * 60)

    supabase = create_client(
        os.environ['NEXT_PUBLIC_SUPABASE_URL'],
        os.environ['SUPABASE_SERVICE_KEY'],
    )
    openai_client = openai.OpenAI(api_key=os.environ['OPENAI_API_KEY'])
    print(f"  Model: {MODEL}")
    print(f"  Batch size: {BATCH_SIZE}", flush=True)

    # Count what's left
    remaining = supabase.table('publications').select(
        'pmid', count='estimated', head=True
    ).is_('publication_embedding', 'null').filter('pub_title', 'not.is', 'null').neq('pub_title', '').execute()
    total_remaining = remaining.count or 0
    print(f"\n  Publications needing embedding: {total_remaining:,}")
    print(f"  Estimated cost: ${total_remaining * 0.00002:.2f}\n", flush=True)

    if total_remaining == 0:
        print("All publications already have embeddings. Done.")
        return

    total_generated = 0
    total_tokens = 0
    total_cost = 0.0
    total_errors = 0
    batch_num = 0
    start = time.time()

    while True:
        batch_num += 1

        # Fetch next batch. The filter at SQL level keeps us from looping
        # on rows we can't embed (NULL or empty title).
        page = supabase.table('publications').select('pmid, pub_title').is_(
            'publication_embedding', 'null'
        ).filter('pub_title', 'not.is', 'null').neq(
            'pub_title', ''
        ).limit(BATCH_SIZE).execute()

        rows = page.data or []
        if not rows:
            print("✓ No more publications to process.", flush=True)
            break

        # Prepare titles for OpenAI; preserve pmid alignment
        pmids = [r['pmid'] for r in rows]
        titles = [(r.get('pub_title') or '')[:TITLE_MAX_CHARS] for r in rows]

        # One OpenAI call for the whole batch
        try:
            resp = openai_client.embeddings.create(model=MODEL, input=titles)
        except Exception as e:
            total_errors += len(rows)
            print(f"  Batch {batch_num} OpenAI error ({len(rows)} rows lost this batch): {str(e)[:200]}", flush=True)
            # Without embeddings we can't write; move on to the next batch.
            # On rerun the NULL filter will pick these up again.
            time.sleep(1)
            continue

        # Build upsert payload — one row per publication, only the embedding column
        updates = []
        for i, pmid in enumerate(pmids):
            try:
                emb = resp.data[i].embedding
            except (IndexError, AttributeError) as e:
                total_errors += 1
                print(f"  Missing embedding for pmid={pmid}: {e}", flush=True)
                continue
            updates.append({'pmid': pmid, 'publication_embedding': emb})

        # One Supabase upsert for the whole batch
        try:
            supabase.table('publications').upsert(updates, on_conflict='pmid').execute()
            total_generated += len(updates)
        except Exception as e:
            total_errors += len(updates)
            print(f"  Batch {batch_num} Supabase upsert error: {str(e)[:200]}", flush=True)
            continue

        tokens = resp.usage.total_tokens if resp.usage else 0
        cost = (tokens / 1000) * COST_PER_1K_TOKENS
        total_tokens += tokens
        total_cost += cost

        # Cadence-controlled progress logging — every 5 batches or first/last
        if batch_num % 5 == 1 or len(rows) < BATCH_SIZE:
            elapsed = time.time() - start
            rate = total_generated / elapsed if elapsed > 0 else 0
            eta_sec = (total_remaining - total_generated) / rate if rate > 0 else 0
            print(
                f"  Batch {batch_num}: +{len(updates)} embeddings | "
                f"running total {total_generated:,} | "
                f"${total_cost:.4f} | "
                f"rate {rate:.1f}/sec | "
                f"ETA {eta_sec / 60:.1f} min",
                flush=True,
            )

    elapsed = time.time() - start
    print()
    print("=" * 60)
    print(f"DONE — {total_generated:,} embeddings in {elapsed / 60:.1f} min")
    print(f"  Tokens: {total_tokens:,}")
    print(f"  Cost:   ${total_cost:.4f}")
    print(f"  Errors: {total_errors}")
    print("=" * 60)


if __name__ == '__main__':
    main()
