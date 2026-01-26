"""
Test if vector similarity search actually works with the stored data.
This will tell us if the data is stored correctly as VECTOR type, even if
the Python client returns it as a string.
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
print("TESTING VECTOR SIMILARITY SEARCH")
print("=" * 60)

# Generate a test query embedding
print("\nGenerating test query embedding...")
response = openai_client.embeddings.create(
    model="text-embedding-3-small",
    input="cancer research"
)
query_embedding = response.data[0].embedding

print(f"Query embedding length: {len(query_embedding)}")

# Try to perform a similarity search using RPC
print("\nAttempting similarity search...")
try:
    result = supabase.rpc('match_projects', {
        'query_embedding': query_embedding,
        'match_threshold': 0.5,
        'match_count': 5
    }).execute()

    print(f"✓ SUCCESS: Similarity search works!")
    print(f"  Found {len(result.data)} matches")

    if result.data:
        print("\n  Top match:")
        top = result.data[0]
        print(f"    Title: {top.get('title', 'N/A')[:100]}...")
        print(f"    Similarity: {top.get('similarity', 'N/A')}")

    print("\n✓ CONCLUSION: Embeddings ARE stored correctly as VECTOR type")
    print("  (The Python client just returns them as strings when queried)")

except Exception as e:
    print(f"✗ FAILED: Similarity search does not work")
    print(f"  Error: {e}")
    print("\n✗ CONCLUSION: Embeddings are NOT stored correctly as VECTOR type")

print("\n" + "=" * 60)
