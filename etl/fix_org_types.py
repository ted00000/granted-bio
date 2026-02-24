"""
Fix org_type classifications with improved patterns.
Re-classifies org_type using the updated classify_org function and updates the database.
"""

import os
import time
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client
from concurrent.futures import ThreadPoolExecutor, as_completed

print("=" * 60)
print("FIX ORG_TYPE CLASSIFICATIONS")
print("=" * 60)

supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected to Supabase\n")

SBIR_CODES = {'R41','R42','R43','R44','SB1','U44'}

def classify_org(org_name, activity_code):
    """Updated org classifier with HOSP abbreviation and known universities."""
    if not org_name:
        return 'other'
    org = org_name.upper()

    if activity_code and activity_code in SBIR_CODES:
        return 'company'

    # Company signals
    company_signals = [
        'LLC', 'INC.', 'INC,', ' INC', 'CORP', 'L.L.C', 'L.P.',
        'THERAPEUTICS', 'BIOSCIENCES', 'PHARMACEUTICALS', 'BIOTECH', 'BIOPHARMA',
        'TECHNOLOGIES INC', 'SCIENCES INC', 'DEVICES INC', 'SOLUTIONS INC',
        'HEALTH INC', 'ONCOLOGY INC', 'DIAGNOSTICS INC', 'GENOMICS INC',
        'LABS INC', 'MEDICAL INC', 'PHARMA INC',
    ]
    if any(s in org for s in company_signals):
        return 'company'

    # University signals
    uni_signals = [
        'UNIVERSITY', 'UNIV ', ' UNIV', 'UNIV.', 'UNIVERSIT',
        'COLLEGE', 'INSTITUTE OF TECHNOLOGY', 'POLYTECHNIC',
        'SCHOOL OF MEDICINE', 'MEDICAL SCHOOL', 'MEDICAL COLLEGE',
        'SCHOOL OF PUBLIC HEALTH',
    ]
    # Well-known universities without "UNIVERSITY" in name
    known_universities = [
        'RUTGERS', 'HARVARD', 'STANFORD', 'MIT ', 'CALTECH', 'YALE', 'PRINCETON',
        'COLUMBIA', 'CORNELL', 'DUKE', 'JOHNS HOPKINS', 'EMORY', 'VANDERBILT',
        'NORTHWESTERN', 'UCLA', 'UCSD', 'UCSF', 'USC ', 'NYU ', 'BROWN',
        'DARTMOUTH', 'PENN STATE', 'OHIO STATE', 'MICHIGAN STATE', 'FLORIDA STATE',
        'TEXAS A&M', 'PURDUE', 'WISCONSIN-',
        'ICAHN SCHOOL', 'WEILL CORNELL', 'BAYLOR COLLEGE',
    ]
    is_uni = any(s in org for s in uni_signals) or any(s in org for s in known_universities)

    # Hospital/health system signals
    hosp_signals = [
        'HOSPITAL', 'MEDICAL CENTER', 'HEALTH SYSTEM', 'HEALTH CENTER', 'CLINIC',
        'MAYO', "CHILDREN'S", 'MEDICAL CTR', 'HEALTH CARE', 'HEALTH SCIENCES CENTER',
        'NATIONAL JEWISH HEALTH', 'BANNER HEALTH', 'MOUNT SINAI',
        'MEMORIAL SLOAN', 'MD ANDERSON', 'CITY OF HOPE',
        ' HOSP ', 'HOSP ',  # Abbreviation: "CHILDRENS HOSP MED CTR"
        'CHILDRENS HOSP', "CHILDREN'S HOSP",
    ]
    if any(s in org for s in hosp_signals) and not is_uni:
        return 'hospital'

    # Research institute signals
    ri_signals = [
        'RESEARCH INSTITUTE', 'RESEARCH CENTER', 'RESEARCH CTR',
        'INSTITUTE FOR', 'INSTITUTE OF',
        'SCRIPPS', 'BROAD INSTITUTE', 'SALK INSTITUTE',
        'FRED HUTCHINSON', 'SLOAN', 'DANA-FARBER', 'COLD SPRING HARBOR',
        'JACKSON LABORATORY', 'WISTAR', 'LA JOLLA INSTITUTE', 'FEINSTEIN',
        'BECKMAN RESEARCH', 'BATTELLE', 'WOODS HOLE', 'STOWERS', 'ALLEN INSTITUTE',
        'WHITEHEAD INSTITUTE', 'CARNEGIE INSTITUTION', 'HUDSON ALPHA', 'VAN ANDEL',
        'PENNINGTON', 'RESEARCH TRIANGLE', 'LAUREATE',
        'BIOMEDICAL RESEARCH', 'PSYCHIATRIC INSTITUTE',
    ]
    if any(s in org for s in ri_signals) and not is_uni:
        return 'research_institute'

    if is_uni:
        return 'university'
    if any(s in org for s in hosp_signals):
        return 'hospital'
    return 'other'

# Fetch ALL projects with org_type = 'other' (with pagination)
print("Fetching projects with org_type='other'...")
projects = []
offset = 0
batch_size = 1000

while True:
    result = supabase.table('projects').select(
        'application_id, org_name, activity_code, org_type'
    ).eq('org_type', 'other').range(offset, offset + batch_size - 1).execute()

    if not result.data:
        break
    projects.extend(result.data)
    print(f"  Fetched {len(projects):,}...")
    offset += batch_size
    if len(result.data) < batch_size:
        break

print(f"✓ Found {len(projects):,} projects with org_type='other'\n")

# Reclassify and find changes
changes = []
for p in projects:
    new_org_type = classify_org(p['org_name'], p['activity_code'])
    if new_org_type != 'other':
        changes.append({
            'application_id': p['application_id'],
            'org_name': p['org_name'],
            'old_type': 'other',
            'new_type': new_org_type
        })

print(f"Found {len(changes):,} projects to reclassify\n")

if not changes:
    print("No changes needed!")
    exit(0)

# Show sample changes
print("Sample changes:")
for c in changes[:10]:
    print(f"  {c['org_name'][:50]:50s} → {c['new_type']}")
print()

# Update database
def update_org_type(change, max_retries=3):
    for attempt in range(max_retries):
        try:
            supabase.table('projects').update({
                'org_type': change['new_type']
            }).eq('application_id', change['application_id']).execute()
            return True, None
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(0.5 * (attempt + 1))
                continue
            return False, str(e)
    return False, "Max retries exceeded"

print(f"Updating {len(changes):,} records...")
NUM_WORKERS = 10
updated = 0
errors = 0

with ThreadPoolExecutor(max_workers=NUM_WORKERS) as executor:
    futures = {executor.submit(update_org_type, c): c for c in changes}
    for i, future in enumerate(as_completed(futures)):
        success, error = future.result()
        if success:
            updated += 1
        else:
            errors += 1
            print(f"  Error: {error}")

        if (i + 1) % 100 == 0:
            print(f"  Progress: {i+1:,}/{len(changes):,}")

print(f"\n{'=' * 60}")
print("COMPLETE")
print("=" * 60)
print(f"Updated: {updated:,}")
print(f"Errors: {errors:,}")

# Show new distribution
print("\nReclassified from 'other' to:")
by_type = {}
for c in changes:
    by_type[c['new_type']] = by_type.get(c['new_type'], 0) + 1
for t, count in sorted(by_type.items(), key=lambda x: -x[1]):
    print(f"  {t}: {count:,}")
