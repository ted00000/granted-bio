#!/usr/bin/env python3
"""
Fix linked data counts (patent_count, publication_count, clinical_trial_count)
by aggregating across all fiscal year variants of the same core project.

The issue: patent_count only counted patents linked to ONE specific project_number,
but patents can be linked to any fiscal year variant (e.g., 5P30CA046592-35 vs -36).

The fix: For each core project, find ALL related project_numbers and count
unique linked records across all of them.
"""

import os
import re
from collections import defaultdict
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv('.env.local')

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def get_core_project_number(project_number: str) -> str:
    """
    Extract core project number for finding related records.
    NIH project numbers like "5R44MH136894-02" and "1R44MH136894-01" are the same project.
    This strips the leading digit (support type) and suffix (budget period).
    Example: "5R44MH136894-02" → "R44MH136894"
    """
    if not project_number:
        return ""

    core = project_number.strip().upper()
    # Remove leading digit (0-9) if present (support type indicator)
    core = re.sub(r'^[0-9]', '', core)
    # Remove suffix after hyphen (-01, -02, etc.) - budget period indicator
    core = re.sub(r'-\d+$', '', core)
    # Also handle alternative suffix formats like -S1, -A1
    core = re.sub(r'-[A-Z]\d+$', '', core)

    return core


def fetch_all_project_numbers():
    """Fetch all unique project numbers from projects table."""
    print("Fetching all project numbers...")

    all_numbers = []
    offset = 0
    batch_size = 1000

    while True:
        response = supabase.table("projects").select("project_number").range(offset, offset + batch_size - 1).execute()

        if not response.data:
            break

        all_numbers.extend([p["project_number"] for p in response.data if p["project_number"]])
        offset += batch_size

        if len(response.data) < batch_size:
            break

    print(f"Found {len(all_numbers)} project records")
    return all_numbers


def build_core_to_variants_map(project_numbers: list) -> dict:
    """Build a mapping from core project number to all its variants."""
    print("Building core project number mapping...")

    core_to_variants = defaultdict(set)

    for pn in project_numbers:
        core = get_core_project_number(pn)
        if core:
            core_to_variants[core].add(pn)

    print(f"Found {len(core_to_variants)} unique core project numbers")
    return core_to_variants


def fetch_patent_links():
    """Fetch all patent links from junction table."""
    print("Fetching patent links...")

    all_links = []
    offset = 0
    batch_size = 1000

    while True:
        response = supabase.table("project_patents").select("project_number, patent_id").range(offset, offset + batch_size - 1).execute()

        if not response.data:
            break

        all_links.extend(response.data)
        offset += batch_size

        if len(response.data) < batch_size:
            break

    print(f"Found {len(all_links)} patent links")
    return all_links


def fetch_publication_links():
    """Fetch all publication links from junction table."""
    print("Fetching publication links...")

    all_links = []
    offset = 0
    batch_size = 1000

    while True:
        response = supabase.table("project_publications").select("project_number, pmid").range(offset, offset + batch_size - 1).execute()

        if not response.data:
            break

        all_links.extend(response.data)
        offset += batch_size

        if len(response.data) < batch_size:
            break

    print(f"Found {len(all_links)} publication links")
    return all_links


def fetch_trial_links():
    """Fetch all clinical trial links."""
    print("Fetching clinical trial links...")

    all_links = []
    offset = 0
    batch_size = 1000

    while True:
        response = supabase.table("clinical_studies").select("project_number, nct_id").range(offset, offset + batch_size - 1).execute()

        if not response.data:
            break

        all_links.extend(response.data)
        offset += batch_size

        if len(response.data) < batch_size:
            break

    print(f"Found {len(all_links)} clinical trial links")
    return all_links


