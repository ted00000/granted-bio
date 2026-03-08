"""Quick check of trial enrichment status."""
import os
from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

# Total count
total = supabase.table('clinical_studies').select('nct_id', count='exact').execute()
print(f"Total trials: {total.count:,}")

# With brief_summary
with_summary = supabase.table('clinical_studies').select('nct_id', count='exact').not_.is_('brief_summary', 'null').execute()
print(f"With brief_summary: {with_summary.count:,} ({with_summary.count/total.count*100:.1f}%)")

# Without brief_summary
without = total.count - with_summary.count
print(f"Without brief_summary: {without:,} ({without/total.count*100:.1f}%)")

# Sample some summaries to check length
sample = supabase.table('clinical_studies').select('nct_id, brief_summary').not_.is_('brief_summary', 'null').limit(10).execute()
print(f"\nSample brief_summary lengths:")
for s in sample.data:
    summary = s.get('brief_summary', '') or ''
    print(f"  {s['nct_id']}: {len(summary)} chars")
