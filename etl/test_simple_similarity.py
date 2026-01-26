"""
Simple test: Can we perform a similarity search on existing embeddings?
If yes, they're stored correctly as VECTOR type (regardless of how Python returns them).
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
print("SIMPLE SIMILARITY SEARCH TEST")
print("=" * 60)

# Count embeddings
count_response = supabase.table('projects').select('application_id', count='exact').not_.is_('abstract_embedding', 'null').execute()
embedding_count = count_response.count
print(f"\nProjects with embeddings: {embedding_count:,}")

if embedding_count == 0:
    print("✗ No embeddings to test with")
    exit()

# Generate a test query
print("\nGenerating query embedding...")
response = openai_client.embeddings.create(
    model="text-embedding-3-small",
    input="cancer drug development"
)
query_embedding = response.data[0].embedding

# Format as pgvector string
query_str = '[' + ','.join(map(str, query_embedding)) + ']'

print("Performing similarity search (cosine distance)...")

try:
    # Use PostgREST select with ordering by distance
    # This will only work if the VECTOR type is properly stored
    # Note: We're using .rpc with raw SQL since PostgREST ordering by distance isn't directly supported

    sql = f"""
    SELECT
        application_id,
        title,
        org_name,
        (abstract_embedding <=> '{query_str}'::vector) as distance
    FROM projects
    WHERE abstract_embedding IS NOT NULL
    ORDER BY abstract_embedding <=> '{query_str}'::vector
    LIMIT 10
    """

    # Check if we can execute this through rpc
    result = supabase.rpc('exec_sql', {'sql': sql}).execute()

    print(f"\n✓ SUCCESS! Found {len(result.data)} similar projects\n")

    print("Top 5 matches:")
    for i, proj in enumerate(result.data[:5], 1):
        print(f"\n{i}. {proj['title'][:80]}...")
        print(f"   Org: {proj.get('org_name', 'N/A')}")
        print(f"   Distance: {float(proj['distance']):.4f}")
        print(f"   ID: {proj['application_id']}")

    print("\n" + "=" * 60)
    print("✓ CONCLUSION: Embeddings ARE stored correctly as VECTOR")
    print("  Similarity search works! The Python client just returns")
    print("  them as strings when querying, but internally they're VECTOR.")
    print("=" * 60)

except Exception as e:
    print(f"\n✗ FAILED: {e}")
    print("\nThis means embeddings are NOT stored correctly as VECTOR type")
    import traceback
    traceback.print_exc()
