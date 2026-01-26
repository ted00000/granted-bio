"""
Quick script to verify embeddings are being generated successfully.
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

print("=" * 60)
print("EMBEDDING VERIFICATION CHECK")
print("=" * 60)

# 1. Count total projects
total_response = supabase.table('projects').select('application_id', count='exact').execute()
total_projects = total_response.count

# 2. Count projects WITH embeddings
with_embeddings = supabase.table('projects').select('application_id', count='exact').not_.is_('abstract_embedding', 'null').execute()
projects_with_embeddings = with_embeddings.count

# 3. Count projects WITHOUT embeddings
without_embeddings = supabase.table('projects').select('application_id', count='exact').is_('abstract_embedding', 'null').execute()
projects_without_embeddings = without_embeddings.count

print(f"\nTotal projects: {total_projects:,}")
print(f"Projects WITH embeddings: {projects_with_embeddings:,} ({projects_with_embeddings/total_projects*100:.1f}%)")
print(f"Projects WITHOUT embeddings: {projects_without_embeddings:,} ({projects_without_embeddings/total_projects*100:.1f}%)")

# 4. Get a sample embedding to verify format
print("\n" + "=" * 60)
print("SAMPLE EMBEDDING CHECK")
print("=" * 60)

sample = supabase.table('projects').select('application_id, title, abstract_embedding').not_.is_('abstract_embedding', 'null').limit(1).execute()

if sample.data and len(sample.data) > 0:
    project = sample.data[0]
    embedding = project['abstract_embedding']

    print(f"\nSample project: {project['application_id']}")
    print(f"Title: {project['title'][:80]}...")
    print(f"\nEmbedding dimensions: {len(embedding) if embedding else 'N/A'}")
    print(f"Expected dimensions: 1536 (for text-embedding-3-small)")
    print(f"First 5 values: {embedding[:5] if embedding else 'N/A'}")
    print(f"Last 5 values: {embedding[-5:] if embedding else 'N/A'}")

    if len(embedding) == 1536:
        print("\n✓ Embedding format is CORRECT")
    else:
        print(f"\n✗ WARNING: Expected 1536 dimensions, got {len(embedding)}")
else:
    print("\n✗ No embeddings found yet")

print("\n" + "=" * 60)
