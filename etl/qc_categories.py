"""
QC script for primary_category classification.

Identifies potential misclassifications by checking title/abstract keywords against category.
"""

import os
import csv
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 70)
print("PRIMARY CATEGORY QC REPORT")
print("=" * 70)

# Connect
print("\nConnecting to Supabase...")
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected\n")

# Category keyword signals (strong indicators)
CATEGORY_SIGNALS = {
    'therapeutics': {
        'strong': ['treatment', 'therapy', 'therapeutic', 'drug discovery', 'drug development',
                   'clinical trial', 'phase i', 'phase ii', 'phase iii', 'car-t', 'car t',
                   'gene therapy', 'immunotherapy', 'vaccine', 'drug delivery', 'drug target'],
        'moderate': ['cure', 'treating', 'treat patients', 'patient treatment']
    },
    'diagnostics': {
        'strong': ['diagnostic', 'diagnosis', 'detection', 'screening test', 'biomarker discovery',
                   'early detection', 'companion diagnostic', 'prognostic', 'detect disease',
                   'liquid biopsy', 'point-of-care'],
        'moderate': ['screening panel', 'blood test', 'disease marker']
    },
    'biotools': {
        'strong': ['platform development', 'tool development', 'method development', 'assay development',
                   'enabling technology', 'research tool', 'screening platform', 'high-throughput',
                   'sequencing method', 'imaging platform', 'computational tool', 'software tool'],
        'moderate': ['develop a method', 'develop a platform', 'develop tools', 'new assay']
    },
    'medical_device': {
        'strong': ['medical device', 'implantable', 'implant', 'prosthetic', 'prosthesis',
                   'surgical device', 'surgical tool', 'pacemaker', 'stent', 'neural implant',
                   'orthopedic device'],
        'moderate': ['wearable device', 'monitoring device']
    },
    'digital_health': {
        'strong': ['digital health', 'telemedicine', 'telehealth', 'health app', 'mobile health',
                   'mhealth', 'electronic health record', 'ehr', 'clinical decision support',
                   'health informatics', 'wearable', 'remote monitoring'],
        'moderate': ['ai for clinical', 'machine learning clinical', 'health monitoring']
    },
    'other': {
        'strong': ['basic science', 'fundamental mechanism', 'epidemiology', 'public health',
                   'health services', 'health policy', 'training grant', 'career development',
                   'behavioral intervention', 'health disparities'],
        'moderate': ['understanding mechanism', 'disease mechanism']
    }
}

def check_keywords(text, category):
    """Check if text contains keywords from a category. Returns (strong_matches, moderate_matches)."""
    if not text:
        return [], []
    text_lower = text.lower()

    signals = CATEGORY_SIGNALS.get(category, {'strong': [], 'moderate': []})
    strong = [kw for kw in signals['strong'] if kw in text_lower]
    moderate = [kw for kw in signals['moderate'] if kw in text_lower]
    return strong, moderate

def get_best_category(text):
    """Determine which category has the strongest keyword match."""
    if not text:
        return None, 0

    best_cat = None
    best_score = 0

    for cat in CATEGORY_SIGNALS.keys():
        strong, moderate = check_keywords(text, cat)
        score = len(strong) * 3 + len(moderate)  # Weight strong matches more
        if score > best_score:
            best_score = score
            best_cat = cat

    return best_cat, best_score

# Fetch abstracts
print("Loading abstracts...")
abstracts_map = {}
offset = 0
while True:
    response = supabase.table('abstracts').select(
        'application_id, abstract_text'
    ).range(offset, offset + 1000 - 1).execute()

    if not response.data:
        break

    for a in response.data:
        abstracts_map[a['application_id']] = a['abstract_text']

    print(f"  Loaded {len(abstracts_map):,} abstracts...", end='\r')

    if len(response.data) < 1000:
        break
    offset += 1000

print(f"✓ Loaded {len(abstracts_map):,} abstracts\n")

# Check projects
print("Analyzing projects...")
mismatches = []
category_counts = {}
offset = 0
total_checked = 0

