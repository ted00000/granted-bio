"""
Load processed data to Supabase.
Handles bulk uploads with batching and error handling.
"""

import os
import json
from typing import Dict, Any, List, Optional
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

try:
    from supabase import create_client, Client
except ImportError:
    print("Installing supabase-py...")
    import subprocess
    subprocess.check_call(['pip', 'install', 'supabase'])
    from supabase import create_client, Client

# Import processors
from process_projects import load_projects
from process_publications import load_publications
from process_patents import load_patents
from process_clinical import load_clinical_studies
# Inline classification was removed 2026-06-19 as part of the classifier
# consolidation. Projects go into the DB with primary_category=NULL and are
# classified by classify_projects_batched.py (Step 6 of load_fiscal_year.sh),
# which now wraps etl/classifier.py — the single canonical classifier.


def get_supabase_client() -> Client:
    """Create and return Supabase client."""
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_KEY')

    if not url or not key:
        raise ValueError("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in environment")

    return create_client(url, key)


def batch_insert(supabase: Client, table: str, records: List[Dict], batch_size: int = 500, on_conflict: Optional[str] = None) -> int:
    """
    Insert records in batches with upsert support.

    Args:
        supabase: Supabase client
        table: Table name
        records: Records to insert
        batch_size: Size of each batch
        on_conflict: Column name to use for conflict resolution (e.g., 'pmid', 'application_id')

    Returns number of records inserted.
    """
    total_inserted = 0

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        try:
            if on_conflict:
                result = supabase.table(table).upsert(batch, on_conflict=on_conflict).execute()
            else:
                result = supabase.table(table).upsert(batch).execute()
            total_inserted += len(batch)
            print(f"  Inserted batch {i // batch_size + 1}: {len(batch)} records to {table}")
        except Exception as e:
            # Log error but continue - batch upserts handle most cases correctly
            print(f"  Warning: batch {i // batch_size + 1} had issues: {str(e)[:100]}")

    return total_inserted


def load_abstracts_map(data_dir: str = 'data/raw') -> Dict[str, str]:
    """Load abstracts into a map keyed by application_id from all fiscal years."""
    import csv
    import glob

    # Find all abstract files
    pattern = os.path.join(data_dir, 'RePORTER_PRJABS_C_FY*.csv')
    filepaths = sorted(glob.glob(pattern))

    if not filepaths:
        print(f"No abstract files found matching: {pattern}")
        return {}

    print(f"Found {len(filepaths)} abstract files: {[os.path.basename(f) for f in filepaths]}")

    abstracts_map = {}
    for filepath in filepaths:
        fy = os.path.basename(filepath).replace('RePORTER_PRJABS_C_FY', '').replace('.csv', '')
        print(f"  Processing abstracts FY{fy}...")
        count = 0
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                app_id = row.get('APPLICATION_ID')
                abstract = row.get('ABSTRACT_TEXT')
                if app_id and abstract:
                    abstracts_map[app_id] = abstract
                    count += 1
        print(f"    Loaded {count} abstracts from FY{fy}")

    print(f"Loaded {len(abstracts_map)} total abstracts")
    return abstracts_map


