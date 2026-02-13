"""
Export projects to CSV for classification via Claude Max.

Only exports projects that need classification:
- primary_category = 'other' (54,680 projects)
- org_type = 'other' (9,841 projects)

For efficient Claude Max processing, outputs can be split into batches.
"""

import os
import csv
import argparse
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

def main():
    parser = argparse.ArgumentParser(description='Export projects for classification')
    parser.add_argument('--all', action='store_true', help='Export all projects (not just "other")')
    parser.add_argument('--limit', type=int, help='Limit number of projects to export')
    parser.add_argument('--batch-size', type=int, default=6000, help='Split into files of this size')
    args = parser.parse_args()

    # Connect to Supabase
    print("=" * 60)
    print("EXPORT PROJECTS FOR CLASSIFICATION")
    print("=" * 60)
    print("\nConnecting to Supabase...")
    supabase = create_client(
        os.environ['NEXT_PUBLIC_SUPABASE_URL'],
        os.environ['SUPABASE_SERVICE_KEY']
    )
    print("✓ Connected to Supabase\n")

    # Count projects needing classification
    if args.all:
        total_response = supabase.table('projects').select('*', count='exact').execute()
        filter_desc = "all projects"
    else:
        # Projects where primary_category='other' OR org_type='other'
        total_response = supabase.table('projects').select('*', count='exact').or_(
            'primary_category.eq.other,org_type.eq.other'
        ).execute()
        filter_desc = "projects where primary_category='other' OR org_type='other'"

    total_to_export = total_response.count
    if args.limit:
        total_to_export = min(total_to_export, args.limit)

    print(f"Exporting: {filter_desc}")
    print(f"Total projects to export: {total_to_export:,}\n")

    if total_to_export == 0:
        print("No projects to export!")
        return

    # Fetch abstracts in batches (Supabase default limit is 1000 rows)
    print("Fetching abstracts...")
    abstracts_map = {}
    abs_offset = 0
    abs_batch = 1000  # Supabase default row limit
    while True:
        abs_response = supabase.table('abstracts').select('application_id, abstract_text').range(abs_offset, abs_offset + abs_batch - 1).execute()
        if not abs_response.data:
            break
        for a in abs_response.data:
            abstracts_map[a['application_id']] = a['abstract_text']
        print(f"  Loaded {len(abstracts_map):,} abstracts...", end='\r')
        if len(abs_response.data) < abs_batch:
            break
        abs_offset += abs_batch
    print(f"✓ Loaded {len(abstracts_map):,} abstracts          \n")

    # Export projects
    output_dir = os.path.dirname(__file__)
    file_index = 1
    total_exported = 0
    current_file_count = 0
    writer = None
    csvfile = None

    def open_new_file():
        nonlocal file_index, current_file_count, writer, csvfile
        if csvfile:
            csvfile.close()
        filename = f'classification_input_{file_index:02d}.csv' if args.batch_size < total_to_export else 'classification_input.csv'
        filepath = os.path.join(output_dir, filename)
        csvfile = open(filepath, 'w', newline='', encoding='utf-8')
        writer = csv.writer(csvfile)
        writer.writerow(['application_id', 'title', 'org_name', 'org_state', 'current_org_type', 'current_category', 'activity_code', 'abstract', 'phr', 'terms'])
        current_file_count = 0
        print(f"  Writing to {filename}...")
        file_index += 1
        return filepath

    current_filepath = open_new_file()
    filepaths = [current_filepath]

    # Fetch and export projects
    offset = 0
    batch_size = 1000

    while total_exported < total_to_export:
        # Build query
        if args.all:
            query = supabase.table('projects').select(
                'application_id, title, org_name, org_state, org_type, primary_category, activity_code, phr, terms'
            )
        else:
            query = supabase.table('projects').select(
                'application_id, title, org_name, org_state, org_type, primary_category, activity_code, phr, terms'
            ).or_('primary_category.eq.other,org_type.eq.other')

        response = query.range(offset, offset + batch_size - 1).execute()
        projects = response.data

        if not projects:
            break

        for project in projects:
            if args.limit and total_exported >= args.limit:
                break

            # Check if need new file
            if current_file_count >= args.batch_size:
                current_filepath = open_new_file()
                filepaths.append(current_filepath)

            app_id = project['application_id']
            abstract = abstracts_map.get(app_id, '') or ''

            # Truncate long fields to manage file size
            abstract_truncated = abstract[:1500] + '...' if len(abstract) > 1500 else abstract

            writer.writerow([
                app_id,
                project.get('title', ''),
                project.get('org_name', ''),
                project.get('org_state', ''),
                project.get('org_type', ''),
                project.get('primary_category', ''),
                project.get('activity_code', ''),
                abstract_truncated,
                (project.get('phr', '') or '')[:500],  # Truncate PHR
                (project.get('terms', '') or '')[:300]  # Terms can be very long
            ])

            total_exported += 1
            current_file_count += 1

        print(f"    Exported {total_exported:,} / {total_to_export:,} projects", flush=True)

        if len(projects) < batch_size:
            break
        offset += batch_size

    if csvfile:
        csvfile.close()

    # Print summary
    print(f"\n✓ Export complete!")
    print(f"  Total exported: {total_exported:,} projects")
    print(f"  Files created:")
    total_size = 0
    for fp in filepaths:
        size = os.path.getsize(fp) / 1024 / 1024
        total_size += size
        print(f"    - {os.path.basename(fp)} ({size:.1f} MB)")
    print(f"  Total size: {total_size:.1f} MB")

    print("\n" + "=" * 60)
    print("NEXT STEPS")
    print("=" * 60)
    print("1. Upload the CSV file(s) to Claude.com Projects")
    print("2. Use the prompt from etl/classification_prompt.md")
    print("3. Copy Claude's CSV output to classification_output.csv")
    print("4. Run: python3 etl/import_classifications.py")
    print("=" * 60)


if __name__ == '__main__':
    main()
