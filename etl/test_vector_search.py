"""
Test the vector search function end-to-end.
"""

import os
from dotenv import load_dotenv
load_dotenv('.env.local')

import openai
from supabase import create_client

# Initialize clients
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
openai_client = openai.OpenAI(api_key=os.environ['OPENAI_API_KEY'])

def generate_embedding(text: str) -> list:
    """Generate embedding for query text."""
    response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return response.data[0].embedding

def test_search(query: str, limit: int = 5):
    """Test vector search with a query."""
    print(f"\n{'='*60}")
    print(f"QUERY: {query}")
    print(f"{'='*60}")

    # Generate embedding
    print("Generating embedding...", end=" ")
    embedding = generate_embedding(query)
    print("done")

    # Call search function
    print("Calling search_projects RPC...", end=" ")
    result = supabase.rpc('search_projects', {
        'query_embedding': embedding,
        'match_threshold': 0.3,
        'match_count': limit,
        'min_biotools_confidence': 0
    }).execute()
    print("done")

    if result.data:
        print(f"\nFound {len(result.data)} results:\n")
        for i, r in enumerate(result.data, 1):
            print(f"{i}. [{r['primary_category']}] {r['title'][:80]}...")
            print(f"   Org: {r['org_name']}")
            print(f"   Similarity: {r['similarity']:.3f}, Confidence: {r['biotools_confidence']}")
            print()
    else:
        print("No results found")

    return result.data

# Test queries
print("\n" + "="*60)
print("VECTOR SEARCH TEST")
print("="*60)

# Test 1: CRISPR
test_search("CRISPR gene editing delivery methods")

# Test 2: Single cell
test_search("single cell RNA sequencing analysis")

# Test 3: Biotools-specific
test_search("novel assay development for protein detection")

print("\n" + "="*60)
print("TEST COMPLETE")
print("="*60)
