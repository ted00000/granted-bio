"""
Export active SBIR projects to CSV.
Columns: Organization Name, PI Name, SBIR Phase, Project Number, Project Title, Life Science Category
"""

import os
import csv
from datetime import datetime
import pathlib
from dotenv import load_dotenv
load_dotenv(pathlib.Path(__file__).parent.parent / '.env.local')

from supabase import create_client

# Initialize client
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

# SBIR activity codes
SBIR_CODES = ['R41', 'R42', 'R43', 'R44', 'SB1', 'U44']

# Map activity codes to phases
PHASE_MAP = {
    'R41': 'Phase I',
    'R42': 'Phase II',
    'R43': 'Phase I',
    'R44': 'Phase II',
    'SB1': 'Phase I',
    'U44': 'Phase II',
}

today = datetime.now().strftime('%Y-%m-%d')

print(f"Fetching active SBIR projects (project_end >= {today})...")

# Query for SBIR projects that are still active
# We need to paginate since there may be many results
all_projects = []
page_size = 1000
offset = 0

while True:
    result = supabase.table('projects').select(
        'org_name, pi_names, activity_code, project_number, title, primary_category, project_end, funding_mechanism'
    ).gte(
        'project_end', today
    ).in_(
        'activity_code', SBIR_CODES
    ).range(offset, offset + page_size - 1).execute()

    if not result.data:
        break

    all_projects.extend(result.data)
    print(f"  Fetched {len(all_projects)} projects...")

    if len(result.data) < page_size:
        break

    offset += page_size

print(f"\nTotal active SBIR projects: {len(all_projects)}")

# Write to CSV
output_file = 'active_sbir_projects.csv'

with open(output_file, 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)

    # Header
    writer.writerow([
        'Organization Name',
        'PI Name',
        'SBIR Phase',
        'Project Number',
        'Project Title',
        'Life Science Category',
        'Project End Date'
    ])

    # Data rows
    for p in all_projects:
        phase = PHASE_MAP.get(p.get('activity_code', ''), p.get('activity_code', ''))
        category = (p.get('primary_category') or '').replace('_', ' ').title()

        writer.writerow([
            p.get('org_name', ''),
            p.get('pi_names', ''),
            phase,
            p.get('project_number', ''),
            p.get('title', ''),
            category,
            p.get('project_end', '')
        ])

print(f"\nExported to: {output_file}")
