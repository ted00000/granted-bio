"""
Bulk reclassifier: classify every project in the DB using the canonical
classifier (etl/classifier.py).

This script is the orchestrator that load_fiscal_year.sh step 6 invokes.
It now wraps etl/classifier.py rather than embedding its own prompt — the
canonical Pass 1 (Python) + Pass 2 (Haiku) logic lives there.

Important: this runs blanket reclassification across the whole projects
table. For ongoing maintenance (only new + content-changed rows), use
etl/sync_projects_via_api.py (new awards) or etl/reclassify_existing.py
(targeted reclassification of low-confidence subsets).

Usage:
    python3 etl/classify_projects_batched.py [--limit N] [--dry-run]
"""

import argparse
import json
import os
import sys
from dotenv import load_dotenv

load_dotenv('.env.local')

from supabase import create_client

# Canonical classifier
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classifier import classify_projects, PROJECTS_PER_API_CALL


DB_BATCH_SIZE = 100


def get_supabase():
    return create_client(
        os.environ['NEXT_PUBLIC_SUPABASE_URL'],
        os.environ['SUPABASE_SERVICE_KEY'],
    )


def fetch_abstracts(supabase, app_ids):
    """Fetch abstracts for the given application_ids in chunks."""
    out = {}
    chunk = 500
    for i in range(0, len(app_ids), chunk):
        batch = app_ids[i:i + chunk]
        result = supabase.table('abstracts').select('application_id, abstract_text').in_('application_id', batch).execute()
        for row in (result.data or []):
            out[str(row['application_id'])] = row.get('abstract_text') or ''
    return out


def update_db(supabase, classifications):
    """Write classifications back to the projects table."""
    updated = 0
    for c in classifications:
        try:
            supabase.table('projects').update({
                'primary_category': c['primary_category'],
                'primary_category_confidence': c['category_confidence'],
                'org_type': c['org_type'],
            }).eq('application_id', c['application_id']).execute()
            updated += 1
        except Exception as e:
            print(f"  DB update error for {c.get('application_id')}: {str(e)[:120]}")
    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=None, help='Stop after N projects')
    parser.add_argument('--dry-run', action='store_true', help='Skip DB writes')
    args = parser.parse_args()

    print('=' * 64)
    print('Bulk project classification (canonical classifier)')
    print('=' * 64)

    supabase = get_supabase()

    # Get total count
    total_result = supabase.table('projects').select('application_id', count='exact').execute()
    total_projects = total_result.count
    print(f'  Total projects in DB: {total_projects:,}')
    if args.limit:
        print(f'  Limit applied: {args.limit:,}')
    if args.dry_run:
        print('  DRY RUN — no DB writes')
    print()

    total_classified = 0
    total_errors = 0
    offset = 0

    while True:
        if args.limit and total_classified >= args.limit:
            break

        # Fetch a page of projects
        page = supabase.table('projects').select(
            'application_id, activity_code, title, org_name, phr, funding_mechanism'
        ).range(offset, offset + DB_BATCH_SIZE - 1).execute()

        projects = page.data or []
        if not projects:
            break

        # Fetch corresponding abstracts
        app_ids = [str(p['application_id']) for p in projects]
        abstracts = fetch_abstracts(supabase, app_ids)

        # Normalize application_id to string for the classifier
        for p in projects:
            p['application_id'] = str(p.get('application_id'))

        # Classify the page
        classifications = classify_projects(projects, abstracts)
        page_classified = len(classifications)
        page_errors = len(projects) - page_classified

        if not args.dry_run:
            update_db(supabase, classifications)

        total_classified += page_classified
        total_errors += page_errors
        offset += DB_BATCH_SIZE

        print(f'  Progress: {total_classified:,} / {total_projects:,} '
              f'({total_classified / total_projects * 100:.1f}%) — '
              f'page classified={page_classified}, errors={page_errors}')

    print()
    print('=' * 64)
    print(f'Done. {total_classified:,} classified, {total_errors:,} errors.')
    print('=' * 64)


if __name__ == '__main__':
    main()
