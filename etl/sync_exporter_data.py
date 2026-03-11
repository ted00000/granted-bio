#!/usr/bin/env python3
"""
Sync ExPORTER data from -2 files (latest March 8, 2026 data).
Ensures database is complete and matches ExPORTER bulk files.
"""

import os
import sys
import csv
import json
from datetime import datetime
from typing import Dict, Any, Optional, Set
from collections import Counter

sys.stdout.reconfigure(line_buffering=True)

from dotenv import load_dotenv

# Load env from project root
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
load_dotenv(os.path.join(project_root, '.env.local'))

from supabase import create_client

# Import processors
from process_projects import process_projects_csv, is_bio_related, parse_date, parse_cost, determine_org_type, parse_supplement_info
from process_patents import classify_patent
from classify_projects import classify_biotools_confidence


def get_supabase_client():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')
    return create_client(url, key)


def fetch_all_ids(supabase, table: str, id_column: str, filters: dict = None) -> Set[str]:
    """Fetch all IDs from a table, handling pagination."""
    all_ids = set()
    offset = 0
    batch_size = 1000

    while True:
        query = supabase.table(table).select(id_column)
        if filters:
            for col, val in filters.items():
                query = query.eq(col, val)
        result = query.range(offset, offset + batch_size - 1).execute()

        if not result.data:
            break

        for row in result.data:
            val = row.get(id_column)
            if val:
                all_ids.add(str(val))

        if len(result.data) < batch_size:
            break
        offset += batch_size

    return all_ids


def batch_upsert(supabase, table: str, records: list, on_conflict: str, batch_size: int = 100):
    """Upsert records in batches."""
    inserted = 0
    errors = 0

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        try:
            supabase.table(table).upsert(batch, on_conflict=on_conflict).execute()
            inserted += len(batch)
        except Exception as e:
            errors += len(batch)
            print(f"  Error batch {i//batch_size}: {str(e)[:100]}")

    return inserted, errors


def sync_projects(supabase, data_dir: str = 'data/raw'):
    """Sync FY2025 projects from -2 file."""
    print("\n" + "=" * 60)
    print("SYNCING FY2025 PROJECTS")
    print("=" * 60)

    filepath = os.path.join(data_dir, 'RePORTER_PRJ_C_FY2025-2.csv')
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return 0

    # Get existing IDs
    print("Fetching existing FY2025 project IDs from DB...")
    existing_ids = fetch_all_ids(supabase, 'projects', 'application_id', {'fiscal_year': 2025})
    print(f"  Found {len(existing_ids):,} existing FY2025 projects")

    # Process CSV and find missing
    print("Processing CSV file...")
    projects_to_add = []
    total_in_csv = 0
    bio_count = 0

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_in_csv += 1

            if not is_bio_related(row):
                continue

            bio_count += 1
            app_id = row.get('APPLICATION_ID')

            if app_id and str(app_id) not in existing_ids:
                org_name = row.get('ORG_NAME', '')
                funding_mechanism = row.get('FUNDING_MECHANISM', '')
                full_project_num = row.get('FULL_PROJECT_NUM')
                is_supplement, supplement_number = parse_supplement_info(full_project_num)

                project = {
                    'application_id': app_id,
                    'project_number': row.get('CORE_PROJECT_NUM'),
                    'full_project_num': full_project_num,
                    'activity_code': row.get('ACTIVITY'),
                    'funding_mechanism': funding_mechanism,
                    'title': row.get('PROJECT_TITLE'),
                    'terms': row.get('PROJECT_TERMS'),
                    'phr': row.get('PHR'),
                    'org_name': org_name,
                    'org_type': determine_org_type(org_name, funding_mechanism),
                    'org_city': row.get('ORG_CITY'),
                    'org_state': row.get('ORG_STATE'),
                    'org_country': row.get('ORG_COUNTRY'),
                    'org_zip': row.get('ORG_ZIPCODE'),
                    'total_cost': parse_cost(row.get('TOTAL_COST')),
                    'award_date': parse_date(row.get('AWARD_NOTICE_DATE')),
                    'project_start': parse_date(row.get('PROJECT_START')),
                    'project_end': parse_date(row.get('PROJECT_END')),
                    'fiscal_year': 2025,
                    'pi_names': row.get('PI_NAMEs'),
                    'funding_agency': 'NIH',
                    'is_bio_related': True,
                    'is_supplement': is_supplement,
                    'supplement_number': supplement_number,
                }
                projects_to_add.append(project)

    print(f"  CSV total rows: {total_in_csv:,}")
    print(f"  Bio-related: {bio_count:,}")
    print(f"  Missing from DB: {len(projects_to_add):,}")

    if not projects_to_add:
        print("  No new projects to add")
        return 0

    # Upsert
    print(f"Inserting {len(projects_to_add):,} new projects...")
    inserted, errors = batch_upsert(supabase, 'projects', projects_to_add, 'application_id')
    print(f"  Inserted: {inserted:,}, Errors: {errors}")

    return inserted


