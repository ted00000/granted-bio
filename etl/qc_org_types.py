"""
QC script for organization type classification.

Identifies likely misclassifications by checking org_name patterns against org_type.
"""

import os
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

# Connect to Supabase
print("=" * 70)
print("ORGANIZATION TYPE QC REPORT")
print("=" * 70)
print("\nConnecting to Supabase...")
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected\n")

# Patterns that indicate org type
UNIVERSITY_PATTERNS = [
    'UNIVERSITY', 'UNIV ', 'UNIV.', ' UNIV', 'COLLEGE', 'SCHOOL OF MEDICINE',
    'MEDICAL SCHOOL', 'POLYTECHNIC', 'INSTITUTE OF TECHNOLOGY'
]

HOSPITAL_PATTERNS = [
    'HOSPITAL', 'MEDICAL CENTER', 'HEALTH SYSTEM', 'HEALTH CENTER',
    'CLINIC', 'CHILDREN\'S', 'MEDICAL COLLEGE'  # Medical colleges are often hospitals
]

RESEARCH_INSTITUTE_PATTERNS = [
    'RESEARCH INSTITUTE', 'RESEARCH CENTER', 'RESEARCH FOUNDATION',
    'CANCER CENTER', 'CANCER RESEARCH', 'INSTITUTE FOR', 'INSTITUTES',
    'SCRIPPS', 'BROAD INSTITUTE', 'SALK', 'SLOAN', 'WHITEHEAD',
    'GLADSTONE', 'HUTCH', 'FRED HUTCH'
]

COMPANY_PATTERNS = [
    ', INC', ' INC.', ' LLC', ' CORP', 'THERAPEUTICS', 'BIOSCIENCES',
    'PHARMACEUTICALS', 'PHARMA', 'BIOTECH', 'SCIENCES, INC'
]

# SBIR/STTR activity codes (almost always companies)
SBIR_STTR_CODES = ['R41', 'R42', 'R43', 'R44', 'SB1']

def check_pattern(org_name, patterns):
    """Check if org_name contains any of the patterns."""
    org_upper = org_name.upper()
    for pattern in patterns:
        if pattern.upper() in org_upper:
            return True
    return False

def get_expected_org_type(org_name, activity_code):
    """Determine expected org_type based on name and activity code."""
    org_upper = org_name.upper()

    # SBIR/STTR grants are almost always companies
    if activity_code:
        for code in SBIR_STTR_CODES:
            if activity_code.startswith(code):
                return 'company'

    # Check patterns (order matters - more specific first)
    if check_pattern(org_name, COMPANY_PATTERNS):
        return 'company'
    if check_pattern(org_name, RESEARCH_INSTITUTE_PATTERNS):
        return 'research_institute'
    if check_pattern(org_name, HOSPITAL_PATTERNS):
        return 'hospital'
    if check_pattern(org_name, UNIVERSITY_PATTERNS):
        return 'university'

    return None  # Can't determine

# Fetch all projects with org_type set
print("Fetching projects...")
all_mismatches = []
offset = 0
batch_size = 1000
total_checked = 0

while True:
    response = supabase.table('projects').select(
        'application_id, org_name, org_type, activity_code'
    ).not_.is_('org_type', 'null').range(offset, offset + batch_size - 1).execute()

    if not response.data:
        break

    for project in response.data:
        total_checked += 1
        org_name = project['org_name'] or ''
        current_type = project['org_type']
        activity_code = project['activity_code'] or ''

        expected_type = get_expected_org_type(org_name, activity_code)

        if expected_type and expected_type != current_type:
            all_mismatches.append({
                'application_id': project['application_id'],
                'org_name': org_name,
                'current': current_type,
                'expected': expected_type,
                'activity_code': activity_code
            })

    print(f"  Checked {total_checked:,} projects, found {len(all_mismatches):,} potential mismatches", end='\r')

    if len(response.data) < batch_size:
        break
    offset += batch_size

print(f"\n\n✓ Checked {total_checked:,} projects")
print(f"✓ Found {len(all_mismatches):,} potential mismatches\n")

# Group mismatches by type
by_mismatch_type = {}
for m in all_mismatches:
    key = f"{m['current']} → {m['expected']}"
    if key not in by_mismatch_type:
        by_mismatch_type[key] = []
    by_mismatch_type[key].append(m)

# Print summary
print("=" * 70)
print("MISMATCH SUMMARY")
print("=" * 70)
for mismatch_type, items in sorted(by_mismatch_type.items(), key=lambda x: -len(x[1])):
    print(f"\n{mismatch_type}: {len(items):,} projects")
    print("-" * 50)
    # Show first 5 examples
    for item in items[:5]:
        sbir = f" [SBIR: {item['activity_code']}]" if item['activity_code'] and any(item['activity_code'].startswith(c) for c in SBIR_STTR_CODES) else ""
        print(f"  • {item['org_name'][:60]}{sbir}")
    if len(items) > 5:
        print(f"  ... and {len(items) - 5} more")

# Save mismatches to CSV for review/fix
import csv
output_file = 'org_type_mismatches.csv'
with open(output_file, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['application_id', 'org_name', 'current', 'expected', 'activity_code'])
    writer.writeheader()
    writer.writerows(all_mismatches)

print(f"\n\n✓ Saved mismatches to {output_file}")

# Ask to fix
print("\n" + "=" * 70)
print("RECOMMENDED FIXES")
print("=" * 70)

# Count by expected type
fix_counts = {}
for m in all_mismatches:
    exp = m['expected']
    fix_counts[exp] = fix_counts.get(exp, 0) + 1

for exp_type, count in sorted(fix_counts.items(), key=lambda x: -x[1]):
    print(f"  {count:,} projects should be '{exp_type}'")

print("\nTo apply fixes, run: python3 etl/fix_org_types.py")
print("=" * 70)
