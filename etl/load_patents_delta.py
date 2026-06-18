"""
Targeted delta ingest for patents (and project_patents links).

Reads an ExPORTER Patents.csv (all-time file), diffs against both the
patents and project_patents DB tables, and upserts ONLY:

  - patents rows that are new or whose patent_title / patent_org differs
  - project_patents rows that are new

Unchanged rows in either table are left alone — `updated_at` is not
touched and no DB write happens for them.

SOP per docs/DATA_PIPELINE_PLAN.md and docs/DATA_SOURCE_PLAYBOOKS.md.
Full-file upsert via load_to_supabase.py is the anomaly. See
scripts/diff-patents.ts to size the delta first.

Two-table ordering: patents are upserted BEFORE project_patents because
the project_patents table has a FK on patent_id → patents(patent_id)
with ON DELETE CASCADE.

Orphans (patent_id or composite link in DB but not in CSV) are NOT
deleted. Per SOP they're left alone — they're either pre-2008-format
project_numbers NIH has since normalized away, or data-corruption rows
from earlier loads we should clean up separately if at all.

Usage:
    python3 etl/load_patents_delta.py path/to/Patents.csv
"""

import os
import sys
from typing import Dict, List, Any, Set, Tuple
from dotenv import load_dotenv

load_dotenv('.env.local')

from supabase import create_client, Client
from process_patents import classify_patent


def get_supabase_client() -> Client:
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise ValueError(
            'Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_KEY '
            '(or SUPABASE_SERVICE_ROLE_KEY) in environment / .env.local'
        )
    return create_client(url, key)