def sync_abstracts(supabase, data_dir: str = 'data/raw'):
    """Sync FY2025 abstracts from -2 file."""
    print("\n" + "=" * 60)
    print("SYNCING FY2025 ABSTRACTS")
    print("=" * 60)

    filepath = os.path.join(data_dir, 'RePORTER_PRJABS_C_FY2025-2.csv')
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return 0

    # Get existing IDs
    print("Fetching existing abstract IDs from DB...")
    existing_ids = fetch_all_ids(supabase, 'abstracts', 'application_id')
    print(f"  Found {len(existing_ids):,} existing abstracts")

    # Get project IDs (can only add abstracts for existing projects)
    print("Fetching project IDs...")
    project_ids = fetch_all_ids(supabase, 'projects', 'application_id')
    print(f"  Found {len(project_ids):,} projects")

    # Process CSV
    print("Processing CSV file...")
    abstracts_to_add = []
    total_in_csv = 0

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_in_csv += 1
            app_id = row.get('APPLICATION_ID')
            abstract_text = row.get('ABSTRACT_TEXT')

            if app_id and abstract_text:
                # Only add if project exists and abstract doesn't
                if str(app_id) in project_ids and str(app_id) not in existing_ids:
                    abstracts_to_add.append({
                        'application_id': app_id,
                        'abstract_text': abstract_text,
                        'abstract_length': len(abstract_text),
                    })

    print(f"  CSV total rows: {total_in_csv:,}")
    print(f"  Missing from DB: {len(abstracts_to_add):,}")

    if not abstracts_to_add:
        print("  No new abstracts to add")
        return 0

    # Upsert
    print(f"Inserting {len(abstracts_to_add):,} new abstracts...")
    inserted, errors = batch_upsert(supabase, 'abstracts', abstracts_to_add, 'application_id')
    print(f"  Inserted: {inserted:,}, Errors: {errors}")

    return inserted


def sync_clinical_studies(supabase, data_dir: str = 'data/raw'):
    """Sync clinical studies from -2 file."""
    print("\n" + "=" * 60)
    print("SYNCING CLINICAL STUDIES")
    print("=" * 60)

    filepath = os.path.join(data_dir, 'ClinicalStudies-2.csv')
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return 0

    # Get existing links
    print("Fetching existing clinical study links from DB...")
    existing_links = set()
    offset = 0
    while True:
        result = supabase.table('clinical_studies').select('nct_id,project_number').range(offset, offset + 999).execute()
        if not result.data:
            break
        for row in result.data:
            if row.get('nct_id') and row.get('project_number'):
                existing_links.add((row['nct_id'], row['project_number']))
        if len(result.data) < 1000:
            break
        offset += 1000

    print(f"  Found {len(existing_links):,} existing links")

    # Process CSV
    print("Processing CSV file...")
    studies_to_add = []
    total_in_csv = 0

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_in_csv += 1
            nct_id = row.get('ClinicalTrials.gov ID')
            project_number = row.get('Core Project Number')

            if nct_id and project_number:
                link_key = (nct_id, project_number)
                if link_key not in existing_links:
                    studies_to_add.append({
                        'nct_id': nct_id,
                        'project_number': project_number,
                        'study_title': row.get('Study'),
                        'study_status': row.get('Study Status'),
                    })

    print(f"  CSV total rows: {total_in_csv:,}")
    print(f"  Missing from DB: {len(studies_to_add):,}")

    if not studies_to_add:
        print("  No new clinical studies to add")
        return 0

    # Upsert
    print(f"Inserting {len(studies_to_add):,} new clinical studies...")
    inserted, errors = batch_upsert(supabase, 'clinical_studies', studies_to_add, 'nct_id,project_number')
    print(f"  Inserted: {inserted:,}, Errors: {errors}")

    return inserted


