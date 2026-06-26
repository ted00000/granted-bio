"""
Targeted delta ingest for clinical_studies.

Reads an ExPORTER ClinicalStudies.csv (all-time file), queries the DB for
existing composite (nct_id, project_number) keys, and upserts ONLY the
rows that are new or whose study_status / study_title differs from the
current DB row. Unchanged rows are left alone — their `updated_at` is
not touched and no DB write happens for them.

This is the SOP per docs/DATA_PIPELINE_PLAN.md and
docs/DATA_SOURCE_PLAYBOOKS.md. Full-file upsert via load_to_supabase.py
is the anomaly, not the default — use it only when you have a strong,
documented justification (e.g., recovering from a corrupted load).

Usage:
    python etl/load_clinical_studies_delta.py path/to/ClinicalStudies.csv

Run scripts/diff-clinical-studies.ts first to see the delta size before
ingesting.

Prereq: the (nct_id, project_number) unique constraint must exist in
prod. Added by migration 20260617_clinical_studies_composite_unique.sql.

Embedding regeneration is NOT triggered by this script. Newly inserted
rows have NULL study_embedding; run etl/regenerate_trial_embeddings.py
(default mode, no --refresh) afterward to fill them. Existing rows
with valid embeddings stay untouched.
"""

import os
import sys
from typing import Dict, List, Any
from dotenv import load_dotenv

# Load .env.local before any Supabase import
load_dotenv('.env.local')

# These imports need etl/ on sys.path. Python adds the script's directory
# automatically when running `python etl/load_clinical_studies_delta.py`.
from supabase import create_client, Client
from process_clinical import classify_clinical_study


def get_supabase_client() -> Client:
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise ValueError(
            'Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_KEY '
            '(or SUPABASE_SERVICE_ROLE_KEY) in environment / .env.local'
        )
    return create_client(url, key)


def fetch_db_state(supabase: Client) -> Dict[str, Dict[str, str]]:
    """
    Page through clinical_studies and return composite-key → {status, title}.
    Supabase caps single-query returns at 1000 rows, so we paginate.
    """
    print('Reading clinical_studies from DB...')
    state: Dict[str, Dict[str, str]] = {}
    page_size = 1000
    offset = 0
    while True:
        result = (
            supabase.table('clinical_studies')
            .select('nct_id, project_number, study_status, study_title')
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            break
        for row in rows:
            nct = row.get('nct_id')
            proj = row.get('project_number')
            if not nct or not proj:
                continue
            state[f'{nct}|{proj}'] = {
                'study_status': (row.get('study_status') or '').strip(),
                'study_title': (row.get('study_title') or '').strip(),
            }
        if len(rows) < page_size:
            break
        offset += page_size
    print(f'  DB: {len(state):,} unique composite keys')
    return state


def read_csv_rows(csv_path: str) -> Dict[str, Dict[str, Any]]:
    """
    Read the CSV, compute the is_diagnostic/is_therapeutic classification per
    row, and return composite-key → row dict shaped for upsert.
    """
    import csv as _csv  # local import so the module name doesn't clash

    print(f'Reading CSV: {csv_path}')
    if not os.path.exists(csv_path):
        print(f'  File not found: {csv_path}')
        sys.exit(1)

    rows: Dict[str, Dict[str, Any]] = {}
    skipped_no_key = 0

    with open(csv_path, 'r', encoding='utf-8', newline='') as f:
        reader = _csv.DictReader(f)
        for raw in reader:
            nct = (raw.get('ClinicalTrials.gov ID') or '').strip()
            proj = (raw.get('Core Project Number') or '').strip()
            if not nct or not proj:
                skipped_no_key += 1
                continue
            title = (raw.get('Study') or '').strip()
            classification = classify_clinical_study(title)
            rows[f'{nct}|{proj}'] = {
                'nct_id': nct,
                'project_number': proj,
                'study_title': title,
                'study_status': (raw.get('Study Status') or '').strip(),
                'is_diagnostic_trial': classification['is_diagnostic_trial'],
                'is_therapeutic_trial': classification['is_therapeutic_trial'],
            }

    print(
        f'  CSV: {len(rows):,} unique composite keys '
        f'({skipped_no_key:,} skipped: missing key field)'
    )
    return rows


def compute_delta(
    csv_rows: Dict[str, Dict[str, Any]],
    db_state: Dict[str, Dict[str, str]],
) -> List[Dict[str, Any]]:
    """
    Return only rows where the composite key is new OR the
    study_status / study_title in the CSV differs from the DB row.
    Matches the change-detection field set used by scripts/diff-clinical-studies.ts
    so the delta script and the diff script agree on what counts as "changed."
    """
    delta: List[Dict[str, Any]] = []
    new_count = 0
    changed_count = 0
    for key, csv_row in csv_rows.items():
        db_row = db_state.get(key)
        if db_row is None:
            delta.append(csv_row)
            new_count += 1
            continue
        if (
            db_row['study_status'] != csv_row['study_status']
            or db_row['study_title'] != csv_row['study_title']
        ):
            delta.append(csv_row)
            changed_count += 1
    print(
        f'  Delta: {new_count:,} new + {changed_count:,} changed '
        f'= {len(delta):,} rows to upsert'
    )
    return delta


def upsert_in_batches(
    supabase: Client, rows: List[Dict[str, Any]], batch_size: int = 25
) -> int:
    """
    Upsert with explicit on_conflict on the composite (nct_id, project_number)
    natural key. Requires the matching unique constraint to exist in prod.

    Batch size of 100 (not 500) is intentional: PostgREST has a statement
    timeout (~8s) and composite-key ON CONFLICT against a multi-tens-of-
    thousands-row table is slow enough that 500-row batches hit the
    timeout. If 100 still times out, drop to 50; ANALYZE on the table
    can also help the planner pick the new index.
    """
    total = 0
    total_batches = (len(rows) + batch_size - 1) // batch_size
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        batch_num = (i // batch_size) + 1
        try:
            supabase.table('clinical_studies').upsert(
                batch, on_conflict='nct_id,project_number'
            ).execute()
            total += len(batch)
            print(f'  Batch {batch_num}/{total_batches}: upserted {len(batch)} rows')
        except Exception as e:
            print(f'  Batch {batch_num}/{total_batches} FAILED: {e}')
            print(f'  Stopping. {total} rows successfully upserted before this batch.')
            raise
    return total


def main() -> None:
    if len(sys.argv) != 2:
        print(
            'Usage: python etl/load_clinical_studies_delta.py '
            '<path-to-ClinicalStudies.csv>'
        )
        sys.exit(1)
    csv_path = sys.argv[1]

    print('=' * 64)
    print('Clinical Studies Delta Ingest (SOP)')
    print('=' * 64)

    supabase = get_supabase_client()
    db_state = fetch_db_state(supabase)
    csv_rows = read_csv_rows(csv_path)
    delta = compute_delta(csv_rows, db_state)

    if not delta:
        print('\nNo new or changed rows. Nothing to upsert. Done.')
        return

    print(f'\nUpserting {len(delta):,} rows to clinical_studies...')
    upserted = upsert_in_batches(supabase, delta)
    print(f'\n✓ Done. {upserted:,} rows upserted.')

    print()
    print('Embeddings note: this script does NOT regenerate study_embedding.')
    print('Newly inserted rows have NULL embeddings; existing rows keep theirs.')
    print('Run `python etl/regenerate_trial_embeddings.py` (default mode — no')
    print('--refresh flag) to fill the NULLs without touching valid embeddings.')


if __name__ == '__main__':
    main()
