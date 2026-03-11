"""
Fetch FY2026 NIH project data from RePORTER API.
Fetches projects, abstracts, publications, patents, and clinical studies.

Usage:
    python etl/fetch_fy2026.py                    # Fetch all FY2026 data
    python etl/fetch_fy2026.py --limit 100        # Test with 100 projects
    python etl/fetch_fy2026.py --skip-linked      # Skip publications/patents/clinical
"""

import os
import sys
import json
import argparse
import time
from datetime import datetime
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

load_dotenv('.env.local')

import requests
from supabase import create_client

# Flush output immediately
sys.stdout.flush()

# NIH RePORTER API endpoint
REPORTER_API = "https://api.reporter.nih.gov/v2/projects/search"

# Bio-related institutes (from existing process_projects.py)
BIO_INSTITUTES = {
    'NIGMS', 'NCI', 'NHLBI', 'NIAID', 'NIDDK', 'NINDS', 'NIA', 'NICHD',
    'NEI', 'NIDCR', 'NIDCD', 'NIMH', 'NIDA', 'NIAAA', 'NINR', 'NHGRI',
    'NIBIB', 'NCATS', 'NIEHS', 'NIAMS', 'NCCIH', 'NLM', 'FIC', 'OD',
}


def get_supabase_client():
    """Create Supabase client."""
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    if not url or not key:
        raise ValueError("Missing Supabase credentials in environment")
    return create_client(url, key)


def fetch_projects_page(fiscal_year: int, offset: int = 0, limit: int = 500, institute: str = None) -> Dict:
    """
    Fetch a page of projects from NIH RePORTER API.

    Args:
        fiscal_year: The fiscal year to query
        offset: Pagination offset
        limit: Number of results per page
        institute: Optional institute code (e.g., 'NCI', 'NIGMS') to filter by

    Returns dict with 'results' and 'meta' keys.
    """
    criteria = {
        "fiscal_years": [fiscal_year],
        "include_active_projects": True
    }

    # Add institute filter if specified
    if institute:
        criteria["agencies"] = [institute]

    payload = {
        "criteria": criteria,
        "include_fields": [
            "ApplId", "SubprojectId", "FiscalYear", "Organization",
            "ProjectNum", "OrgCountry", "ProjectNumSplit", "ContactPiName",
            "AllText", "FullStudySection", "ProjectStartDate", "ProjectEndDate",
            "AbstractText", "Terms", "PhrText", "SpendingCategoriesDesc",
            "FundingMechanism", "AwardAmount", "IsSubproject", "AwardNoticeDate",
            "CongDist", "ProjectTitle", "PiNames", "AgencyIcFundings"
        ],
        "offset": offset,
        "limit": limit,
        "sort_field": "ApplId",
        "sort_order": "asc"
    }

    response = requests.post(REPORTER_API, json=payload)
    response.raise_for_status()
    return response.json()


def is_bio_related(project: Dict) -> bool:
    """Check if project is bio/life sciences related based on funding ICs."""
    agency_fundings = project.get('agency_ic_fundings') or []
    for funding in agency_fundings:
        ic = funding.get('abbreviation', '').upper()
        if ic in BIO_INSTITUTES:
            return True
    return False


def determine_org_type(org_name: str, funding_mechanism: str) -> str:
    """Determine organization type (matches existing logic)."""
    org_name_lower = (org_name or '').lower()
    funding_lower = (funding_mechanism or '').lower()

    if 'sbir' in funding_lower or 'sttr' in funding_lower:
        return 'company'

    company_indicators = ['inc', 'llc', 'corp', 'ltd', 'company', 'co.', 'technologies', 'therapeutics', 'biosciences', 'biotech']
    if any(ind in org_name_lower for ind in company_indicators):
        return 'company'

    university_indicators = ['university', 'college', 'institute of technology', 'school of']
    if any(ind in org_name_lower for ind in university_indicators):
        return 'university'

    hospital_indicators = ['hospital', 'medical center', 'clinic', 'health system']
    if any(ind in org_name_lower for ind in hospital_indicators):
        return 'hospital'

    research_indicators = ['research institute', 'research foundation', 'research center']
    if any(ind in org_name_lower for ind in research_indicators):
        return 'research_institute'

    return 'other'


