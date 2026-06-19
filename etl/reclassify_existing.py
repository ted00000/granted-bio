"""
Targeted reclassification of existing projects in the DB.

This is the SOP tool for fixing poorly-classified existing data, scoped to
whatever subset you specify (low-confidence, specific category, NULL
primary_category, etc.). It uses the same canonical classifier as the API
sync and the bulk reclassifier — etl/classifier.py.

Common use cases:

  # Reclassify projects with low confidence in their current classification
  python3 etl/reclassify_existing.py --confidence-below 60

  # Reclassify all NULL-category projects (e.g., post-load_to_supabase ingest)
  python3 etl/reclassify_existing.py --where-null

  # Reclassify a specific category (e.g., audit "other" classifications)
  python3 etl/reclassify_existing.py --current-category other

  # Reclassify by activity code prefix (e.g., audit all K-series)
  python3 etl/reclassify_existing.py --activity-prefix K

  # Combine: low confidence biotools projects
  python3 etl/reclassify_existing.py --current-category biotools --confidence-below 70

  # Limit + dry-run for safety
  python3 etl/reclassify_existing.py --where-null --limit 100 --dry-run

The script always shows you the count of projects matching the filter before
classifying, so you can sanity-check before spending API budget. Pass --yes
to skip the confirmation prompt.
"""

import argparse
import os
import sys
from dotenv import load_dotenv

load_dotenv('.env.local')

from supabase import create_client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classifier import classify_projects


DB_BATCH_SIZE = 100


def get_supabase():
    return create_client(
        os.environ['NEXT_PUBLIC_SUPABASE_URL'],
        os.environ['SUPABASE_SERVICE_KEY'],
    )


def build_query(supabase, args):
    """Build the projects-table query that matches the operator's filter."""
    q = supabase.table('projects').select(
        'application_id, activity_code, title, org_name, phr, funding_mechanism, '
        'primary_category, primary_category_confidence',
        count='exact'
    )
    if args.where_null:
        q = q.is_('primary_category', 'null')
    if args.current_category:
        q = q.eq('primary_category', args.current_category)
    if args.confidence_below is not None:
        q = q.lt('primary_category_confidence', args.confidence_below)
    if args.activity_prefix:
        q = q.like('activity_code', f'{args.activity_prefix.upper()}%')
    return q


def fetch_page(supabase, args, offset):
    q = build_query(supabase, args)
    page = q.range(offset, offset + DB_BATCH_SIZE - 1).execute()
    return page.data or [], page.count or 0


def fetch_abstracts(supabase, app_ids):
    out = {}
    chunk = 500
    for i in range(0, len(app_ids), chunk):
        batch = app_ids[i:i + chunk]
        result = supabase.table('abstracts').select('application_id, abstract_text').in_('application_id', batch).execute()
        for row in (result.data or []):
            out[str(row['application_id'])] = row.get('abstract_text') or ''
    return out


def update_db(supabase, classifications):
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
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--where-null', action='store_true', help='Only projects with NULL primary_category')
    parser.add_argument('--current-category', help='Only projects currently classified as this category')
    parser.add_argument('--confidence-below', type=float, help='Only projects with primary_category_confidence below this value')
    parser.add_argument('--activity-prefix', help='Only projects whose activity_code starts with this string (e.g. "K")')
    parser.add_argument('--limit', type=int, default=None, help='Stop after N projects')
    parser.add_argument('--dry-run', action='store_true', help='Skip DB writes; just print what would change')
    parser.add_argument('--yes', action='store_true', help='Skip the confirmation prompt')
    args = parser.parse_args()

    if not any([args.where_null, args.current_category, args.confidence_below is not None, args.activity_prefix]):
        print('ERROR: must specify at least one filter (--where-null, --current-category, --confidence-below, or --activity-prefix).')
        print('Use --help for usage examples.')
        sys.exit(1)

    print('=' * 64)
    print('Targeted reclassification')
    print('=' * 64)
    print('Filter:')
    if args.where_null:
        print('  primary_category IS NULL')
    if args.current_category:
        print(f'  primary_category = {args.current_category}')
    if args.confidence_below is not None:
        print(f'  primary_category_confidence < {args.confidence_below}')
    if args.activity_prefix:
        print(f'  activity_code LIKE {args.activity_prefix.upper()}%')
    if args.limit:
        print(f'  limit: {args.limit:,}')
    if args.dry_run:
        print('  DRY RUN — no DB writes')
    print()

    supabase = get_supabase()

    # Probe total
    _, total = fetch_page(supabase, args, 0)
    print(f'Projects matching filter: {total:,}')

    if total == 0:
        print('Nothing to reclassify. Done.')
        return

    if not args.yes and not args.dry_run:
        resp = input(f'\nReclassify {total:,} projects? [y/N] ').strip().lower()
        if resp != 'y':
            print('Aborted.')
            return

    total_classified = 0
    total_errors = 0
    total_changes = 0
    offset = 0

    while True:
        if args.limit and total_classified >= args.limit:
            break

        page, _ = fetch_page(supabase, args, offset)
        if not page:
            break

        # Track original classifications for change-counting
        original_by_id = {str(p['application_id']): (p.get('primary_category'), p.get('primary_category_confidence')) for p in page}

        # Stringify IDs for classifier
        for p in page:
            p['application_id'] = str(p.get('application_id'))

        app_ids = [p['application_id'] for p in page]
        abstracts = fetch_abstracts(supabase, app_ids)

        classifications = classify_projects(page, abstracts)
        page_classified = len(classifications)
        page_errors = len(page) - page_classified

        # Count category changes vs original
        page_changes = 0
        for c in classifications:
            app_id = c['application_id']
            old_cat, _ = original_by_id.get(app_id, (None, None))
            if old_cat != c['primary_category']:
                page_changes += 1

        if not args.dry_run:
            update_db(supabase, classifications)

        total_classified += page_classified
        total_errors += page_errors
        total_changes += page_changes
        offset += DB_BATCH_SIZE

        print(f'  Progress: {total_classified:,} classified, {page_changes} category changes this page')

    print()
    print('=' * 64)
    print(f'Done.')
    print(f'  Classified: {total_classified:,}')
    print(f'  Errors:     {total_errors:,}')
    print(f'  Changes:    {total_changes:,} (projects whose primary_category changed)')
    print('=' * 64)


if __name__ == '__main__':
    main()