while True:
    response = supabase.table('projects').select(
        'application_id, title, primary_category, primary_category_confidence'
    ).not_.is_('primary_category', 'null').range(offset, offset + 1000 - 1).execute()

    if not response.data:
        break

    for project in response.data:
        total_checked += 1
        app_id = project['application_id']
        title = project['title'] or ''
        current_cat = project['primary_category']
        confidence = project.get('primary_category_confidence') or 0
        abstract = abstracts_map.get(app_id, '') or ''

        # Track counts
        category_counts[current_cat] = category_counts.get(current_cat, 0) + 1

        # Combine title and abstract for analysis
        full_text = f"{title} {abstract}"

        # Check what keywords match current category
        current_strong, current_moderate = check_keywords(full_text, current_cat)

        # Find best matching category based on keywords
        best_cat, best_score = get_best_category(full_text)

        # Flag as potential mismatch if:
        # 1. Best category is different from current AND has a score > 0
        # 2. Current category has no keyword matches
        if best_cat and best_cat != current_cat and best_score > 0:
            # Only flag if current category has weak support
            if len(current_strong) == 0 and best_score >= 3:
                mismatches.append({
                    'application_id': app_id,
                    'title': title[:100],
                    'current': current_cat,
                    'suggested': best_cat,
                    'confidence': confidence,
                    'reason': f"Keywords suggest {best_cat} (score={best_score})"
                })

    print(f"  Checked {total_checked:,} projects, found {len(mismatches):,} potential issues", end='\r')

    if len(response.data) < 1000:
        break
    offset += 1000

print(f"\n\n✓ Checked {total_checked:,} projects")
print(f"✓ Found {len(mismatches):,} potential misclassifications\n")

# Current distribution
print("=" * 70)
print("CURRENT CATEGORY DISTRIBUTION")
print("=" * 70)
for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
    pct = count / total_checked * 100
    print(f"  {cat:20} {count:>8,} ({pct:5.1f}%)")

# Group mismatches
print("\n" + "=" * 70)
print("POTENTIAL MISCLASSIFICATIONS BY TYPE")
print("=" * 70)

by_type = {}
for m in mismatches:
    key = f"{m['current']} → {m['suggested']}"
    if key not in by_type:
        by_type[key] = []
    by_type[key].append(m)

for mtype, items in sorted(by_type.items(), key=lambda x: -len(x[1])):
    print(f"\n{mtype}: {len(items):,} projects")
    print("-" * 50)
    for item in items[:3]:
        print(f"  • {item['title'][:70]}...")
        print(f"    {item['reason']}")
    if len(items) > 3:
        print(f"  ... and {len(items) - 3} more")

# Save to CSV
output_file = 'category_mismatches.csv'
with open(output_file, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['application_id', 'title', 'current', 'suggested', 'confidence', 'reason'])
    writer.writeheader()
    writer.writerows(mismatches)

print(f"\n\n✓ Saved {len(mismatches):,} potential mismatches to {output_file}")

# Low confidence check
print("\n" + "=" * 70)
print("LOW CONFIDENCE CLASSIFICATIONS (< 60)")
print("=" * 70)

low_conf_counts = {}
offset = 0
while True:
    response = supabase.table('projects').select(
        'primary_category, primary_category_confidence'
    ).lt('primary_category_confidence', 60).range(offset, offset + 1000 - 1).execute()

    if not response.data:
        break

    for p in response.data:
        cat = p['primary_category']
        low_conf_counts[cat] = low_conf_counts.get(cat, 0) + 1

    if len(response.data) < 1000:
        break
    offset += 1000

total_low = sum(low_conf_counts.values())
print(f"Total projects with confidence < 60: {total_low:,}")
for cat, count in sorted(low_conf_counts.items(), key=lambda x: -x[1]):
    print(f"  {cat:20} {count:>6,}")

print("\n" + "=" * 70)
print("RECOMMENDATIONS")
print("=" * 70)
print("1. Review the category_mismatches.csv for obvious errors")
print("2. Low confidence 'other' projects may need reclassification")
print("3. Consider re-running Claude classification on flagged projects")
print("=" * 70)
