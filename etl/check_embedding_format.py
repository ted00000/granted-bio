"""
Check the actual format of the embedding data.
"""

import os
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

# Connect to Supabase
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

print("Fetching sample embedding...")

# Get a sample with embedding
sample = supabase.table('projects').select('application_id, title, abstract_embedding').not_.is_('abstract_embedding', 'null').limit(1).execute()

if sample.data and len(sample.data) > 0:
    project = sample.data[0]
    embedding = project['abstract_embedding']

    print(f"\nProject: {project['application_id']}")
    print(f"Title: {project['title'][:60]}...")
    print(f"\nEmbedding type: {type(embedding)}")
    print(f"Embedding value type: {type(embedding[0]) if embedding and len(embedding) > 0 else 'N/A'}")
    print(f"Length: {len(embedding)}")

    if isinstance(embedding, str):
        print("\n✗ Embedding is stored as STRING (should be array)")
        print(f"First 200 chars: {embedding[:200]}")
    elif isinstance(embedding, list):
        print("\n✓ Embedding is stored as LIST")
        print(f"First 10 values: {embedding[:10]}")
        print(f"Value types: {[type(v) for v in embedding[:5]]}")
else:
    print("No embeddings found")