def parse_date(date_str: Optional[str]) -> Optional[str]:
    """Parse date string to ISO format."""
    if not date_str:
        return None
    try:
        # API returns ISO format dates
        if 'T' in date_str:
            return date_str.split('T')[0]
        return date_str
    except Exception:
        return None


def transform_project(api_project: Dict, fiscal_year: int = None) -> Dict:
    """Transform API response to match our database schema.

    Args:
        api_project: Project data from NIH RePORTER API
        fiscal_year: If provided, override the API's fiscal_year field.
                    WARNING: Only use this if you're sure all projects in the
                    batch have the same fiscal year. The API's fiscal_year
                    field is the original award year, not the queried year.
    """
    org = api_project.get('organization') or {}
    org_name = org.get('org_name', '')
    funding_mechanism = api_project.get('funding_mechanism', '')

    # Extract PI names
    pi_names = api_project.get('contact_pi_name', '')
    if not pi_names:
        pi_list = api_project.get('pi_names') or []
        pi_names = '; '.join([p.get('full_name', '') for p in pi_list if p.get('full_name')])

    # Get project number parts
    proj_num_split = api_project.get('project_num_split') or {}
    activity_code = proj_num_split.get('activity_code', '')

    # Use API's fiscal_year field (original award year) unless overridden
    fy = fiscal_year if fiscal_year is not None else api_project.get('fiscal_year')

    return {
        'application_id': str(api_project.get('appl_id', '')),
        'project_number': api_project.get('project_num', ''),
        'full_project_num': api_project.get('project_num', ''),
        'activity_code': activity_code,
        'funding_mechanism': funding_mechanism,
        'title': api_project.get('project_title', ''),
        'terms': api_project.get('terms', ''),
        'phr': api_project.get('phr_text', ''),
        'org_name': org_name,
        'org_type': determine_org_type(org_name, funding_mechanism),
        'org_city': org.get('org_city', ''),
        'org_state': org.get('org_state', ''),
        'org_country': org.get('org_country', ''),
        'org_zip': org.get('org_zipcode', ''),
        'total_cost': api_project.get('award_amount'),
        'award_date': parse_date(api_project.get('award_notice_date')),
        'project_start': parse_date(api_project.get('project_start_date')),
        'project_end': parse_date(api_project.get('project_end_date')),
        'fiscal_year': fy,  # Use API's fiscal_year (original award year)
        'pi_names': pi_names,
        'funding_agency': 'NIH',
        'is_bio_related': True,
        'is_supplement': False,  # TODO: Parse from project number
        'supplement_number': None,
    }


def transform_abstract(api_project: Dict) -> Optional[Dict]:
    """Extract abstract from API response."""
    abstract_text = api_project.get('abstract_text', '')
    if not abstract_text or not abstract_text.strip():
        return None

    return {
        'application_id': str(api_project.get('appl_id', '')),
        'abstract_text': abstract_text,
        'abstract_length': len(abstract_text),
    }


def fetch_all_projects(fiscal_year: int, limit: Optional[int] = None) -> tuple[List[Dict], List[Dict]]:
    """
    Fetch all projects for a fiscal year.

    Returns (projects, abstracts) tuple.
    """
    print(f"\n{'='*60}")
    print(f"FETCHING FY{fiscal_year} PROJECTS FROM NIH RePORTER API")
    print(f"{'='*60}")

    all_projects = []
    all_abstracts = []
    offset = 0
    page_size = 500
    total_count = None

    while True:
        print(f"  Fetching page at offset {offset}...", flush=True)

        # Retry logic for API calls
        response = None
        for attempt in range(3):
            try:
                response = fetch_projects_page(fiscal_year, offset, page_size)
                break
            except Exception as e:
                if attempt < 2:
                    print(f"    Retry {attempt + 1} after error: {str(e)[:50]}")
                    time.sleep(2 ** attempt)
                else:
                    print(f"  ERROR fetching page after 3 attempts: {e}")

        if response is None:
            break

        results = response.get('results', [])
        meta = response.get('meta', {})

        if total_count is None:
            total_count = meta.get('total', 0)
            print(f"  Total projects in API: {total_count:,}")

        if not results:
            break

        # Transform and filter
        for api_project in results:
            if not is_bio_related(api_project):
                continue

            project = transform_project(api_project)  # Uses API's fiscal_year
            all_projects.append(project)

            abstract = transform_abstract(api_project)
            if abstract:
                all_abstracts.append(abstract)

            if limit and len(all_projects) >= limit:
                print(f"  Reached limit of {limit} projects")
                break

        if limit and len(all_projects) >= limit:
            break

        offset += page_size

        # Rate limiting
        time.sleep(0.5)

        # Safety limit
        if offset > 200000:
            print("  Hit safety limit on offset")
            break

    print(f"\n  Fetched {len(all_projects):,} bio-related projects")
    print(f"  Fetched {len(all_abstracts):,} abstracts")

    return all_projects, all_abstracts


