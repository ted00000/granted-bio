"""
Enrich clinical_studies table with data from ClinicalTrials.gov API.
Fetches detailed trial information for all NCT IDs in the database.

Usage:
    python etl/enrich_clinical_trials.py
    python etl/enrich_clinical_trials.py --limit 100  # Test with first 100
    python etl/enrich_clinical_trials.py --refresh    # Re-fetch all (ignore api_last_updated)
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
import re

def normalize_date(date_str: str | None) -> str | None:
    """Convert partial dates (YYYY-MM) to full dates (YYYY-MM-01) for PostgreSQL."""
    if not date_str:
        return None
    # Match YYYY-MM format (without day)
    if re.match(r'^\d{4}-\d{2}$', date_str):
        return f"{date_str}-01"
    # Match YYYY format (year only)
    if re.match(r'^\d{4}$', date_str):
        return f"{date_str}-01-01"
    return date_str

# Configuration
API_BASE_URL = "https://clinicaltrials.gov/api/v2/studies"
NUM_WORKERS = 10
BATCH_SIZE = 500
REQUEST_TIMEOUT = 30

print("=" * 60)
print("CLINICAL TRIALS ENRICHMENT FROM CLINICALTRIALS.GOV")
print("=" * 60)
sys.stdout.flush()

# Parse arguments
parser = argparse.ArgumentParser()
parser.add_argument('--limit', type=int, help='Limit number of trials to process')
parser.add_argument('--refresh', action='store_true', help='Re-fetch all trials regardless of api_last_updated')
args = parser.parse_args()

# Initialize Supabase
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase")
sys.stdout.flush()


def fetch_trial_from_api(nct_id: str, max_retries: int = 3) -> dict | None:
    """Fetch trial data from ClinicalTrials.gov API with retries."""
    url = f"{API_BASE_URL}/{nct_id}"

    for attempt in range(max_retries):
        try:
            response = requests.get(url, timeout=REQUEST_TIMEOUT)

            if response.status_code == 404:
                return None  # Trial not found

            response.raise_for_status()
            return response.json()

        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                time.sleep(0.5 * (attempt + 1))  # Exponential backoff
                continue
            return None

    return None


def parse_api_response(data: dict) -> dict:
    """Extract relevant fields from API response."""
    if not data:
        return {}

    protocol = data.get('protocolSection', {})

    # Design module
    design = protocol.get('designModule', {})
    phases = design.get('phases', [])
    phase = phases[0] if phases else None
    enrollment_info = design.get('enrollmentInfo', {})
    enrollment_count = enrollment_info.get('count')
    study_type = design.get('studyType')

    # Status module
    status = protocol.get('statusModule', {})
    start_date_struct = status.get('startDateStruct', {})
    start_date = start_date_struct.get('date')
    completion_date_struct = status.get('completionDateStruct', {}) or status.get('primaryCompletionDateStruct', {})
    completion_date = completion_date_struct.get('date')

    # Conditions module
    conditions_module = protocol.get('conditionsModule', {})
    conditions = conditions_module.get('conditions', [])

    # Arms/Interventions module
    arms_module = protocol.get('armsInterventionsModule', {})
    interventions_raw = arms_module.get('interventions', [])
    interventions = [
        {
            'name': i.get('name'),
            'type': i.get('type'),
            'description': i.get('description', '')[:500] if i.get('description') else None
        }
        for i in interventions_raw[:10]  # Limit to 10 interventions
    ]

    # Sponsor/Collaborators module
    sponsor_module = protocol.get('sponsorCollaboratorsModule', {})
    lead_sponsor = sponsor_module.get('leadSponsor', {})
    lead_sponsor_name = lead_sponsor.get('name')

    # Eligibility module
    eligibility = protocol.get('eligibilityModule', {})
    eligibility_criteria = eligibility.get('eligibilityCriteria', '')
    if eligibility_criteria and len(eligibility_criteria) > 5000:
        eligibility_criteria = eligibility_criteria[:5000] + '...'

    # Description module
    description = protocol.get('descriptionModule', {})
    brief_summary = description.get('briefSummary', '')
    if brief_summary and len(brief_summary) > 2000:
        brief_summary = brief_summary[:2000] + '...'

    return {
        'phase': phase,
        'conditions': conditions if conditions else None,
        'interventions': interventions if interventions else None,
        'enrollment_count': enrollment_count,
        'lead_sponsor': lead_sponsor_name,
        'start_date': normalize_date(start_date),
        'completion_date': normalize_date(completion_date),
        'eligibility_criteria': eligibility_criteria if eligibility_criteria else None,
        'study_type': study_type,
        'brief_summary': brief_summary if brief_summary else None,
        'api_last_updated': datetime.now().isoformat(),
        'api_raw_data': data  # Store full response
    }


def process_trial(trial: dict) -> tuple[bool, str | None]:
    """Fetch and update a single trial. Returns (success, error_message)."""
    nct_id = trial['nct_id']
    project_number = trial.get('project_number', '')

    # Fetch from API
    api_data = fetch_trial_from_api(nct_id)

    if api_data is None:
        return False, f"API returned no data for {nct_id}"

    # Parse response
    parsed = parse_api_response(api_data)

    if not parsed:
        return False, f"Failed to parse API response for {nct_id}"

    # Update database
    try:
        supabase.table('clinical_studies').update(parsed).eq(
            'nct_id', nct_id
        ).eq(
            'project_number', project_number
        ).execute()
        return True, None
    except Exception as e:
        return False, str(e)[:100]


# Get trials to process
print("\nFetching clinical studies to enrich...", flush=True)

if args.refresh:
    # Fetch all trials
    query = supabase.table('clinical_studies').select('nct_id, project_number', count='exact')
else:
    # Fetch only trials without API data
    query = supabase.table('clinical_studies').select('nct_id, project_number', count='exact').is_('api_last_updated', 'null')

if args.limit:
    query = query.limit(args.limit)
else:
    query = query.limit(50000)  # Supabase limit

result = query.execute()
trials = result.data
total_trials = len(trials)

if total_trials == 0:
    print("✓ All clinical studies already enriched! Nothing to do.")
    sys.exit(0)

print(f"✓ Found {total_trials:,} clinical studies to enrich\n")

# Stats
total_success = 0
total_errors = 0
start_time = time.time()
error_messages = []

print(f"Starting enrichment with {NUM_WORKERS} workers...")
print(f"API endpoint: {API_BASE_URL}")
print("=" * 60)
sys.stdout.flush()

# Process with ThreadPoolExecutor
with ThreadPoolExecutor(max_workers=NUM_WORKERS) as executor:
    futures = {executor.submit(process_trial, t): t for t in trials}

    for i, future in enumerate(as_completed(futures)):
        success, error = future.result()

        if success:
            total_success += 1
        else:
            total_errors += 1
            if len(error_messages) < 20:
                error_messages.append(error)

        # Progress update every 100 items
        if (i + 1) % 100 == 0 or (i + 1) == total_trials:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            eta = (total_trials - i - 1) / rate if rate > 0 else 0

            print(f"  [{i+1:,}/{total_trials:,}] "
                  f"Success: {total_success:,} | "
                  f"Errors: {total_errors:,} | "
                  f"Rate: {rate:.1f}/sec | "
                  f"ETA: {eta/60:.1f} min", flush=True)

# Summary
elapsed_total = time.time() - start_time
print("\n" + "=" * 60)
print("ENRICHMENT COMPLETE")
print("=" * 60)
print(f"Total processed: {total_trials:,}")
print(f"Successful: {total_success:,}")
print(f"Errors: {total_errors:,}")
print(f"Success rate: {100*total_success/total_trials:.1f}%")
print(f"Time elapsed: {elapsed_total/60:.1f} minutes")
print(f"Average rate: {total_trials/elapsed_total:.1f} trials/sec")

if error_messages:
    print(f"\nFirst {len(error_messages)} error messages:")
    for msg in error_messages[:10]:
        print(f"  - {msg}")

print("=" * 60)