def generate_embeddings(supabase: Client, projects: List[Dict], abstracts: List[Dict]) -> int:
    """
    Generate embeddings for projects and abstracts using OpenAI.

    Returns number of embeddings generated.
    """
    import openai

    openai_key = os.environ.get('OPENAI_API_KEY')
    if not openai_key:
        print("  OPENAI_API_KEY not found, skipping embeddings")
        return 0

    client = openai.OpenAI(api_key=openai_key)
    model = "text-embedding-3-small"

    embeddings_generated = 0
    total_cost = 0.0

    # Cost: $0.00002 per 1K tokens (text-embedding-3-small)
    # Average ~1000 tokens per project = $0.00002 per embedding

    print(f"\n  Generating embeddings for {len(projects)} projects...")
    print(f"  Model: {model}")
    print(f"  Estimated cost: ${len(projects) * 0.000021:.4f}")

    for i, (project, abstract) in enumerate(zip(projects, abstracts)):
        if i % 100 == 0 and i > 0:
            print(f"  Generated {i}/{len(projects)} embeddings... (cost: ${total_cost:.4f})")

        try:
            # Create embedding text from title + phr + terms + abstract
            text = f"{project.get('title', '')} {project.get('phr', '')} {project.get('terms', '')} {abstract.get('abstract_text', '')}"
            text = text[:8000]  # Truncate to reasonable length

            if not text.strip():
                continue

            # Generate embedding
            response = client.embeddings.create(
                model=model,
                input=text
            )

            embedding = response.data[0].embedding
            tokens_used = response.usage.total_tokens
            cost = (tokens_used / 1000) * 0.00002
            total_cost += cost

            # Update project with embedding
            supabase.table('projects').update({
                'embedding': embedding
            }).eq('application_id', project['application_id']).execute()

            # Update abstract with embedding
            supabase.table('abstracts').update({
                'embedding': embedding
            }).eq('application_id', project['application_id']).execute()

            embeddings_generated += 1

        except Exception as e:
            print(f"  Error generating embedding for project {project.get('application_id')}: {e}")

    print(f"\n  Generated {embeddings_generated} embeddings")
    print(f"  Total cost: ${total_cost:.4f}")

    return embeddings_generated


