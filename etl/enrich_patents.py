"""
Enrich patents table with data from USPTO PatentsView API.
Fetches detailed patent information for all patent IDs in the database.

Usage:
    python etl/enrich_patents.py
    python etl/enrich_patents.py --limit 100  # Test with first 100
    python etl/enrich_patents.py --refresh    # Re-fetch all (ignore api_last_updated)
"""

import os
import sys
import time
import argparse
import requests
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

# Configuration
API_BASE_URL = "https://search.patentsview.org/api/v1/patent"
NUM_WORKERS = 5  # Conservative to respect rate limits
BATCH_SIZE = 100  # USPTO API supports batch queries
REQUEST_TIMEOUT = 30

print("=" * 60)
print("PATENT ENRICHMENT FROM USPTO PATENTSVIEW")
print("=" * 60)
sys.stdout.flush()

# Parse arguments
parser = argparse.ArgumentParser()
parser.add_argument('--limit', type=int, help='Limit number of patents to process')
parser.add_argument('--refresh', action='store_true', help='Re-fetch all patents regardless of api_last_updated')
args = parser.parse_args()

# Get API key
API_KEY = os.environ.get('USPTO_API_KEY')
if not API_KEY:
    print("ERROR: USPTO_API_KEY not set in environment")
    sys.exit(1)

# Initialize Supabase
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase")
sys.stdout.flush()


def fetch_patent_single(patent_id: str, max_retries: int = 3) -> dict | None:
    """Fetch patent data from USPTO PatentsView API for a single patent."""
    import json
    from urllib.parse import urlencode

    query = json.dumps({"patent_id": patent_id})
    fields = json.dumps([
        "patent_id",
        "patent_title",
        "patent_abstract",
        "patent_date",
        "patent_type",
        "assignees.assignee_organization",
        "inventors.inventor_name_first",
        "inventors.inventor_name_last",
        "cpcs.cpc_group_id"
    ])

    url = f"{API_BASE_URL}/?q={requests.utils.quote(query)}&f={requests.utils.quote(fields)}"

    headers = {
        "X-Api-Key": API_KEY,
        "Content-Type": "application/json"
    }

    for attempt in range(max_retries):
        try:
            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)

            if response.status_code == 429:
                wait_time = 60 * (attempt + 1)
                print(f"  Rate limited, waiting {wait_time}s...")
                time.sleep(wait_time)
                continue

            if response.status_code == 404:
                return None

            response.raise_for_status()
            data = response.json()

            patents = data.get('patents', [])
            if patents:
                return patents[0]
            return None

        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                time.sleep(1 * (attempt + 1))
                continue
            return None

    return None


def fetch_patents_batch(patent_ids: list[str]) -> dict:
    """Fetch patent data for a batch of IDs (one at a time due to API constraints)."""
    result = {}
    for patent_id in patent_ids:
        patent_data = fetch_patent_single(patent_id)
        if patent_data:
            result[patent_id] = patent_data
        time.sleep(0.1)  # Small delay between requests
    return result


def fetch_citation_count(patent_id: str) -> int:
    """Fetch citation count for a single patent."""
    try:
        query = {"_and": [{"cited_patent_id": patent_id}]}
        params = {
            "q": str(query).replace("'", '"'),
            "o": '{"size": 0}'
        }
        headers = {"X-Api-Key": API_KEY}

        response = requests.get(
            API_BASE_URL,
            params=params,
            headers=headers,
            timeout=10
        )

        if response.ok:
            data = response.json()
            return data.get('total_hits', 0)
    except:
        pass
    return 0


