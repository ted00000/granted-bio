#!/usr/bin/env python3
"""
Fix fiscal_year values by fetching correct values from NIH RePORTER API.
The FY2026 load incorrectly set fiscal_year=2026 for all projects,
but many are continuing grants that should be FY2024 or FY2025.
"""

import os
import sys
import time
from typing import Dict, List
from dotenv import load_dotenv

# Flush output immediately
sys.stdout.reconfigure(line_buffering=True)

load_dotenv('.env.local')

import requests
from supabase import create_client

REPORTER_API = "https://api.reporter.nih.gov/v2/projects/search"


def get_supabase_client():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    return create_client(url, key)


def fetch_fiscal_years_from_api(app_ids: List[int]) -> Dict[int, int]:
    """Fetch fiscal_year for a batch of application IDs from NIH API."""
    payload = {
        "criteria": {
            "appl_ids": app_ids
        },
        "include_fields": ["ApplId", "FiscalYear"],
        "offset": 0,
        "limit": len(app_ids)
    }

    response = requests.post(REPORTER_API, json=payload, timeout=60)
    response.raise_for_status()
    results = response.json().get('results', [])

    return {p.get('appl_id'): p.get('fiscal_year') for p in results}


def main():
    supabase = get_supabase_client()

    print("=" * 60)
    print("FIX FISCAL_YEAR VALUES FROM API")
    print("=" * 60)

    # Get all projects with FY2026 that were updated recently
    print("\nStep 1: Getting FY2026 projects to check...")

    all_ids = []
    offset = 0
    while True:
        result = supabase.table('projects') \
            .select('application_id') \
            .eq('fiscal_year', 2026) \
            .range(offset, offset + 999) \
            .execute()

        if not result.data:
            break

        batch_ids = [int(r['application_id']) for r in result.data]
        all_ids.extend(batch_ids)
        print(f"  Fetched {len(all_ids):,} ids...", flush=True)
        offset += 1000

        if len(result.data) < 1000:
            break

    print(f"\nFound {len(all_ids):,} FY2026 projects to verify")

    if not all_ids:
        print("Nothing to fix!")
        return

    # Fetch correct fiscal_year from API in batches
    print("\nStep 2: Fetching correct fiscal_year from NIH API...")

    corrections = {}  # {app_id: correct_fy}
    batch_size = 100

    for i in range(0, len(all_ids), batch_size):
        batch_ids = all_ids[i:i + batch_size]

        try:
            api_data = fetch_fiscal_years_from_api(batch_ids)

            for app_id, correct_fy in api_data.items():
                if correct_fy and correct_fy != 2026:
                    corrections[app_id] = correct_fy

        except Exception as e:
            print(f"  Error at batch {i // batch_size}: {str(e)[:50]}")

        if (i // batch_size + 1) % 50 == 0:
            print(f"  Progress: {i + batch_size:,}/{len(all_ids):,} ({len(corrections):,} corrections found)", flush=True)

        time.sleep(0.15)  # Rate limit

    print(f"\nFound {len(corrections):,} projects needing fiscal_year correction")

    if not corrections:
        print("No corrections needed!")
        return

    # Show distribution of corrections
    fy_dist = {}
    for fy in corrections.values():
        fy_dist[fy] = fy_dist.get(fy, 0) + 1
    print("\nCorrection distribution:")
    for fy in sorted(fy_dist.keys()):
        print(f"  FY{fy}: {fy_dist[fy]:,}")

    # Apply corrections with retries and small batches
    print("\nStep 3: Applying corrections to database...")

    updated = 0
    errors = 0
    batch_size = 10  # Very small batches to avoid timeout

    for fy in sorted(fy_dist.keys()):
        fy_app_ids = [str(app_id) for app_id, correct_fy in corrections.items() if correct_fy == fy]
        print(f"\n  Updating {len(fy_app_ids):,} projects to FY{fy}...", flush=True)

        fy_updated = 0
        for i in range(0, len(fy_app_ids), batch_size):
            batch_ids = fy_app_ids[i:i + batch_size]

            # Retry up to 3 times
            for attempt in range(3):
                try:
                    supabase.table('projects') \
                        .update({'fiscal_year': fy}) \
                        .in_('application_id', batch_ids) \
                        .execute()
                    updated += len(batch_ids)
                    fy_updated += len(batch_ids)
                    break
                except Exception as e:
                    if attempt < 2:
                        time.sleep(2 ** attempt)  # Exponential backoff
                    else:
                        errors += 1

            if fy_updated % 1000 == 0 and fy_updated > 0:
                print(f"    Progress: {fy_updated:,}/{len(fy_app_ids):,}", flush=True)

            time.sleep(0.05)

    print(f"\nUpdated {updated:,} projects, {errors} errors")

    # Verify
    print("\nStep 4: Verification...")
    for fy in [2024, 2025, 2026]:
        r = supabase.table('projects').select('id', count='exact').eq('fiscal_year', fy).execute()
        print(f"  FY{fy}: {r.count:,}")


if __name__ == '__main__':
    main()