def run_etl(
    data_dir: str = 'data/raw',
    limit: Optional[int] = None,
    skip_embeddings: bool = True,
) -> Dict[str, int]:
    """
    Run the complete ETL pipeline.

    Args:
        data_dir: Directory containing raw CSV files
        limit: Optional limit on number of projects to process
        skip_embeddings: Skip embedding generation (expensive)

    Returns:
        Dictionary with counts of records processed
    """
    print("=" * 60)
    print("GRANTED.BIO ETL PIPELINE")
    print("=" * 60)
    start_time = datetime.now()

    supabase = get_supabase_client()
    stats = {
        'projects_loaded': 0,
        'publications_loaded': 0,
        'patents_loaded': 0,
        'clinical_studies_loaded': 0,
        'abstracts_loaded': 0,
        'links_loaded': 0,
    }

    # Step 1: Load raw data
    print("\n[1/6] Loading projects...")
    projects = load_projects(data_dir, limit)
    print(f"  Loaded {len(projects)} projects")

    print("\n[2/6] Loading publications...")
    publications, project_pubs = load_publications(data_dir, limit=limit * 10 if limit else None)
    print(f"  Loaded {len(publications)} publications")

    print("\n[3/6] Loading patents...")
    patents = load_patents(data_dir)
    # Build project to patents mapping
    project_patents: Dict[str, list] = {}
    for patent in patents:
        proj_num = patent.get('project_number')
        if proj_num:
            if proj_num not in project_patents:
                project_patents[proj_num] = []
            project_patents[proj_num].append(patent)
    print(f"  Loaded {len(patents)} patents")

    print("\n[4/6] Loading clinical studies...")
    clinical_studies = load_clinical_studies(data_dir)
    # Build project to clinical mapping
    project_clinical: Dict[str, list] = {}
    for study in clinical_studies:
        proj_num = study.get('project_number')
        if proj_num:
            if proj_num not in project_clinical:
                project_clinical[proj_num] = []
            project_clinical[proj_num].append(study)
    print(f"  Loaded {len(clinical_studies)} clinical studies")

    print("\n[5/6] Loading abstracts...")
    abstracts_map = load_abstracts_map(data_dir)

    # Build publications map by PMID
    pubs_by_pmid = {p['pmid']: p for p in publications}

    # Inline classification was removed 2026-06-19. Projects get inserted
    # with primary_category=NULL and primary_category_confidence=NULL; the
    # post-load classifier (classify_projects_batched.py, which wraps the
    # canonical etl/classifier.py) fills them in via Pass 1 (Python) +
    # Pass 2 (Haiku).
    print("\n[6/6] Preparing projects for insert (classification deferred to post-load step)...")
    classified_projects = []
    abstracts_to_load = []

    for project in projects:
        app_id = project.get('application_id')
        abstract_text = abstracts_map.get(app_id)

        # Leave primary_category and primary_category_confidence unset so the
        # post-load classifier can write authoritative values.
        classified_projects.append(project)

        if abstract_text:
            abstracts_to_load.append({
                'application_id': app_id,
                'abstract_text': abstract_text,
                'abstract_length': len(abstract_text),
            })

    print(f"  Prepared {len(classified_projects)} projects for insert")

    # Legacy biotools_confidence stats removed alongside the inline classifier.
    # Distribution will be tracked by classify_projects_batched.py post-load.

    # Step 3: Load to Supabase
    print("\n" + "=" * 60)
    print("LOADING TO SUPABASE")
    print("=" * 60)

    # Load projects
    print("\nLoading projects to Supabase...")
    stats['projects_loaded'] = batch_insert(supabase, 'projects', classified_projects, on_conflict='application_id')

    # Load abstracts
    print("\nLoading abstracts to Supabase...")
    stats['abstracts_loaded'] = batch_insert(supabase, 'abstracts', abstracts_to_load, on_conflict='application_id')

    # Load publications
    print("\nLoading publications to Supabase...")
    stats['publications_loaded'] = batch_insert(supabase, 'publications', publications, on_conflict='pmid')

    # Load patents
    print("\nLoading patents to Supabase...")
    stats['patents_loaded'] = batch_insert(supabase, 'patents', patents, on_conflict='patent_id')

    # Load clinical studies — upsert on the composite (nct_id, project_number)
    # natural key. A single NCT can be linked to multiple NIH projects, so the
    # correct uniqueness is the pair, not nct_id alone. The matching unique
    # constraint was added in migration 20260617_clinical_studies_composite_unique.sql.
    print("\nLoading clinical studies to Supabase...")
    stats['clinical_studies_loaded'] = batch_insert(supabase, 'clinical_studies', clinical_studies, on_conflict='nct_id,project_number')

    # Load project-publication links. Previously this was filtered to only
    # links where BOTH endpoints appeared in the current batch. That silently
    # dropped valid cross-batch links — e.g., FY2025 projects → FY2024 pubs
    # already in the DB. Removed that filter; FK constraints catch the
    # genuinely-invalid rows. Explicit on_conflict on the composite PK so
    # behavior doesn't depend on client auto-detection of the unique key.
    print("\nLoading publication links to Supabase...")
    links = []
    for proj_num, pmids in project_pubs.items():
        for pmid in pmids:
            links.append({
                'project_number': proj_num,
                'pmid': pmid,
            })
    print(f"  Generated {len(links)} project-publication links")
    stats['links_loaded'] = batch_insert(supabase, 'project_publications', links, on_conflict='project_number,pmid')

    # Generate embeddings if requested
    if not skip_embeddings:
        print("\n" + "=" * 60)
        print("GENERATING EMBEDDINGS")
        print("=" * 60)
        stats['embeddings_generated'] = generate_embeddings(supabase, classified_projects, abstracts_to_load)

    # Refresh materialized views
    print("\nRefreshing materialized views...")
    try:
        supabase.rpc('refresh_materialized_views').execute()
        print("  Materialized views refreshed")
    except Exception as e:
        print(f"  Warning: Could not refresh materialized views: {e}")

    # Summary
    elapsed = datetime.now() - start_time
    print("\n" + "=" * 60)
    print("ETL COMPLETE")
    print("=" * 60)
    print(f"Time elapsed: {elapsed}")
    print(f"Projects loaded: {stats['projects_loaded']}")
    print(f"Abstracts loaded: {stats['abstracts_loaded']}")
    print(f"Publications loaded: {stats['publications_loaded']}")
    print(f"Patents loaded: {stats['patents_loaded']}")
    print(f"Clinical studies loaded: {stats['clinical_studies_loaded']}")
    print(f"Publication links loaded: {stats['links_loaded']}")

    return stats


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Run granted.bio ETL pipeline')
    parser.add_argument('--limit', type=int, default=None, help='Limit number of projects to process')
    parser.add_argument('--data-dir', type=str, default='data/raw', help='Directory containing raw CSV files')
    parser.add_argument('--generate-embeddings', action='store_true', default=False, help='Generate embeddings (uses OpenAI API)')

    args = parser.parse_args()

    run_etl(
        data_dir=args.data_dir,
        limit=args.limit,
        skip_embeddings=not args.generate_embeddings,
    )