def parse_patent_data(patent: dict) -> dict:
    """Extract relevant fields from USPTO API response."""
    if not patent:
        return {}

    # Extract inventors (combine first and last name)
    inventors = []
    for inv in patent.get('inventors', []) or []:
        first = inv.get('inventor_name_first', '')
        last = inv.get('inventor_name_last', '')
        name = f"{first} {last}".strip()
        if name:
            inventors.append(name)

    # Extract assignees
    assignees = []
    for asg in patent.get('assignees', []) or []:
        org = asg.get('assignee_organization')
        if org:
            assignees.append(org)

    # Extract CPC codes
    cpc_codes = []
    for cpc in patent.get('cpcs', []) or []:
        code = cpc.get('cpc_group_id')
        if code:
            cpc_codes.append(code)

    result = {
        'patent_abstract': patent.get('patent_abstract'),
        'patent_date': patent.get('patent_date'),
        'patent_type': patent.get('patent_type'),
        'assignees': assignees if assignees else None,
        'inventors': inventors if inventors else None,
        'cpc_codes': cpc_codes[:20] if cpc_codes else None,  # Limit to 20 codes
    }

    # Only include api_last_updated if migration has been run
    global INCLUDE_TIMESTAMP
    if INCLUDE_TIMESTAMP:
        result['api_last_updated'] = datetime.utcnow().isoformat()

    return result


# Track if migration has been run
INCLUDE_TIMESTAMP = True


# Get patents to enrich
print("\nFetching patents to enrich...")

try:
    if args.refresh:
        print("Mode: REFRESH - Re-fetching all patents")
        query = supabase.table('patents').select('patent_id', count='exact')
    else:
        print("Mode: INCREMENTAL - Only patents without api_last_updated")
        query = supabase.table('patents').select('patent_id', count='exact').is_('api_last_updated', 'null')

    if args.limit:
        query = query.limit(args.limit)

    result = query.execute()
except Exception as e:
    # If api_last_updated column doesn't exist, fall back to getting all patents
    if 'api_last_updated does not exist' in str(e):
        print("Note: api_last_updated column not found - fetching all patents")
        print("      Run the migration first for incremental updates")
        INCLUDE_TIMESTAMP = False
        query = supabase.table('patents').select('patent_id', count='exact')
        if args.limit:
            query = query.limit(args.limit)
        result = query.execute()
    else:
        raise e

patent_ids = [p['patent_id'] for p in result.data]
total_patents = len(patent_ids)

print(f"✓ Found {total_patents:,} patents to enrich")

if total_patents == 0:
    print("No patents to process. Use --refresh to re-fetch all.")
    sys.exit(0)

# Statistics
total_enriched = 0
total_errors = 0
total_not_found = 0
batch_num = 0

print(f"\nBatch size: {BATCH_SIZE}")
print(f"Estimated batches: {(total_patents + BATCH_SIZE - 1) // BATCH_SIZE}")
print(f"Estimated time: ~{total_patents * 0.5 / 60:.1f} minutes")
print("=" * 60)
sys.stdout.flush()

# Process in batches
for i in range(0, len(patent_ids), BATCH_SIZE):
    batch_num += 1
    batch = patent_ids[i:i + BATCH_SIZE]

    print(f"\nBatch {batch_num}: Processing {len(batch)} patents...")
    sys.stdout.flush()

    # Fetch patent data from USPTO
    patent_data = fetch_patents_batch(batch)

    batch_enriched = 0
    batch_not_found = 0
    batch_errors = 0

    for patent_id in batch:
        try:
            if patent_id not in patent_data:
                batch_not_found += 1
                total_not_found += 1
                continue

            # Parse the patent data
            parsed = parse_patent_data(patent_data[patent_id])

            if not parsed:
                batch_errors += 1
                total_errors += 1
                continue

            # Update the database
            supabase.table('patents').update(parsed).eq('patent_id', patent_id).execute()

            batch_enriched += 1
            total_enriched += 1

        except Exception as e:
            batch_errors += 1
            total_errors += 1
            if total_errors <= 10:
                print(f"  ERROR on {patent_id}: {str(e)[:60]}")

    print(f"  ✓ Enriched: {batch_enriched}, Not found: {batch_not_found}, Errors: {batch_errors}")
    print(f"  Running total: {total_enriched:,} enriched, {total_not_found:,} not found")
    sys.stdout.flush()

    # Small delay between batches to respect rate limits
    time.sleep(0.5)

print("\n" + "=" * 60)
print("PATENT ENRICHMENT COMPLETE")
print("=" * 60)
print(f"Total enriched: {total_enriched:,}")
print(f"Total not found: {total_not_found:,}")
print(f"Total errors: {total_errors}")
if total_enriched + total_errors > 0:
    print(f"Success rate: {total_enriched / (total_enriched + total_errors) * 100:.1f}%")
print("=" * 60)
sys.stdout.flush()