def fetch_projects_page_by_activity(fiscal_year: int, activity_code: str, offset: int = 0,
                                     limit: int = 500, sort_order: str = "asc") -> Dict:
    """
    Fetch a page of projects filtered by activity code.

    Args:
        fiscal_year: The fiscal year to query
        activity_code: Activity code like 'R01', 'R21', etc.
        offset: Pagination offset
        limit: Number of results per page
        sort_order: 'asc' or 'desc' for ApplId sorting

    Returns dict with 'results' and 'meta' keys.
    """
    payload = {
        "criteria": {
            "fiscal_years": [fiscal_year],
            "include_active_projects": True,
            "activity_codes": [activity_code]
        },
        "include_fields": [
            "ApplId", "SubprojectId", "FiscalYear", "Organization",
            "ProjectNum", "OrgCountry", "ProjectNumSplit", "ContactPiName",
            "AllText", "FullStudySection", "ProjectStartDate", "ProjectEndDate",
            "AbstractText", "Terms", "PhrText", "SpendingCategoriesDesc",
            "FundingMechanism", "AwardAmount", "IsSubproject", "AwardNoticeDate",
            "CongDist", "ProjectTitle", "PiNames", "AgencyIcFundings"
        ],
        "offset": offset,
        "limit": limit,
        "sort_field": "ApplId",
        "sort_order": sort_order
    }

    response = requests.post(REPORTER_API, json=payload)
    response.raise_for_status()
    return response.json()


def get_all_activity_codes(fiscal_year: int) -> List[tuple]:
    """
    Get all activity codes and their counts for a fiscal year.
    Returns list of (activity_code, count) tuples sorted by count desc.
    """
    # Common NIH activity codes - comprehensive list
    known_codes = [
        'R01', 'R21', 'R43', 'R44', 'R41', 'R42', 'R03', 'R13', 'R15', 'R18', 'R25', 'R33', 'R34', 'R35', 'R36', 'R37', 'R38', 'R50', 'R56', 'R61', 'R00',
        'U01', 'U10', 'U19', 'U24', 'U34', 'U41', 'U42', 'U43', 'U44', 'U54', 'U2C', 'UG1', 'UG3', 'UH2', 'UH3', 'UM1', 'UM2',
        'P01', 'P20', 'P30', 'P40', 'P41', 'P42', 'P50', 'P51', 'P60',
        'T32', 'T34', 'T35', 'T36', 'T37', 'T90', 'TL1', 'TL4', 'TU2',
        'F30', 'F31', 'F32', 'F33', 'F38', 'F99',
        'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K18', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2',
        'DP1', 'DP2', 'DP4', 'DP5',
        'G11', 'G12', 'G13', 'G20',
        'S06', 'S10', 'S11', 'S15', 'S21', 'S22',
        'C06', 'D43', 'D71',
        'ZIAZ', 'ZIABC', 'ZIABR', 'ZIAEY', 'ZIAHL', 'ZIAAI', 'ZIAMH', 'ZIANS', 'OT2',
    ]

    results = []
    for code in known_codes:
        payload = {
            "criteria": {
                "fiscal_years": [fiscal_year],
                "include_active_projects": True,
                "activity_codes": [code]
            },
            "offset": 0,
            "limit": 1
        }
        try:
            response = requests.post(REPORTER_API, json=payload, timeout=30)
            response.raise_for_status()
            count = response.json().get('meta', {}).get('total', 0)
            if count > 0:
                results.append((code, count))
        except Exception:
            pass
        time.sleep(0.1)

    return sorted(results, key=lambda x: -x[1])


