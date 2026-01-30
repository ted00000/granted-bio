"""
Data audit script for granted.bio database.
Checks table counts, embedding coverage, and cross-linking.
"""

import os
from dotenv import load_dotenv
load_dotenv('.env.local')

from supabase import create_client

# Initialize client
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

print("=" * 70)
print("GRANTED.BIO DATA AUDIT")
print("=" * 70)

# Table counts
print("\n[1] TABLE COUNTS")
print("-" * 70)

tables = ['projects', 'patents', 'publications', 'clinical_studies', 'abstracts', 'project_publications']
for table in tables:
    try:
        result = supabase.table(table).select('*', count='exact').limit(0).execute()
        print(f"  {table}: {result.count:,}")
    except Exception as e:
        print(f"  {table}: ERROR - {e}")

# Embedding coverage
print("\n[2] EMBEDDING COVERAGE")
print("-" * 70)

# Projects
try:
    total = supabase.table('projects').select('application_id', count='exact').execute().count
    with_embed = supabase.table('projects').select('application_id', count='exact').not_.is_('abstract_embedding', 'null').execute().count
    print(f"  projects.abstract_embedding: {with_embed:,} / {total:,} ({100*with_embed/total:.1f}%)")
except Exception as e:
    print(f"  projects.abstract_embedding: ERROR - {e}")

# Patents
try:
    total = supabase.table('patents').select('patent_id', count='exact').execute().count
    with_embed = supabase.table('patents').select('patent_id', count='exact').not_.is_('patent_embedding', 'null').execute().count
    print(f"  patents.patent_embedding: {with_embed:,} / {total:,} ({100*with_embed/total:.1f}%)")
except Exception as e:
    print(f"  patents.patent_embedding: ERROR - {e}")

# Publications - check if column exists
try:
    total = supabase.table('publications').select('pmid', count='exact').execute().count
    try:
        with_embed = supabase.table('publications').select('pmid', count='exact').not_.is_('publication_embedding', 'null').execute().count
        print(f"  publications.publication_embedding: {with_embed:,} / {total:,} ({100*with_embed/total:.1f}%)")
    except:
        print(f"  publications.publication_embedding: COLUMN MISSING (0 / {total:,})")
except Exception as e:
    print(f"  publications: ERROR - {e}")

# Clinical studies - check if column exists
try:
    total = supabase.table('clinical_studies').select('nct_id', count='exact').execute().count
    try:
        with_embed = supabase.table('clinical_studies').select('nct_id', count='exact').not_.is_('study_embedding', 'null').execute().count
        print(f"  clinical_studies.study_embedding: {with_embed:,} / {total:,} ({100*with_embed/total:.1f}%)")
    except:
        print(f"  clinical_studies.study_embedding: COLUMN MISSING (0 / {total:,})")
except Exception as e:
    print(f"  clinical_studies: ERROR - {e}")

# Cross-linking coverage
print("\n[3] CROSS-LINKING COVERAGE")
print("-" * 70)

# Project → Publication links
try:
    total_projects = supabase.table('projects').select('project_number', count='exact').execute().count
    link_count = supabase.table('project_publications').select('project_number', count='exact').execute().count

    # Count unique projects that have publications
    # This requires a different approach - let's just show link count
    print(f"  project_publications links: {link_count:,}")
except Exception as e:
    print(f"  project_publications: ERROR - {e}")

# Check if patents have project_number field populated
try:
    total = supabase.table('patents').select('patent_id', count='exact').execute().count
    with_proj = supabase.table('patents').select('patent_id', count='exact').not_.is_('project_number', 'null').execute().count
    print(f"  patents with project_number: {with_proj:,} / {total:,} ({100*with_proj/total:.1f}%)")
except Exception as e:
    print(f"  patents.project_number: ERROR - {e}")

# Check if clinical_studies have project_number field populated
try:
    total = supabase.table('clinical_studies').select('nct_id', count='exact').execute().count
    with_proj = supabase.table('clinical_studies').select('nct_id', count='exact').not_.is_('core_project_number', 'null').execute().count
    print(f"  clinical_studies with core_project_number: {with_proj:,} / {total:,} ({100*with_proj/total:.1f}%)")
except Exception as e:
    print(f"  clinical_studies.core_project_number: ERROR - {e}")

# Classification coverage
print("\n[4] CLASSIFICATION COVERAGE")
print("-" * 70)

try:
    total = supabase.table('projects').select('application_id', count='exact').execute().count
    classified = supabase.table('projects').select('application_id', count='exact').not_.is_('primary_category', 'null').execute().count
    print(f"  projects with primary_category: {classified:,} / {total:,} ({100*classified/total:.1f}%)")

    # By category
    for cat in ['biotools', 'therapeutics', 'diagnostics', 'medical_device', 'digital_health', 'other']:
        cat_count = supabase.table('projects').select('application_id', count='exact').eq('primary_category', cat).execute().count
        print(f"    - {cat}: {cat_count:,}")
except Exception as e:
    print(f"  classification: ERROR - {e}")

# Publication fields
print("\n[5] PUBLICATION FIELD COVERAGE")
print("-" * 70)

try:
    total = supabase.table('publications').select('pmid', count='exact').execute().count

    # Check affiliation field (for email extraction)
    with_affil = supabase.table('publications').select('pmid', count='exact').not_.is_('affiliation', 'null').execute().count
    print(f"  publications with affiliation: {with_affil:,} / {total:,} ({100*with_affil/total:.1f}%)")

    # Check pub_title field
    with_title = supabase.table('publications').select('pmid', count='exact').not_.is_('pub_title', 'null').execute().count
    print(f"  publications with pub_title: {with_title:,} / {total:,} ({100*with_title/total:.1f}%)")
except Exception as e:
    print(f"  publication fields: ERROR - {e}")

print("\n" + "=" * 70)
print("AUDIT COMPLETE")
print("=" * 70)
