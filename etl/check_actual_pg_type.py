"""
Check the actual PostgreSQL data type of the stored embedding.
"""

import os
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

# Connect
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

print("=" * 60)
print("CHECKING ACTUAL POSTGRESQL DATA TYPE")
print("=" * 60)

# Get a sample with embedding
sample = supabase.table('projects').select('application_id').not_.is_('abstract_embedding', 'null').limit(1).execute()

if sample.data and len(sample.data) > 0:
    app_id = sample.data[0]['application_id']
    print(f"\nTesting with project: {app_id}")

    # Query the actual PostgreSQL type using pg_typeof
    result = supabase.rpc('exec_sql', {
        'sql': f"""
        SELECT
            application_id,
            pg_typeof(abstract_embedding) as embedding_type,
            array_length(abstract_embedding::float[], 1) as dimensions
        FROM projects
        WHERE application_id = '{app_id}'
        """
    }).execute()

    print(f"\nPostgreSQL Type Information:")
    print(f"  pg_typeof(abstract_embedding): {result.data}")

else:
    print("\n✗ No embeddings found to check")

print("\n" + "=" * 60)