def fetch_all_projects_by_activity(fiscal_year: int, limit: Optional[int] = None) -> tuple[List[Dict], List[Dict]]:
    """
    Fetch all projects for a fiscal year by iterating through activity codes.
    This works around the NIH RePORTER API's 15K offset limit.

    For activity codes with > 15K projects (like R01), fetches with both
    ascending and descending sort orders and deduplicates.

    Returns (projects, abstracts) tuple.
    """
    print(f"\n{'='*60}")
    print(f"FETCHING FY{fiscal_year} PROJECTS BY ACTIVITY CODE")
    print(f"{'='*60}")

    # Get all activity codes and counts
    print("\n  Discovering activity codes...", flush=True)
    activity_codes = get_all_activity_codes(fiscal_year)
    total_expected = sum(count for _, count in activity_codes)
    print(f"  Found {len(activity_codes)} activity codes with {total_expected:,} total projects")

    all_projects = []
    all_abstracts = []
    seen_app_ids = set()  # Track to avoid duplicates

    for activity_code, expected_count in activity_codes:
        print(f"\n  [{activity_code}] Expected: {expected_count:,} projects", flush=True)

        # Determine sort strategies needed
        sort_orders = ['asc']
        if expected_count > 14500:
            sort_orders.append('desc')
            print(f"    Using both ASC and DESC sort for large activity code")

        code_count = 0
        for sort_order in sort_orders:
            offset = 0
            page_size = 500

            while offset < 14500:  # Stay under 15K limit
                # Retry logic for API calls
                response = None
                for attempt in range(3):
                    try:
                        response = fetch_projects_page_by_activity(
                            fiscal_year, activity_code, offset, page_size, sort_order
                        )
                        break
                    except Exception as e:
                        if attempt < 2:
                            time.sleep(2 ** attempt)
                        else:
                            print(f"    ERROR at offset {offset}: {str(e)[:50]}")

                if response is None:
                    break

                results = response.get('results', [])
                if not results:
                    break

                # Transform and deduplicate
                new_in_batch = 0
                for api_project in results:
                    if not is_bio_related(api_project):
                        continue

                    app_id = str(api_project.get('appl_id', ''))
                    if app_id in seen_app_ids:
                        continue
                    seen_app_ids.add(app_id)

                    project = transform_project(api_project)  # Uses API's fiscal_year
                    all_projects.append(project)
                    code_count += 1
                    new_in_batch += 1

                    abstract = transform_abstract(api_project)
                    if abstract:
                        all_abstracts.append(abstract)

                    if limit and len(all_projects) >= limit:
                        break

                if limit and len(all_projects) >= limit:
                    break

                # If we got no new projects in this batch (all duplicates), stop this sort order
                if new_in_batch == 0 and len(sort_orders) > 1:
                    break

                offset += page_size
                time.sleep(0.3)

            if limit and len(all_projects) >= limit:
                break

        print(f"    [{activity_code}] Fetched {code_count:,} bio-related projects")

        if limit and len(all_projects) >= limit:
            print(f"  Reached limit of {limit} projects")
            break

    print(f"\n  Total fetched: {len(all_projects):,} bio-related projects")
    print(f"  Total abstracts: {len(all_abstracts):,}")

    return all_projects, all_abstracts


def fetch_all_projects_by_institute(fiscal_year: int, limit: Optional[int] = None) -> tuple[List[Dict], List[Dict]]:
    """
    DEPRECATED: Use fetch_all_projects_by_activity instead.
    The 'agencies' API filter doesn't work reliably for filtering by IC.
    """
    print("\nWARNING: --by-institute is deprecated. Use --by-activity instead.")
    return fetch_all_projects_by_activity(fiscal_year, limit)


def fetch_linked_publications(project_numbers: List[str]) -> tuple[List[Dict], List[Dict]]:
    """
    Fetch publications linked to projects.
    Uses NIH RePORTER publications endpoint.

    Returns (publications, links) tuple.
    """
    print(f"\n{'='*60}")
    print("FETCHING LINKED PUBLICATIONS")
    print(f"{'='*60}")

    # NIH RePORTER doesn't have a direct publications API
    # Publications come from ExPORTER files or need to be fetched separately
    # For now, return empty - publications will be loaded from CSV files

    print("  Note: Publications fetched from ExPORTER CSV files, not API")
    print("  Skipping API fetch for publications")

    return [], []


