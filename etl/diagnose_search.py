"""
Diagnose semantic search issues.
Tests different query variations and thresholds to understand recall behavior.
"""

import os
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client
import openai

# Connect
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

openai_client = openai.OpenAI(api_key=os.environ['OPENAI_API_KEY'])

print("=" * 70)
print("SEARCH DIAGNOSTIC REPORT")
print("=" * 70)

# 1. Check embedding coverage
print("\n[1] EMBEDDING COVERAGE")
print("-" * 70)

total = supabase.table('projects').select('application_id', count='exact').execute().count
with_embed = supabase.table('projects').select('application_id', count='exact').not_.is_('abstract_embedding', 'null').execute().count
bio_related = supabase.table('projects').select('application_id', count='exact').eq('is_bio_related', True).execute().count
bio_with_embed = supabase.table('projects').select('application_id', count='exact').eq('is_bio_related', True).not_.is_('abstract_embedding', 'null').execute().count

print(f"  Total projects: {total:,}")
print(f"  With embeddings: {with_embed:,} ({100*with_embed/total:.1f}%)")
print(f"  Bio-related: {bio_related:,}")
print(f"  Bio-related with embeddings: {bio_with_embed:,} ({100*bio_with_embed/bio_related:.1f}%)")

# 2. Test keyword search (baseline)
print("\n[2] KEYWORD SEARCH (BASELINE)")
print("-" * 70)

keyword_queries = ["CAR-T", "CAR T", "CART", "chimeric antigen receptor"]
for kw in keyword_queries:
    title_match = supabase.table('projects').select('application_id', count='exact').ilike('title', f'%{kw}%').execute().count
    phr_match = supabase.table('projects').select('application_id', count='exact').ilike('phr', f'%{kw}%').execute().count
    print(f"  '{kw}': {title_match} in title, {phr_match} in PHR")

# 3. Test semantic search with different query formulations
print("\n[3] SEMANTIC SEARCH - QUERY VARIATIONS")
print("-" * 70)

queries = [
    "CAR-T",
    "CAR-T cell therapy",
    "CAR-T cell therapy development and engineering for cancer treatment",
    "chimeric antigen receptor T-cell therapy",
]

for query in queries:
    print(f"\n  Query: '{query}'")

    # Generate embedding
    response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=query
    )
    query_embedding = response.data[0].embedding

    # Test at different thresholds
    for threshold in [0.0, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35]:
        result = supabase.rpc('search_projects_filtered', {
            'query_embedding': query_embedding,
            'match_threshold': threshold,
            'match_count': 1000,
            'min_biotools_confidence': 0,
            'filter_fiscal_years': None,
            'filter_categories': None,
            'filter_org_types': None,
            'filter_states': None,
            'filter_min_funding': None,
            'filter_max_funding': None
        }).execute()

        count = len(result.data)
        top_sim = result.data[0]['similarity'] if result.data else 0
        min_sim = result.data[-1]['similarity'] if result.data else 0

        print(f"    threshold={threshold}: {count} results (sim: {min_sim:.3f} - {top_sim:.3f})")

# 4. Check IVFFlat index
print("\n[4] INDEX CHECK")
print("-" * 70)
print("  Note: Run this in Supabase SQL Editor:")
print("  SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'projects';")
print("  SHOW ivfflat.probes;")

# 5. Sample similarity scores
print("\n[5] SAMPLE SIMILARITY DISTRIBUTION")
print("-" * 70)
print("  Testing 'CAR-T' query at threshold 0.0 to see full distribution...")

response = openai_client.embeddings.create(
    model="text-embedding-3-small",
    input="CAR-T"
)
query_embedding = response.data[0].embedding

result = supabase.rpc('search_projects_filtered', {
    'query_embedding': query_embedding,
    'match_threshold': 0.0,
    'match_count': 100,
    'min_biotools_confidence': 0,
    'filter_fiscal_years': None,
    'filter_categories': None,
    'filter_org_types': None,
    'filter_states': None,
    'filter_min_funding': None,
    'filter_max_funding': None
}).execute()

print(f"  Total results at threshold 0.0: {len(result.data)}")

if result.data:
    # Group by similarity ranges
    ranges = {'0.4+': 0, '0.3-0.4': 0, '0.2-0.3': 0, '0.1-0.2': 0, '0-0.1': 0}
    for r in result.data:
        sim = r['similarity']
        if sim >= 0.4:
            ranges['0.4+'] += 1
        elif sim >= 0.3:
            ranges['0.3-0.4'] += 1
        elif sim >= 0.2:
            ranges['0.2-0.3'] += 1
        elif sim >= 0.1:
            ranges['0.1-0.2'] += 1
        else:
            ranges['0-0.1'] += 1

    print("  Similarity distribution:")
    for r, c in ranges.items():
        print(f"    {r}: {c}")

    print("\n  Top 5 matches:")
    for i, r in enumerate(result.data[:5], 1):
        print(f"    {i}. sim={r['similarity']:.3f} | {r['title'][:60]}...")

print("\n" + "=" * 70)
print("DIAGNOSIS COMPLETE")
print("=" * 70)
