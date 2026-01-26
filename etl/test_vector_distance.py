"""
Test if we can calculate vector distance, which proves the data is stored
correctly as VECTOR type (even if Python client returns it as string).
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
print("TESTING VECTOR DISTANCE CALCULATION")
print("=" * 60)

# Generate a test query embedding
print("\nGenerating test query embedding...")
response = openai_client.embeddings.create(
    model="text-embedding-3-small",
    input="cancer research"
)
query_embedding = response.data[0].embedding
query_str = '[' + ','.join(map(str, query_embedding)) + ']'

print(f"Query embedding length: {len(query_embedding)}")

# Try to calculate cosine distance using SQL
print("\nAttempting to calculate cosine distance using SQL...")
try:
    # Use PostgREST to execute raw SQL that calculates distance
    result = supabase.rpc('exec_sql', {
        'sql': f"""
        SELECT
            application_id,
            title,
            abstract_embedding <=> '{query_str}'::vector as distance
        FROM projects
        WHERE abstract_embedding IS NOT NULL
        ORDER BY abstract_embedding <=> '{query_str}'::vector
        LIMIT 5
        """
    }).execute()

    if result.data:
        print(f"✓ SUCCESS: Vector distance calculation works!")
        print(f"  Found {len(result.data)} results")
        print("\n  Top 3 matches:")
        for i, match in enumerate(result.data[:3], 1):
            print(f"\n    {i}. Distance: {match.get('distance', 'N/A')}")
            print(f"       Title: {match.get('title', 'N/A')[:100]}...")
            print(f"       ID: {match.get('application_id', 'N/A')}")

        print("\n✓ CONCLUSION: Embeddings ARE stored correctly as VECTOR type!")
        print("  The Python client returns them as strings, but they work for similarity search.")
    else:
        print(f"✗ No results returned")

except Exception as e:
    print(f"✗ FAILED: Vector distance calculation does not work")
    print(f"  Error: {e}")
    import traceback
    traceback.print_exc()
    print("\n✗ CONCLUSION: Embeddings might NOT be stored correctly as VECTOR type")

print("\n" + "=" * 60)
