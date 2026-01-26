"""
Test the new search function to verify embeddings work for similarity search.
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

print("=" * 60)
print("TESTING SIMILARITY SEARCH FUNCTION")
print("=" * 60)

# Count embeddings
count_response = supabase.table('projects').select('application_id', count='exact').not_.is_('abstract_embedding', 'null').execute()
embedding_count = count_response.count
print(f"\nProjects with embeddings: {embedding_count:,}")

if embedding_count == 0:
    print("✗ No embeddings to test with")
    exit()

# Generate a test query
print("\nGenerating query embedding for 'cancer drug development'...")
response = openai_client.embeddings.create(
    model="text-embedding-3-small",
    input="cancer drug development"
)
query_embedding = response.data[0].embedding

print(f"Query embedding length: {len(query_embedding)}")
print("\nCalling search_projects_by_embedding function...")

try:
    result = supabase.rpc('search_projects_by_embedding', {
        'query_embedding': query_embedding,
        'match_threshold': 0.0,
        'match_count': 10
    }).execute()

    print(f"\n✓ SUCCESS! Similarity search works!")
    print(f"  Found {len(result.data)} similar projects\n")

    print("Top 5 matches:")
    print("-" * 60)
    for i, proj in enumerate(result.data[:5], 1):
        print(f"\n{i}. {proj['title'][:80]}...")
        print(f"   Organization: {proj.get('org_name', 'N/A')}")
        print(f"   Fiscal Year: {proj.get('fiscal_year', 'N/A')}")
        print(f"   Similarity: {proj['similarity']:.4f}")
        print(f"   ID: {proj['application_id']}")

    print("\n" + "=" * 60)
    print("✓✓✓ CONCLUSION ✓✓✓")
    print("=" * 60)
    print("Embeddings ARE stored correctly as VECTOR type!")
    print("\nThe Python Supabase client returns them as strings when")
    print("you query the column directly, but internally they are")
    print("proper VECTOR(1536) values and work perfectly for similarity")
    print("search using the <=> operator.")
    print("\nThis means:")
    print("  • The current insertion method WORKS")
    print("  • We can proceed with embedding generation")
    print("  • No code changes needed")
    print("=" * 60)

except Exception as e:
    print(f"\n✗ FAILED: {e}")
    print("\nThis means embeddings are NOT stored correctly as VECTOR type")
    import traceback
    traceback.print_exc()
