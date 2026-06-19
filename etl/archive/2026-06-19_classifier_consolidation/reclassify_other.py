"""
Reclassify 'other' category projects into new specific categories.

New categories:
- basic_research: Fundamental science, mechanisms, pathways
- clinical: Patient studies, outcomes research
- public_health: Epidemiology, disparities, population health
- training: T32s, K awards, career development
- infrastructure: Cores, centers, resources
"""

import os
import time
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

print("=" * 70)
print("RECLASSIFY 'OTHER' PROJECTS INTO NEW CATEGORIES")
print("=" * 70)

# Connect
print("\nConnecting to Supabase...")
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
print("✓ Connected\n")

# Activity code patterns
TRAINING_CODES = ['T32', 'T34', 'T35', 'T90', 'TL1', 'TL4',  # Training
                  'F30', 'F31', 'F32', 'F33', 'F99',  # Fellowships
                  'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K18',
                  'K22', 'K23', 'K24', 'K25', 'K26', 'K30', 'K38', 'K43', 'K76', 'K99']  # Career

INFRASTRUCTURE_CODES = ['P30', 'P50', 'P51', 'U24', 'U54', 'S10', 'G20']  # Centers, cores, equipment

# Keyword patterns for each category
TRAINING_KEYWORDS = [
    'training program', 'training grant', 'career development',
    'postdoctoral', 'predoctoral', 'graduate training',
    'mentored', 'mentoring', 'trainee', 'trainees',
    'research education', 'educational program'
]

INFRASTRUCTURE_KEYWORDS = [
    'administrative core', 'resource core', 'data core',
    'shared resource', 'core facility', 'service core',
    'biostatistics core', 'informatics core', 'genomics core',
    'proteomics core', 'imaging core', 'animal core',
    'center grant', 'center for', 'consortium'
]

BASIC_RESEARCH_KEYWORDS = [
    'molecular mechanism', 'signaling pathway', 'gene regulation',
    'protein structure', 'cell biology', 'molecular biology',
    'gene expression', 'transcription factor', 'chromatin',
    'metabolic pathway', 'enzyme kinetics', 'receptor binding',
    'crystal structure', 'biochemical', 'biophysical',
    'dna repair', 'rna processing', 'protein folding',
    'neuronal circuit', 'synaptic', 'ion channel',
    'developmental biology', 'stem cell biology', 'organogenesis'
]

CLINICAL_KEYWORDS = [
    'patient outcomes', 'clinical outcomes', 'patient care',
    'quality of life', 'survivorship', 'palliative',
    'caregiver', 'caregiving', 'patient-reported',
    'behavioral intervention', 'psychosocial',
    'patient adherence', 'medication adherence',
    'patient satisfaction', 'patient experience',
    'health outcomes', 'functional outcomes'
]

PUBLIC_HEALTH_KEYWORDS = [
    'epidemiology', 'epidemiological', 'population health',
    'health disparities', 'health equity', 'social determinants',
    'community health', 'public health', 'prevention program',
    'health promotion', 'disease prevention', 'risk factors',
    'cohort study', 'longitudinal study', 'surveillance',
    'incidence', 'prevalence', 'mortality rate',
    'environmental health', 'occupational health',
    'global health', 'health policy', 'health services research'
]


def classify_project(title, phr, activity_code):
    """Classify a project into one of the new categories."""
    text = f"{title} {phr}".lower()
    activity = (activity_code or '').upper()

    # Check activity codes first (most reliable)
    for code in TRAINING_CODES:
        if activity.startswith(code):
            return 'training', 'activity_code', activity

    for code in INFRASTRUCTURE_CODES:
        if activity.startswith(code):
            return 'infrastructure', 'activity_code', activity

    # Check keywords
    scores = {
        'training': 0,
        'infrastructure': 0,
        'basic_research': 0,
        'clinical': 0,
        'public_health': 0
    }
    matches = {k: [] for k in scores}

    for kw in TRAINING_KEYWORDS:
        if kw in text:
            scores['training'] += 1
            matches['training'].append(kw)

    for kw in INFRASTRUCTURE_KEYWORDS:
        if kw in text:
            scores['infrastructure'] += 1
            matches['infrastructure'].append(kw)

    for kw in BASIC_RESEARCH_KEYWORDS:
        if kw in text:
            scores['basic_research'] += 1
            matches['basic_research'].append(kw)

    for kw in CLINICAL_KEYWORDS:
        if kw in text:
            scores['clinical'] += 1
            matches['clinical'].append(kw)

    for kw in PUBLIC_HEALTH_KEYWORDS:
        if kw in text:
            scores['public_health'] += 1
            matches['public_health'].append(kw)

    # Find best category (require 2+ matches for confidence)
    best_cat = max(scores, key=scores.get)
    best_score = scores[best_cat]

    if best_score >= 2:
        return best_cat, 'keywords', matches[best_cat][:3]

    # Single match with no competition
    if best_score == 1 and sum(1 for s in scores.values() if s > 0) == 1:
        return best_cat, 'single_keyword', matches[best_cat]

    return None, None, None


