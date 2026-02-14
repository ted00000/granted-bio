"""
Conservative category fixes - Phase 1

Only fixes OBVIOUS misclassifications in the "other" category.
Requires multiple strong keyword matches to reclassify.

This is intentionally conservative to avoid false positives.
"""

import os
import csv
import time
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 70)
print("CONSERVATIVE CATEGORY FIXES - Phase 1")
print("=" * 70)
print("\nThis script only fixes obvious 'other' → specific category cases.")
print("Requires 2+ strong keyword matches to reclassify.\n")

# Connect
print("Connecting to Supabase...")
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected\n")

# Strong keyword signals (require 2+ matches to reclassify)
STRONG_SIGNALS = {
    'therapeutics': [
        'clinical trial', 'phase i ', 'phase ii', 'phase iii', 'phase 1 ', 'phase 2', 'phase 3',
        'drug development', 'drug discovery', 'drug delivery', 'drug target',
        'gene therapy', 'cell therapy', 'immunotherapy', 'car-t', 'car t cell',
        'therapeutic', 'treatment of', 'treating patients', 'treat disease',
        'vaccine development', 'vaccine candidate',
    ],
    'diagnostics': [
        'diagnostic test', 'diagnostic tool', 'diagnostic assay', 'diagnostic method',
        'early detection', 'disease detection', 'cancer detection',
        'screening test', 'screening assay', 'screening tool',
        'biomarker for diagnosis', 'diagnostic biomarker', 'prognostic biomarker',
        'companion diagnostic', 'point-of-care', 'liquid biopsy',
    ],
    'medical_device': [
        'implantable device', 'implantable sensor', 'neural implant',
        'prosthetic', 'prosthesis', 'orthopedic device', 'orthotic',
        'surgical device', 'surgical robot', 'surgical tool',
        'pacemaker', 'stent', 'catheter',
        'medical device', 'fda clearance', 'fda approval',
    ],
    'digital_health': [
        'mobile health', 'mhealth', 'm-health',
        'digital health', 'digital therapeutic', 'digital intervention',
        'telemedicine', 'telehealth', 'remote monitoring',
        'health app', 'smartphone app', 'wearable sensor',
        'electronic health record', 'ehr integration',
        'clinical decision support', 'ai-powered diagnosis',
    ],
}

def count_strong_matches(text, category):
    """Count how many strong signals match for a category."""
    if not text:
        return 0, []
    text_lower = text.lower()
    matches = [kw for kw in STRONG_SIGNALS.get(category, []) if kw in text_lower]
    return len(matches), matches

def get_best_category(text):
    """Find the best category based on strong keyword matches."""
    if not text:
        return None, 0, []

    best_cat = None
    best_count = 0
    best_matches = []

    for cat in STRONG_SIGNALS.keys():
        count, matches = count_strong_matches(text, cat)
        if count > best_count:
            best_count = count
            best_cat = cat
            best_matches = matches

    return best_cat, best_count, best_matches

# Find projects in "other" category that should be reclassified
# Use titles + phr field (faster than loading all abstracts)
print("Analyzing 'other' category projects...")
to_fix = []
total_checked = 0
offset = 0

while True:
    response = supabase.table('projects').select(
        'application_id, title, phr, primary_category'
    ).eq('primary_category', 'other').range(offset, offset + 1000 - 1).execute()

    if not response.data:
        break

    for project in response.data:
        total_checked += 1
        app_id = project['application_id']
        title = project['title'] or ''
        phr = project.get('phr') or ''
        full_text = f"{title} {phr}"

        best_cat, match_count, matches = get_best_category(full_text)

        # Only reclassify if 2+ strong matches (conservative threshold)
        if best_cat and match_count >= 2:
            to_fix.append({
                'application_id': app_id,
                'title': title[:80],
                'new_category': best_cat,
                'match_count': match_count,
                'matches': ', '.join(matches[:3])
            })

    print(f"  Checked {total_checked:,} 'other' projects, found {len(to_fix):,} to fix", end='\r')

    if len(response.data) < 1000:
        break
    offset += 1000

print(f"\n\n✓ Checked {total_checked:,} 'other' projects")
print(f"✓ Found {len(to_fix):,} confident reclassifications\n")

# Summary by new category
by_new_cat = {}
for item in to_fix:
    cat = item['new_category']
    by_new_cat[cat] = by_new_cat.get(cat, 0) + 1

print("=" * 70)
print("RECLASSIFICATION SUMMARY")
print("=" * 70)
for cat, count in sorted(by_new_cat.items(), key=lambda x: -x[1]):
    print(f"  other → {cat}: {count:,} projects")

# Show examples
print("\n" + "=" * 70)
print("EXAMPLES (first 3 per category)")
print("=" * 70)
for cat in by_new_cat.keys():
    print(f"\n{cat.upper()}:")
    examples = [x for x in to_fix if x['new_category'] == cat][:3]
    for ex in examples:
        print(f"  • {ex['title']}...")
        print(f"    Matches: {ex['matches']}")

# Save to CSV for review
output_file = 'category_fixes_conservative.csv'
with open(output_file, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['application_id', 'title', 'new_category', 'match_count', 'matches'])
    writer.writeheader()
    writer.writerows(to_fix)
print(f"\n\n✓ Saved fixes to {output_file}")

# Apply fixes
print("\n" + "=" * 70)
print("APPLYING FIXES")
print("=" * 70)

fixed = 0
errors = 0

for i, item in enumerate(to_fix):
    try:
        supabase.table('projects').update({
            'primary_category': item['new_category'],
            'primary_category_confidence': 75.0  # Conservative confidence for rule-based fixes
        }).eq('application_id', item['application_id']).execute()
        fixed += 1
    except Exception as e:
        errors += 1
        if errors <= 5:
            print(f"  Error: {e}")

    if (i + 1) % 100 == 0:
        print(f"  Applied {fixed:,} / {len(to_fix):,} fixes", end='\r')
        time.sleep(0.05)

print(f"\n\n✓ Applied {fixed:,} fixes")
if errors > 0:
    print(f"✗ Errors: {errors}")

# Show new distribution
print("\n" + "=" * 70)
print("NEW CATEGORY DISTRIBUTION")
print("=" * 70)

total = 0
for cat in ['other', 'therapeutics', 'biotools', 'diagnostics', 'digital_health', 'medical_device']:
    result = supabase.table('projects').select('application_id', count='exact').eq('primary_category', cat).execute()
    count = result.count or 0
    total += count

for cat in ['other', 'therapeutics', 'biotools', 'diagnostics', 'digital_health', 'medical_device']:
    result = supabase.table('projects').select('application_id', count='exact').eq('primary_category', cat).execute()
    count = result.count or 0
    pct = count / total * 100 if total > 0 else 0
    print(f"  {cat:20} {count:>8,} ({pct:5.1f}%)")

print("=" * 70)