def compute_aggregated_counts(core_to_variants: dict, patent_links: list, pub_links: list, trial_links: list):
    """Compute aggregated counts for each core project."""
    print("Computing aggregated counts...")

    # Build reverse mapping: project_number -> core
    pn_to_core = {}
    for core, variants in core_to_variants.items():
        for pn in variants:
            pn_to_core[pn] = core

    # Aggregate patents by core project
    core_patents = defaultdict(set)
    for link in patent_links:
        pn = link.get("project_number")
        patent_id = link.get("patent_id")
        if pn and patent_id:
            core = pn_to_core.get(pn)
            if core:
                core_patents[core].add(patent_id)

    # Aggregate publications by core project
    core_pubs = defaultdict(set)
    for link in pub_links:
        pn = link.get("project_number")
        pmid = link.get("pmid")
        if pn and pmid:
            core = pn_to_core.get(pn)
            if core:
                core_pubs[core].add(pmid)

    # Aggregate trials by core project
    core_trials = defaultdict(set)
    for link in trial_links:
        pn = link.get("project_number")
        nct_id = link.get("nct_id")
        if pn and nct_id:
            core = pn_to_core.get(pn)
            if core:
                core_trials[core].add(nct_id)

    # Build final counts per project_number
    # All variants of the same core project get the same aggregated count
    pn_counts = {}
    for pn, core in pn_to_core.items():
        pn_counts[pn] = {
            "patent_count": len(core_patents.get(core, set())),
            "publication_count": len(core_pubs.get(core, set())),
            "clinical_trial_count": len(core_trials.get(core, set())),
        }

    return pn_counts


def update_counts(pn_counts: dict, dry_run: bool = True):
    """Update the projects table with corrected counts."""
    print(f"\n{'DRY RUN - ' if dry_run else ''}Updating project counts...")

    # Group by counts to batch updates
    updates_needed = 0
    updates_done = 0

    for pn, counts in pn_counts.items():
        if dry_run:
            updates_needed += 1
            if updates_needed <= 5:
                print(f"  Would update {pn}: patent={counts['patent_count']}, pub={counts['publication_count']}, trial={counts['clinical_trial_count']}")
        else:
            try:
                supabase.table("projects").update({
                    "patent_count": counts["patent_count"],
                    "publication_count": counts["publication_count"],
                    "clinical_trial_count": counts["clinical_trial_count"],
                }).eq("project_number", pn).execute()

                updates_done += 1
                if updates_done % 1000 == 0:
                    print(f"  Updated {updates_done} projects...")
            except Exception as e:
                print(f"  Error updating {pn}: {e}")

    if dry_run:
        print(f"\nDry run complete. Would update {updates_needed} projects.")
        print("Run with --execute to apply changes.")
    else:
        print(f"\nUpdated {updates_done} projects.")


def main():
    import sys

    dry_run = "--execute" not in sys.argv

    print("=" * 60)
    print("Fix Linked Data Counts (Aggregate Across Fiscal Years)")
    print("=" * 60)

    # Fetch all data
    project_numbers = fetch_all_project_numbers()
    core_to_variants = build_core_to_variants_map(project_numbers)

    patent_links = fetch_patent_links()
    pub_links = fetch_publication_links()
    trial_links = fetch_trial_links()

    # Compute aggregated counts
    pn_counts = compute_aggregated_counts(core_to_variants, patent_links, pub_links, trial_links)

    # Show some examples of changes
    print("\nExample changes:")
    example_cores = ["P30CA046592", "R44MH136894"]  # From our earlier investigation
    for core in example_cores:
        variants = core_to_variants.get(core, set())
        if variants:
            sample_pn = list(variants)[0]
            counts = pn_counts.get(sample_pn, {})
            print(f"  Core {core} ({len(variants)} variants):")
            print(f"    Patents: {counts.get('patent_count', 0)}")
            print(f"    Publications: {counts.get('publication_count', 0)}")
            print(f"    Trials: {counts.get('clinical_trial_count', 0)}")

    # Update
    update_counts(pn_counts, dry_run=dry_run)


if __name__ == "__main__":
    main()
