"""
Clear all incorrectly formatted embeddings from the database.
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
print("CLEARING BAD EMBEDDINGS")
print("=" * 60)

# Count current embeddings
count_response = supabase.table('projects').select('application_id', count='exact').not_.is_('abstract_embedding', 'null').execute()
before_count = count_response.count

print(f"\nProjects with embeddings BEFORE: {before_count:,}")
print(f"Clearing all embeddings to restart with correct format...\n")

# Clear ALL embeddings by setting to NULL using RPC
result = supabase.rpc('exec_sql', {
    'sql': 'UPDATE projects SET abstract_embedding = NULL WHERE abstract_embedding IS NOT NULL'
}).execute()

print(f"✓ Cleared embeddings for {before_count:,} projects")

# Verify
count_after = supabase.table('projects').select('application_id', count='exact').not_.is_('abstract_embedding', 'null').execute()
after_count = count_after.count

print(f"\nProjects with embeddings AFTER: {after_count:,}")

if after_count == 0:
    print("\n✓ SUCCESS: All embeddings cleared")
else:
    print(f"\n✗ WARNING: {after_count:,} embeddings still remain")

print("=" * 60)
