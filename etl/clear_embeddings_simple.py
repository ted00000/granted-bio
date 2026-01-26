"""
Clear all embeddings by setting them to NULL.
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
print("CLEARING EMBEDDINGS")
print("=" * 60)

# Count current embeddings
count_response = supabase.table('projects').select('application_id', count='exact').not_.is_('abstract_embedding', 'null').execute()
before_count = count_response.count

print(f"\nProjects with embeddings BEFORE: {before_count:,}")

if before_count > 0:
    print(f"Clearing {before_count:,} embeddings...")

    # Get all application_ids with embeddings in batches
    offset = 0
    batch_size = 1000
    total_cleared = 0

    while True:
        # Get batch of IDs
        batch = supabase.table('projects')\
            .select('application_id')\
            .not_.is_('abstract_embedding', 'null')\
            .range(offset, offset + batch_size - 1)\
            .execute()

        if not batch.data:
            break

        # Clear this batch
        for project in batch.data:
            supabase.table('projects').update({
                'abstract_embedding': None
            }).eq('application_id', project['application_id']).execute()
            total_cleared += 1

        print(f"  Cleared {total_cleared:,} / {before_count:,}")

        if len(batch.data) < batch_size:
            break

        offset += batch_size

    print(f"\n✓ Cleared {total_cleared:,} embeddings")

# Verify
count_after = supabase.table('projects').select('application_id', count='exact').not_.is_('abstract_embedding', 'null').execute()
after_count = count_after.count

print(f"\nProjects with embeddings AFTER: {after_count:,}")

if after_count == 0:
    print("\n✓ SUCCESS: All embeddings cleared")
else:
    print(f"\n✗ WARNING: {after_count:,} embeddings still remain")

print("=" * 60)
