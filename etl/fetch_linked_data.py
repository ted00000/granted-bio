#!/usr/bin/env python3
"""
Fetch linked data (publications, patents, clinical trials) for projects.
Uses NIH RePORTER API v2.
"""

import os
import sys
import time
import requests
from datetime import datetime
from collections import Counter
from dotenv import load_dotenv

sys.stdout.reconfigure(line_buffering=True)

load_dotenv('../.env.local')

from supabase import create_client

REPORTER_BASE = "https://api.reporter.nih.gov/v2"

def get_supabase_client():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    return create_client(url, key)


def fetch_publications(project_numbers: list, batch_size: int = 50) -> list:
    """Fetch publications linked to project numbers from RePORTER."""
    all_pubs = []

    for i in range(0, len(project_numbers), batch_size):
        batch = project_numbers[i:i+batch_size]

        payload = {
            "criteria": {
                "core_project_nums": batch
            },
            "limit": 500,
            "offset": 0
        }

        try:
            resp = requests.post(
                f"{REPORTER_BASE}/publications/search",
                json=payload,
                timeout=30
            )
            resp.raise_for_status()
            data = resp.json()

            results = data.get('results', [])
            for pub in results:
                all_pubs.append({
                    'pmid': pub.get('pmid'),
                    'project_number': pub.get('coreproject'),
                    'pub_title': pub.get('pub_title'),
                    'authors': ', '.join(pub.get('author_names', [])[:5]),
                    'journal': pub.get('journal_title'),
                    'pub_year': pub.get('pub_year'),
                    'citation_count': pub.get('cited_by_count', 0)
                })

            if (i // batch_size + 1) % 10 == 0:
                print(f"  Fetched publications for {i + len(batch)}/{len(project_numbers)} projects...")

        except Exception as e:
            print(f"  Error fetching publications batch {i//batch_size}: {e}")

        time.sleep(0.2)  # Rate limiting

    return all_pubs


def fetch_patents(project_numbers: list, batch_size: int = 50) -> list:
    """Fetch patents linked to project numbers from RePORTER."""
    all_patents = []

    for i in range(0, len(project_numbers), batch_size):
        batch = project_numbers[i:i+batch_size]

        payload = {
            "criteria": {
                "core_project_nums": batch
            },
            "limit": 500,
            "offset": 0
        }

        try:
            resp = requests.post(
                f"{REPORTER_BASE}/patents/search",
                json=payload,
                timeout=30
            )
            resp.raise_for_status()
            data = resp.json()

            results = data.get('results', [])
            for pat in results:
                all_patents.append({
                    'patent_id': pat.get('patent_id'),
                    'project_number': pat.get('coreproject'),
                    'patent_title': pat.get('patent_title'),
                    'patent_org': pat.get('patent_org_name'),
                    'inventors': ', '.join(pat.get('inventors', [])[:5]) if pat.get('inventors') else None
                })

            if (i // batch_size + 1) % 10 == 0:
                print(f"  Fetched patents for {i + len(batch)}/{len(project_numbers)} projects...")

        except Exception as e:
            print(f"  Error fetching patents batch {i//batch_size}: {e}")

        time.sleep(0.2)

    return all_patents


def fetch_clinical_studies(project_numbers: list, batch_size: int = 50) -> list:
    """Fetch clinical trials linked to project numbers from RePORTER."""
    all_trials = []

    for i in range(0, len(project_numbers), batch_size):
        batch = project_numbers[i:i+batch_size]

        payload = {
            "criteria": {
                "core_project_nums": batch
            },
            "limit": 500,
            "offset": 0
        }

        try:
            resp = requests.post(
                f"{REPORTER_BASE}/clinical_studies/search",
                json=payload,
                timeout=30
            )
            resp.raise_for_status()
            data = resp.json()

            results = data.get('results', [])
            for trial in results:
                all_trials.append({
                    'nct_id': trial.get('clinicalstudies_id'),
                    'project_number': trial.get('coreproject'),
                    'study_title': trial.get('study'),
                    'study_status': trial.get('study_status')
                })

            if (i // batch_size + 1) % 10 == 0:
                print(f"  Fetched trials for {i + len(batch)}/{len(project_numbers)} projects...")

        except Exception as e:
            print(f"  Error fetching trials batch {i//batch_size}: {e}")

        time.sleep(0.2)

    return all_trials


def upsert_publications(supabase, publications: list):
    """Upsert publications to database."""
    if not publications:
        return 0

    # First, upsert to publications table
    unique_pubs = {}
    for pub in publications:
        if pub['pmid']:
            unique_pubs[pub['pmid']] = {
                'pmid': pub['pmid'],
                'title': pub['pub_title'],
                'authors': pub['authors'],
                'journal': pub['journal'],
                'year': pub['pub_year'],
                'citation_count': pub['citation_count']
            }

    # Batch upsert publications
    pub_list = list(unique_pubs.values())
    for i in range(0, len(pub_list), 100):
        batch = pub_list[i:i+100]
        try:
            supabase.table('publications').upsert(batch, on_conflict='pmid').execute()
        except Exception as e:
            print(f"  Error upserting publications: {e}")

    # Now upsert project_publications links
    links = []
    for pub in publications:
        if pub['pmid'] and pub['project_number']:
            links.append({
                'project_number': pub['project_number'],
                'pmid': pub['pmid']
            })

    # Deduplicate links
    seen = set()
    unique_links = []
    for link in links:
        key = (link['project_number'], link['pmid'])
        if key not in seen:
            seen.add(key)
            unique_links.append(link)

    for i in range(0, len(unique_links), 100):
        batch = unique_links[i:i+100]
        try:
            supabase.table('project_publications').upsert(
                batch,
                on_conflict='project_number,pmid'
            ).execute()
        except Exception as e:
            print(f"  Error upserting publication links: {e}")

    return len(unique_links)


def upsert_trials(supabase, trials: list):
    """Upsert clinical trials to database."""
    if not trials:
        return 0

    # Deduplicate
    unique_trials = {}
    for trial in trials:
        if trial['nct_id'] and trial['project_number']:
            key = (trial['nct_id'], trial['project_number'])
            if key not in unique_trials:
                unique_trials[key] = trial

    trial_list = list(unique_trials.values())
    inserted = 0

    for i in range(0, len(trial_list), 100):
        batch = trial_list[i:i+100]
        try:
            supabase.table('clinical_studies').upsert(
                batch,
                on_conflict='nct_id,project_number'
            ).execute()
            inserted += len(batch)
        except Exception as e:
            print(f"  Error upserting trials: {e}")

    return inserted


def upsert_patents(supabase, patents: list):
    """Upsert patents to database using junction table pattern."""
    if not patents:
        return 0

    # Separate unique patents from links
    unique_patents = {}
    links = []
    seen_links = set()

    for pat in patents:
        patent_id = pat.get('patent_id')
        project_number = pat.get('project_number')

        if not patent_id:
            continue

        # Track unique patent metadata
        if patent_id not in unique_patents:
            unique_patents[patent_id] = {
                'patent_id': patent_id,
                'patent_title': pat.get('patent_title'),
                'patent_org': pat.get('patent_org'),
                'inventors': pat.get('inventors')
            }

        # Track project links
        if project_number:
            link_key = (project_number, patent_id)
            if link_key not in seen_links:
                seen_links.add(link_key)
                links.append({
                    'project_number': project_number,
                    'patent_id': patent_id
                })

    # Upsert patent metadata
    patent_list = list(unique_patents.values())
    for i in range(0, len(patent_list), 100):
        batch = patent_list[i:i+100]
        try:
            supabase.table('patents').upsert(batch, on_conflict='patent_id').execute()
        except Exception as e:
            print(f"  Error upserting patents: {e}")

    # Upsert project links
    link_count = 0
    for i in range(0, len(links), 100):
        batch = links[i:i+100]
        try:
            supabase.table('project_patents').upsert(
                batch,
                on_conflict='project_number,patent_id'
            ).execute()
            link_count += len(batch)
        except Exception as e:
            print(f"  Error upserting patent links: {e}")

    return link_count


def main():
    print("=" * 60)
    print("FETCH LINKED DATA FOR PROJECTS")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    # Parse args
    fiscal_year = None
    if len(sys.argv) > 1:
        fiscal_year = int(sys.argv[1])
        print(f"Filtering to FY{fiscal_year}")

    supabase = get_supabase_client()
    print("Connected to Supabase\n")

    # Get project numbers
    print("Loading project numbers...")
    query = supabase.table('projects').select('project_number')
    if fiscal_year:
        query = query.eq('fiscal_year', fiscal_year)

    result = query.execute()
    project_numbers = list(set(
        p['project_number'] for p in result.data
        if p.get('project_number')
    ))
    print(f"  Found {len(project_numbers)} unique project numbers")

    # Fetch publications
    print("\n" + "=" * 40)
    print("FETCHING PUBLICATIONS")
    print("=" * 40)
    publications = fetch_publications(project_numbers)
    print(f"  Total publications found: {len(publications)}")

    if publications:
        count = upsert_publications(supabase, publications)
        print(f"  Upserted {count} publication links")

    # Fetch patents
    print("\n" + "=" * 40)
    print("FETCHING PATENTS")
    print("=" * 40)
    patents = fetch_patents(project_numbers)
    print(f"  Total patents found: {len(patents)}")

    if patents:
        count = upsert_patents(supabase, patents)
        print(f"  Upserted {count} patent links")

    # Fetch clinical trials
    print("\n" + "=" * 40)
    print("FETCHING CLINICAL TRIALS")
    print("=" * 40)
    trials = fetch_clinical_studies(project_numbers)
    print(f"  Total trials found: {len(trials)}")

    if trials:
        count = upsert_trials(supabase, trials)
        print(f"  Upserted {count} trial links")

    print("\n" + "=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == '__main__':
    main()