# Process all 'other' projects
print("Analyzing 'other' category projects...")
to_reclassify = []
total_checked = 0
offset = 0

while True:
    response = supabase.table('projects').select(
        'application_id, title, phr, activity_code'
    ).eq('primary_category', 'other').range(offset, offset + 1000 - 1).execute()

    if not response.data:
        break

    for project in response.data:
        total_checked += 1
        new_cat, reason, evidence = classify_project(
            project['title'] or '',
            project.get('phr') or '',
            project.get('activity_code')
        )

        if new_cat:
            to_reclassify.append({
                'application_id': project['application_id'],
                'new_category': new_cat,
                'reason': reason,
                'evidence': evidence
            })

    print(f"  Checked {total_checked:,} 'other' projects, found {len(to_reclassify):,} to reclassify", end='\r')

    if len(response.data) < 1000:
        break
    offset += 1000

print(f"\n\n✓ Checked {total_checked:,} 'other' projects")
print(f"✓ Found {len(to_reclassify):,} to reclassify\n")

# Summary by category
print("=" * 70)
print("RECLASSIFICATION SUMMARY")
print("=" * 70)

by_category = {}
for item in to_reclassify:
    cat = item['new_category']
    by_category[cat] = by_category.get(cat, 0) + 1

for cat, count in sorted(by_category.items(), key=lambda x: -x[1]):
    print(f"  other → {cat}: {count:,} projects")

# Show examples
print("\n" + "=" * 70)
print("EXAMPLES (first 3 per category)")
print("=" * 70)

for cat in ['training', 'infrastructure', 'basic_research', 'clinical', 'public_health']:
    examples = [x for x in to_reclassify if x['new_category'] == cat][:3]
    if examples:
        print(f"\n{cat.upper()}:")
        for ex in examples:
            print(f"  • {ex['application_id']}")
            print(f"    Reason: {ex['reason']}, Evidence: {ex['evidence']}")

# Apply changes
print("\n" + "=" * 70)
print("APPLYING RECLASSIFICATIONS")
print("=" * 70)

applied = 0
errors = 0

for i in range(0, len(to_reclassify), 100):
    batch = to_reclassify[i:i+100]

    for item in batch:
        try:
            supabase.table('projects').update({
                'primary_category': item['new_category']
            }).eq('application_id', item['application_id']).execute()
            applied += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Error: {e}")

    print(f"  Applied {applied:,} / {len(to_reclassify):,} reclassifications", end='\r')
    time.sleep(0.05)

print(f"\n\n✓ Applied {applied:,} reclassifications")
if errors:
    print(f"✗ Errors: {errors}")

# Show final distribution
print("\n" + "=" * 70)
print("NEW CATEGORY DISTRIBUTION")
print("=" * 70)

categories = ['other', 'therapeutics', 'biotools', 'diagnostics', 'digital_health',
              'medical_device', 'basic_research', 'clinical', 'public_health',
              'training', 'infrastructure']

total = 0
for cat in categories:
    result = supabase.table('projects').select('application_id', count='exact').eq('primary_category', cat).execute()
    total += result.count

for cat in categories:
    result = supabase.table('projects').select('application_id', count='exact').eq('primary_category', cat).execute()
    pct = (result.count / total) * 100 if total > 0 else 0
    print(f"  {cat:20} {result.count:>7,} ({pct:5.1f}%)")

print("=" * 70)
