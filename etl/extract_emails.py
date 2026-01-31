"""
Extract email addresses from publication affiliations.
Adds pi_email column to publications table.
"""

import os
import re
import sys
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

# Email regex pattern
EMAIL_PATTERN = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')

# Initialize client
print("=" * 60)
print("EMAIL EXTRACTION FROM PUBLICATIONS")
print("=" * 60)
print("\nConnecting to Supabase...", flush=True)
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase", flush=True)

# Check total count
print("\nChecking total publications with affiliations...", flush=True)
total_result = supabase.table('publications').select('pmid', count='exact').not_.is_('affiliation', 'null').execute()
total_with_affil = total_result.count
print(f"✓ Found {total_with_affil:,} publications with affiliations", flush=True)

# Check how many already have emails extracted
print("Checking publications without extracted emails...", flush=True)
try:
    without_email = supabase.table('publications').select('pmid', count='exact').is_('pi_email', 'null').not_.is_('affiliation', 'null').execute()
    total_remaining = without_email.count
except Exception as e:
    # Column might not exist
    print(f"Note: pi_email column may not exist: {e}", flush=True)
    total_remaining = total_with_affil

print(f"✓ Found {total_remaining:,} publications needing email extraction\n", flush=True)

if total_remaining == 0:
    print("All publications already have emails extracted! Nothing to do.")
    sys.exit(0)

# Statistics
total_processed = 0
total_with_emails = 0
total_errors = 0
batch_num = 0
BATCH_SIZE = 1000

print("=" * 60)
print("STARTING EMAIL EXTRACTION")
print("=" * 60)
print(f"Total publications to process: {total_remaining:,}")
print(f"Batch size: {BATCH_SIZE}\n", flush=True)

while True:
    batch_num += 1

    print(f"\n{'='*60}")
    print(f"BATCH {batch_num}")
    print(f"{'='*60}", flush=True)

    try:
        response = supabase.table('publications').select(
            'pmid, affiliation'
        ).is_('pi_email', 'null').not_.is_('affiliation', 'null').limit(BATCH_SIZE).execute()
    except Exception as e:
        # If pi_email column doesn't exist, select all with affiliations
        print(f"Note: Selecting all publications (column may not exist): {e}", flush=True)
        response = supabase.table('publications').select(
            'pmid, affiliation'
        ).not_.is_('affiliation', 'null').limit(BATCH_SIZE).execute()

    publications = response.data
    batch_size = len(publications)

    if batch_size == 0:
        print("✓ No more publications to process!", flush=True)
        break

    print(f"Processing {batch_size} publications...", flush=True)

    batch_with_emails = 0
    batch_errors = 0

    for pub in publications:
        try:
            pmid = pub['pmid']
            affiliation = pub.get('affiliation', '') or ''

            # Extract emails from affiliation
            emails = EMAIL_PATTERN.findall(affiliation)

            if emails:
                # Take the first email (usually the corresponding author)
                pi_email = emails[0].lower()
                batch_with_emails += 1
            else:
                # Mark as processed with empty string
                pi_email = ''

            # Update the record
            supabase.table('publications').update({
                'pi_email': pi_email
            }).eq('pmid', pmid).execute()

            total_processed += 1

        except Exception as e:
            batch_errors += 1
            total_errors += 1
            if total_errors <= 10:
                print(f"  ERROR on {pub.get('pmid')}: {str(e)[:80]}", flush=True)

    total_with_emails += batch_with_emails

    print(f"✓ Batch {batch_num} complete:", flush=True)
    print(f"  Found emails: {batch_with_emails}/{batch_size} ({100*batch_with_emails/batch_size:.1f}%)")
    print(f"  Errors: {batch_errors}")
    print(f"  Running total: {total_with_emails:,} emails found", flush=True)

print(f"\n{'='*60}")
print(f"EMAIL EXTRACTION COMPLETE")
print(f"{'='*60}")
print(f"Total processed: {total_processed:,}")
print(f"Total with emails: {total_with_emails:,}")
print(f"Email extraction rate: {100*total_with_emails/max(total_processed,1):.1f}%")
print(f"Total errors: {total_errors}")
print(f"{'='*60}", flush=True)
