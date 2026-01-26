"""
Test using RPC with a custom PostgreSQL function to insert vectors.
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

print("Generating test embedding...")
response = openai_client.embeddings.create(
    model="text-embedding-3-small",
    input="test embedding for RPC"
)
embedding = response.data[0].embedding

print(f"Embedding type: {type(embedding)}")
print(f"Embedding length: {len(embedding)}")
print(f"First 5 values: {embedding[:5]}\n")

# Get a test project
test_project = supabase.table('projects').select('application_id').limit(1).execute()
test_id = test_project.data[0]['application_id']

print(f"Testing with project: {test_id}\n")
print("=" * 60)

# Clear existing embedding first
print("Clearing existing embedding...")
supabase.table('projects').update({
    'abstract_embedding': None
}).eq('application_id', test_id).execute()

print("\nTEST: Using RPC with custom PostgreSQL function")
try:
    # Call the custom function via RPC
    supabase.rpc('update_project_embedding', {
        'p_application_id': test_id,
        'p_embedding': embedding
    }).execute()

    # Check what was stored
    result = supabase.table('projects').select('abstract_embedding').eq('application_id', test_id).single().execute()
    stored = result.data['abstract_embedding']

    print(f"✓ Success")
    print(f"  Stored type: {type(stored)}")

    if stored is None:
        print(f"  ✗ FAILED: Stored as NULL")
    elif isinstance(stored, str):
        print(f"  ✗ WRONG FORMAT: Stored as STRING")
        print(f"  Stored length: {len(stored)}")
        print(f"  First 100 chars: {stored[:100]}")
    elif isinstance(stored, list):
        print(f"  ✓ CORRECT FORMAT: Stored as LIST")
        print(f"  Stored length: {len(stored)} dimensions")
        print(f"  First 5 values: {stored[:5]}")

        # Verify it's the correct length
        if len(stored) == 1536:
            print(f"  ✓ CORRECT DIMENSIONS: 1536")
        else:
            print(f"  ✗ WRONG DIMENSIONS: {len(stored)} (expected 1536)")
    else:
        print(f"  ? Unknown format: {type(stored)}")

except Exception as e:
    print(f"✗ Failed: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 60)
print("COMPLETE")