def fetch_linked_patents(project_numbers: List[str]) -> List[Dict]:
    """
    Fetch patents linked to projects.

    Returns list of patent records.
    """
    print(f"\n{'='*60}")
    print("FETCHING LINKED PATENTS")
    print(f"{'='*60}")

    # Patents also come from ExPORTER files
    print("  Note: Patents fetched from ExPORTER CSV files, not API")
    print("  Skipping API fetch for patents")

    return []


def fetch_linked_clinical(project_numbers: List[str]) -> List[Dict]:
    """
    Fetch clinical studies linked to projects.

    Returns list of clinical study records.
    """
    print(f"\n{'='*60}")
    print("FETCHING LINKED CLINICAL STUDIES")
    print(f"{'='*60}")

    # Clinical studies also come from ExPORTER files
    print("  Note: Clinical studies fetched from ExPORTER CSV files, not API")
    print("  Skipping API fetch for clinical studies")

    return []


def upsert_with_retry(supabase, table: str, batch: List[Dict], on_conflict: str, max_retries: int = 3) -> bool:
    """Upsert a batch with retry logic."""
    for attempt in range(max_retries):
        try:
            supabase.table(table).upsert(batch, on_conflict=on_conflict).execute()
            return True
        except Exception as e:
            error_str = str(e)
            if 'timeout' in error_str.lower() and attempt < max_retries - 1:
                # Wait and retry on timeout
                time.sleep(2 ** attempt)
                continue
            else:
                return False
    return False