def sync_patents(supabase, data_dir: str = 'data/raw'):
    """Sync patents and patent links from -2 file."""
    print("\n" + "=" * 60)
    print("SYNCING PATENTS")
    print("=" * 60)

    filepath = os.path.join(data_dir, 'Patents-2.csv')
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return 0

    # Get existing patents and links
    print("Fetching existing patent IDs from DB...")
    existing_patents = fetch_all_ids(supabase, 'patents', 'patent_id')
    print(f"  Found {len(existing_patents):,} existing patents")

    print("Fetching existing patent links from DB...")
    existing_links = set()
    offset = 0
    while True:
        result = supabase.table('project_patents').select('project_number,patent_id').range(offset, offset + 999).execute()
        if not result.data:
            break
        for row in result.data:
            if row.get('patent_id') and row.get('project_number'):
                existing_links.add((row['project_number'], row['patent_id']))
        if len(result.data) < 1000:
            break
        offset += 1000
    print(f"  Found {len(existing_links):,} existing links")

    # Process CSV
    print("Processing CSV file...")
    patents_to_add = {}
    links_to_add = []
    total_in_csv = 0

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_in_csv += 1
            patent_id = row.get('PATENT_ID')
            project_number = row.get('PROJECT_ID')

            if not patent_id:
                continue

            # Check for new patent metadata
            if patent_id not in existing_patents and patent_id not in patents_to_add:
                patent_title = row.get('PATENT_TITLE', '')
                classification = classify_patent(patent_title)
                patents_to_add[patent_id] = {
                    'patent_id': patent_id,
                    'patent_title': patent_title,
                    'patent_org': row.get('PATENT_ORG_NAME'),
                    **classification,
                }

            # Check for new link
            if project_number:
                link_key = (project_number, patent_id)
                if link_key not in existing_links:
                    links_to_add.append({
                        'project_number': project_number,
                        'patent_id': patent_id,
                    })
                    existing_links.add(link_key)  # Prevent duplicates in batch

    print(f"  CSV total rows: {total_in_csv:,}")
    print(f"  New patents: {len(patents_to_add):,}")
    print(f"  New links: {len(links_to_add):,}")

    inserted_patents = 0
    inserted_links = 0

    if patents_to_add:
        print(f"Inserting {len(patents_to_add):,} new patents...")
        inserted, errors = batch_upsert(supabase, 'patents', list(patents_to_add.values()), 'patent_id')
        inserted_patents = inserted
        print(f"  Inserted: {inserted:,}, Errors: {errors}")

    if links_to_add:
        print(f"Inserting {len(links_to_add):,} new patent links...")
        inserted, errors = batch_upsert(supabase, 'project_patents', links_to_add, 'project_number,patent_id')
        inserted_links = inserted
        print(f"  Inserted: {inserted:,}, Errors: {errors}")

    return inserted_patents + inserted_links