def fetch_db_patents(supabase: Client) -> Dict[str, Dict[str, str]]:
    """Paginate the patents table; return patent_id → {title, org}."""
    print('Reading patents from DB...')
    state: Dict[str, Dict[str, str]] = {}
    page_size = 1000
    offset = 0
    while True:
        result = (
            supabase.table('patents')
            .select('patent_id, patent_title, patent_org')
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            break
        for row in rows:
            pid = row.get('patent_id')
            if not pid:
                continue
            state[pid] = {
                'patent_title': (row.get('patent_title') or '').strip(),
                'patent_org': (row.get('patent_org') or '').strip(),
            }
        if len(rows) < page_size:
            break
        offset += page_size
    print(f'  DB patents: {len(state):,} unique patent_id')
    return state


def fetch_db_links(supabase: Client) -> Set[Tuple[str, str]]:
    """Paginate the project_patents table; return set of (project_number, patent_id)."""
    print('Reading project_patents from DB...')
    state: Set[Tuple[str, str]] = set()
    page_size = 1000
    offset = 0
    while True:
        result = (
            supabase.table('project_patents')
            .select('project_number, patent_id')
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            break
        for row in rows:
            proj = row.get('project_number')
            pat = row.get('patent_id')
            if not proj or not pat:
                continue
            state.add((proj, pat))
        if len(rows) < page_size:
            break
        offset += page_size
    print(f'  DB project_patents: {len(state):,} unique links')
    return state


def read_csv_rows(
    csv_path: str,
) -> Tuple[Dict[str, Dict[str, Any]], Set[Tuple[str, str]]]:
    """
    Read the CSV; return (patents_by_id, link_set).
    patents_by_id: patent_id → row dict with computed classification fields
    link_set: set of (project_number, patent_id) tuples
    """
    import csv as _csv

    print(f'Reading CSV: {csv_path}')
    if not os.path.exists(csv_path):
        print(f'  File not found: {csv_path}')
        sys.exit(1)

    patents_by_id: Dict[str, Dict[str, Any]] = {}
    link_set: Set[Tuple[str, str]] = set()
    skipped_no_patent_id = 0

    with open(csv_path, 'r', encoding='utf-8', errors='replace') as f:
        reader = _csv.DictReader(f)
        for raw in reader:
            patent_id = (raw.get('PATENT_ID') or '').strip()
            if not patent_id:
                skipped_no_patent_id += 1
                continue
            # First occurrence wins for patent metadata (matches process_patents.py).
            if patent_id not in patents_by_id:
                title = (raw.get('PATENT_TITLE') or '').strip()
                classification = classify_patent(title)
                patents_by_id[patent_id] = {
                    'patent_id': patent_id,
                    'patent_title': title,
                    'patent_org': (raw.get('PATENT_ORG_NAME') or '').strip(),
                    **classification,
                }
            proj = (raw.get('PROJECT_ID') or '').strip()
            if proj:
                link_set.add((proj, patent_id))

    print(
        f'  CSV: {len(patents_by_id):,} unique patents, {len(link_set):,} unique links '
        f'({skipped_no_patent_id:,} skipped: no patent_id)'
    )
    return patents_by_id, link_set


def compute_patents_delta(
    csv_patents: Dict[str, Dict[str, Any]],
    db_patents: Dict[str, Dict[str, str]],
) -> List[Dict[str, Any]]:
    """New OR changed (patent_title or patent_org differs). Matches diff-patents.ts."""
    delta: List[Dict[str, Any]] = []
    new_count = 0
    changed_count = 0
    for pid, csv_row in csv_patents.items():
        db_row = db_patents.get(pid)
        if db_row is None:
            delta.append(csv_row)
            new_count += 1
            continue
        if (
            db_row['patent_title'] != csv_row['patent_title']
            or db_row['patent_org'] != csv_row['patent_org']
        ):
            delta.append(csv_row)
            changed_count += 1
    print(
        f'  patents delta: {new_count:,} new + {changed_count:,} changed '
        f'= {len(delta):,} rows to upsert'
    )
    return delta


def compute_links_delta(
    csv_links: Set[Tuple[str, str]], db_links: Set[Tuple[str, str]]
) -> List[Dict[str, str]]:
    """Links are atomic — either present or absent. No field-change detection."""
    new_links = csv_links - db_links
    print(f'  project_patents delta: {len(new_links):,} new links to insert')
    return [{'project_number': p, 'patent_id': pat} for p, pat in new_links]


def upsert_in_batches(
    supabase: Client,
    table: str,
    rows: List[Dict[str, Any]],
    on_conflict: str,
    batch_size: int = 100,
) -> int:
    """
    Upsert with explicit on_conflict. Batch size 100 matches the pattern
    established by load_clinical_studies_delta.py — composite-key ON CONFLICT
    against tens-of-thousands of rows can hit PostgREST's ~8s statement
    timeout at larger batch sizes. Drop to 50 if 100 times out; ANALYZE
    on the target table also helps the planner.
    """
    if not rows:
        return 0
    total = 0
    total_batches = (len(rows) + batch_size - 1) // batch_size
    print(f'  Upserting {len(rows):,} rows to {table} ({total_batches} batches of ≤{batch_size})...')
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        batch_num = (i // batch_size) + 1
        try:
            supabase.table(table).upsert(batch, on_conflict=on_conflict).execute()
            total += len(batch)
            print(f'    Batch {batch_num}/{total_batches}: upserted {len(batch)} rows')
        except Exception as e:
            print(f'    Batch {batch_num}/{total_batches} FAILED: {e}')
            print(f'    Stopping. {total} rows successfully upserted before this batch.')
            raise
    return total


def main() -> None:
    if len(sys.argv) != 2:
        print('Usage: python3 etl/load_patents_delta.py <path-to-Patents.csv>')
        sys.exit(1)
    csv_path = sys.argv[1]

    print('=' * 64)
    print('Patents Delta Ingest (SOP)')
    print('=' * 64)

    supabase = get_supabase_client()
    db_patents = fetch_db_patents(supabase)
    db_links = fetch_db_links(supabase)
    csv_patents, csv_links = read_csv_rows(csv_path)

    patents_delta = compute_patents_delta(csv_patents, db_patents)
    links_delta = compute_links_delta(csv_links, db_links)

    if not patents_delta and not links_delta:
        print('\nNo changes to apply in either table. Done.')
        return

    # Patents FIRST — project_patents.patent_id has FK to patents(patent_id).
    print(f'\nUpserting patents (must come before project_patents due to FK)...')
    patents_upserted = upsert_in_batches(
        supabase, 'patents', patents_delta, on_conflict='patent_id'
    )

    print(f'\nUpserting project_patents links...')
    links_upserted = upsert_in_batches(
        supabase, 'project_patents', links_delta, on_conflict='project_number,patent_id'
    )

    print()
    print('=' * 64)
    print('Done')
    print('=' * 64)
    print(f'patents:         {patents_upserted:,} rows upserted')
    print(f'project_patents: {links_upserted:,} rows upserted')

    print()
    print('Embeddings note: this script does NOT regenerate patent_embedding.')
    print('Newly inserted patents have NULL embeddings; existing patents keep theirs.')
    print('Run `python3 etl/generate_patent_embeddings.py` (default mode — no')
    print('--refresh flag) to fill the NULLs without touching valid embeddings.')


if __name__ == '__main__':
    main()