def load_to_database(
    supabase,
    projects: List[Dict],
    abstracts: List[Dict],
    publications: List[Dict] = None,
    pub_links: List[Dict] = None,
    patents: List[Dict] = None,
    clinical: List[Dict] = None,
) -> Dict[str, int]:
    """Load all data to Supabase."""
    print(f"\n{'='*60}")
    print("LOADING TO SUPABASE")
    print(f"{'='*60}")

    stats = {'projects': 0, 'abstracts': 0}
    batch_size = 100  # Smaller batches to avoid timeout

    # Load projects
    print(f"\n  Loading {len(projects):,} projects...", flush=True)
    for i in range(0, len(projects), batch_size):
        batch = projects[i:i + batch_size]
        if upsert_with_retry(supabase, 'projects', batch, 'application_id'):
            stats['projects'] += len(batch)
            if (i // batch_size + 1) % 10 == 0:
                print(f"    Progress: {stats['projects']:,}/{len(projects):,} projects", flush=True)
        else:
            print(f"    ERROR on batch {i//batch_size + 1}", flush=True)
    print(f"    Loaded {stats['projects']:,} projects", flush=True)

    # Load abstracts (upsert - requires unique constraint on application_id)
    print(f"\n  Loading {len(abstracts):,} abstracts...", flush=True)
    for i in range(0, len(abstracts), batch_size):
        batch = abstracts[i:i + batch_size]
        if upsert_with_retry(supabase, 'abstracts', batch, 'application_id'):
            stats['abstracts'] += len(batch)
            if (i // batch_size + 1) % 10 == 0:
                print(f"    Progress: {stats['abstracts']:,}/{len(abstracts):,} abstracts", flush=True)
        else:
            print(f"    ERROR on batch {i//batch_size + 1}", flush=True)
    print(f"    Loaded {stats['abstracts']:,} abstracts", flush=True)

    return stats


def count_bio_projects(fiscal_year: int) -> tuple[int, int]:
    """
    Quick count of total and bio-related projects for a fiscal year.
    Samples first 2000 projects to estimate bio percentage and award date distribution.
    """
    print(f"\nCounting FY{fiscal_year} projects...")

    # Get total count
    response = fetch_projects_page(fiscal_year, 0, 1)
    total = response.get('meta', {}).get('total', 0)
    print(f"  Total in API: {total:,}")

    # Sample to estimate bio percentage and award date distribution
    sample_size = min(2000, total)
    bio_count = 0
    award_dates = {'fy2026': 0, 'fy2025': 0, 'earlier': 0, 'unknown': 0}

    for offset in range(0, sample_size, 500):
        response = fetch_projects_page(fiscal_year, offset, 500)
        results = response.get('results', [])
        for proj in results:
            if is_bio_related(proj):
                bio_count += 1

            # Check award date
            award_date = proj.get('award_notice_date', '')
            if award_date:
                year = award_date[:4] if len(award_date) >= 4 else None
                if year == '2026' or (year == '2025' and award_date[5:7] >= '10'):
                    award_dates['fy2026'] += 1
                elif year == '2025' or (year == '2024' and award_date[5:7] >= '10'):
                    award_dates['fy2025'] += 1
                else:
                    award_dates['earlier'] += 1
            else:
                award_dates['unknown'] += 1

        time.sleep(0.3)

    bio_pct = (bio_count / sample_size * 100) if sample_size > 0 else 0
    estimated_bio = int(total * bio_pct / 100)

    print(f"  Sampled {sample_size:,} projects")
    print(f"  Bio-related in sample: {bio_count:,} ({bio_pct:.1f}%)")
    print(f"  Estimated bio-related total: ~{estimated_bio:,}")
    print(f"\n  Award date distribution in sample:")
    print(f"    FY2026 (Oct 2025+): {award_dates['fy2026']:,} ({award_dates['fy2026']/sample_size*100:.1f}%)")
    print(f"    FY2025 (Oct 2024-Sep 2025): {award_dates['fy2025']:,} ({award_dates['fy2025']/sample_size*100:.1f}%)")
    print(f"    Earlier: {award_dates['earlier']:,} ({award_dates['earlier']/sample_size*100:.1f}%)")
    print(f"    Unknown: {award_dates['unknown']:,}")

    return total, estimated_bio


def main():
    parser = argparse.ArgumentParser(description='Fetch FY2026 NIH data')
    parser.add_argument('--limit', type=int, help='Limit number of projects')
    parser.add_argument('--skip-linked', action='store_true', help='Skip publications/patents/clinical')
    parser.add_argument('--fiscal-year', type=int, default=2026, help='Fiscal year to fetch')
    parser.add_argument('--count-only', action='store_true', help='Only count projects, do not load')
    parser.add_argument('--by-institute', action='store_true', help='(Deprecated) Use --by-activity')
    parser.add_argument('--by-activity', action='store_true', help='Fetch by activity code to avoid API offset limit')
    args = parser.parse_args()

    print("=" * 60)
    print("NIH FY2026 DATA FETCH")
    print("=" * 60)
    print(f"Fiscal Year: {args.fiscal_year}")
    print(f"Limit: {args.limit or 'None'}")
    print(f"Skip linked data: {args.skip_linked}")
    print(f"By activity code: {args.by_activity or args.by_institute}")

    # Count-only mode
    if args.count_only:
        total, estimated_bio = count_bio_projects(args.fiscal_year)
        print(f"\nSummary:")
        print(f"  Total FY{args.fiscal_year} projects: {total:,}")
        print(f"  Estimated bio-related: ~{estimated_bio:,}")
        return

    start_time = datetime.now()

    # Initialize Supabase
    print("\nConnecting to Supabase...", flush=True)
    supabase = get_supabase_client()
    print("Connected.", flush=True)

    # Fetch projects
    if args.by_activity or args.by_institute:
        projects, abstracts = fetch_all_projects_by_activity(args.fiscal_year, args.limit)
    else:
        projects, abstracts = fetch_all_projects(args.fiscal_year, args.limit)

    if not projects:
        print("\nNo projects found. Exiting.")
        return

    # Fetch linked data (if not skipped)
    publications = []
    pub_links = []
    patents = []
    clinical = []

    if not args.skip_linked:
        project_numbers = list(set(p['project_number'] for p in projects if p.get('project_number')))
        print(f"\n  Unique project numbers: {len(project_numbers):,}")

        publications, pub_links = fetch_linked_publications(project_numbers)
        patents = fetch_linked_patents(project_numbers)
        clinical = fetch_linked_clinical(project_numbers)

    # Load to database
    stats = load_to_database(
        supabase,
        projects,
        abstracts,
        publications,
        pub_links,
        patents,
        clinical,
    )

    # Summary
    elapsed = datetime.now() - start_time
    print(f"\n{'='*60}")
    print("FETCH COMPLETE")
    print(f"{'='*60}")
    print(f"Time elapsed: {elapsed}")
    print(f"Projects loaded: {stats.get('projects', 0):,}")
    print(f"Abstracts loaded: {stats.get('abstracts', 0):,}")
    print(f"\nNext steps:")
    print(f"  1. Run classification: python etl/classify_projects_batched.py")
    print(f"  2. Generate embeddings: python etl/generate_embeddings_batched.py")
    print(f"  3. Rebuild indexes in Supabase SQL editor")


if __name__ == '__main__':
    main()