def sync_publications(supabase, data_dir: str = 'data/raw'):
    """Sync publications and publication links from -2 files."""
    print("\n" + "=" * 60)
    print("SYNCING PUBLICATIONS")
    print("=" * 60)

    pub_filepath = os.path.join(data_dir, 'RePORTER_PUB_C_FY2025-2.csv')
    link_filepath = os.path.join(data_dir, 'RePORTER_PUBLNK_C_FY2025-2.csv')

    if not os.path.exists(pub_filepath):
        print(f"File not found: {pub_filepath}")
        return 0

    # Get existing publications
    print("Fetching existing publication PMIDs from DB...")
    existing_pubs = fetch_all_ids(supabase, 'publications', 'pmid')
    print(f"  Found {len(existing_pubs):,} existing publications")

    # Process publications CSV
    print("Processing publications CSV file...")
    pubs_to_add = {}
    total_in_csv = 0

    with open(pub_filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_in_csv += 1
            pmid = row.get('PMID')

            if pmid and pmid not in existing_pubs and pmid not in pubs_to_add:
                pubs_to_add[pmid] = {
                    'pmid': pmid,
                    'title': row.get('PUB_TITLE'),
                    'authors': row.get('AUTHOR_LIST'),
                    'journal': row.get('JOURNAL_TITLE'),
                    'year': int(row.get('PUB_YEAR')) if row.get('PUB_YEAR') else None,
                    'citation_count': int(row.get('CITATION_COUNT', 0) or 0),
                }

    print(f"  Publications CSV rows: {total_in_csv:,}")
    print(f"  New publications: {len(pubs_to_add):,}")

    # Get existing links
    print("Fetching existing publication links from DB...")
    existing_links = set()
    offset = 0
    while True:
        result = supabase.table('project_publications').select('project_number,pmid').range(offset, offset + 999).execute()
        if not result.data:
            break
        for row in result.data:
            if row.get('pmid') and row.get('project_number'):
                existing_links.add((row['project_number'], row['pmid']))
        if len(result.data) < 1000:
            break
        offset += 1000
    print(f"  Found {len(existing_links):,} existing links")

    # Process links CSV
    links_to_add = []
    total_links_in_csv = 0

    if os.path.exists(link_filepath):
        print("Processing publication links CSV file...")
        with open(link_filepath, 'r', encoding='utf-8', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                total_links_in_csv += 1
                pmid = row.get('PMID')
                project_number = row.get('PROJECT_NUMBER')

                if pmid and project_number:
                    link_key = (project_number, pmid)
                    if link_key not in existing_links:
                        links_to_add.append({
                            'project_number': project_number,
                            'pmid': pmid,
                        })
                        existing_links.add(link_key)

        print(f"  Links CSV rows: {total_links_in_csv:,}")
        print(f"  New links: {len(links_to_add):,}")

    inserted_pubs = 0
    inserted_links = 0

    if pubs_to_add:
        print(f"Inserting {len(pubs_to_add):,} new publications...")
        inserted, errors = batch_upsert(supabase, 'publications', list(pubs_to_add.values()), 'pmid')
        inserted_pubs = inserted
        print(f"  Inserted: {inserted:,}, Errors: {errors}")

    if links_to_add:
        print(f"Inserting {len(links_to_add):,} new publication links...")
        inserted, errors = batch_upsert(supabase, 'project_publications', links_to_add, 'project_number,pmid')
        inserted_links = inserted
        print(f"  Inserted: {inserted:,}, Errors: {errors}")

    return inserted_pubs + inserted_links


def verify_counts(supabase, data_dir: str = 'data/raw'):
    """Verify database counts match CSV files."""
    print("\n" + "=" * 60)
    print("VERIFICATION")
    print("=" * 60)

    results = []

    # Projects FY2025
    result = supabase.table('projects').select('*', count='exact', head=True).eq('fiscal_year', 2025).execute()
    db_count = result.count

    csv_count = 0
    bio_count = 0
    filepath = os.path.join(data_dir, 'RePORTER_PRJ_C_FY2025-2.csv')
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                csv_count += 1
                if is_bio_related(row):
                    bio_count += 1

    match = "✅" if db_count == bio_count else "❌"
    results.append(('FY2025 Projects', db_count, bio_count, match))
    print(f"FY2025 Projects: DB={db_count:,} CSV(bio)={bio_count:,} {match}")

    # Clinical studies
    result = supabase.table('clinical_studies').select('*', count='exact', head=True).execute()
    db_count = result.count

    csv_count = 0
    filepath = os.path.join(data_dir, 'ClinicalStudies-2.csv')
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            seen = set()
            reader = csv.DictReader(f)
            for row in reader:
                nct = row.get('ClinicalTrials.gov ID')
                proj = row.get('Core Project Number')
                if nct and proj:
                    key = (nct, proj)
                    if key not in seen:
                        seen.add(key)
                        csv_count += 1

    match = "✅" if db_count == csv_count else "❌"
    results.append(('Clinical Studies', db_count, csv_count, match))
    print(f"Clinical Studies: DB={db_count:,} CSV={csv_count:,} {match}")

    # Patents
    result = supabase.table('patents').select('*', count='exact', head=True).execute()
    db_patents = result.count
    result = supabase.table('project_patents').select('*', count='exact', head=True).execute()
    db_links = result.count

    csv_patents = set()
    csv_links = set()
    filepath = os.path.join(data_dir, 'Patents-2.csv')
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                pid = row.get('PATENT_ID')
                proj = row.get('PROJECT_ID')
                if pid:
                    csv_patents.add(pid)
                    if proj:
                        csv_links.add((proj, pid))

    match = "✅" if db_patents == len(csv_patents) else "❌"
    results.append(('Patents', db_patents, len(csv_patents), match))
    print(f"Patents: DB={db_patents:,} CSV={len(csv_patents):,} {match}")

    match = "✅" if db_links == len(csv_links) else "❌"
    results.append(('Patent Links', db_links, len(csv_links), match))
    print(f"Patent Links: DB={db_links:,} CSV={len(csv_links):,} {match}")

    # Publications
    result = supabase.table('project_publications').select('*', count='exact', head=True).execute()
    db_links = result.count

    csv_links = set()
    filepath = os.path.join(data_dir, 'RePORTER_PUBLNK_C_FY2025-2.csv')
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                pmid = row.get('PMID')
                proj = row.get('PROJECT_NUMBER')
                if pmid and proj:
                    csv_links.add((proj, pmid))

    # Note: DB includes links from multiple FYs, CSV is FY2025 only
    print(f"Publication Links: DB={db_links:,} (FY2025 CSV={len(csv_links):,})")

    return results


def main():
    print("=" * 60)
    print("EXPORTER DATA SYNC")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    supabase = get_supabase_client()
    print("Connected to Supabase")

    data_dir = os.path.join(project_root, 'data/raw')

    # Sync all data types
    sync_projects(supabase, data_dir)
    sync_abstracts(supabase, data_dir)
    sync_clinical_studies(supabase, data_dir)
    sync_patents(supabase, data_dir)
    sync_publications(supabase, data_dir)

    # Verify
    verify_counts(supabase, data_dir)

    print("\n" + "=" * 60)
    print("SYNC COMPLETE")
    print("=" * 60)


if __name__ == '__main__':
    main()
