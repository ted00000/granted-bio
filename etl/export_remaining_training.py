#!/usr/bin/env python3
"""
Export remaining projects still marked as 'training' for reclassification.
"""

import os
import json
from pathlib import Path
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv('.env.local')

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

OUTPUT_DIR = Path("etl/remaining_training_batches")


def fetch_remaining_training():
    """Fetch projects still marked as 'training'."""
    all_projects = []
    batch_size = 1000
    offset = 0

    while True:
        response = supabase.table("projects").select(
            "application_id, project_number, title, org_name, phr, terms, activity_code"
        ).eq("primary_category", "training").range(offset, offset + batch_size - 1).execute()

        if not response.data:
            break

        all_projects.extend(response.data)
        print(f"  Fetched {len(all_projects)} projects...")

        if len(response.data) < batch_size:
            break

        offset += batch_size

    return all_projects


def format_project(project: dict) -> str:
    """Format a single project for Claude Max input."""
    phr = project.get('phr') or ''
    if len(phr) > 800:
        phr = phr[:800] + '...'

    return f"""---
application_id: {project['application_id']}
activity_code: {project.get('activity_code') or 'N/A'}
title: {project.get('title') or 'N/A'}
org_name: {project.get('org_name') or 'N/A'}
phr: {phr}
terms: {project.get('terms') or 'N/A'}"""


def export_batches(projects: list, num_batches: int = 10):
    """Export projects evenly across specified number of batches."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    batch_size = (len(projects) + num_batches - 1) // num_batches

    prompt_header = """Classify these NIH grants by SCIENTIFIC CONTENT (not administrative mechanism).

These are F/K/T awards that were previously auto-classified as "training" based on activity code.
Now classify them by what the research actually IS:

Categories:
- basic_research: Understanding mechanisms, pathways, disease processes (knowledge output)
- biotools: Developing research tools, assays, methods, platforms (tool output)
- therapeutics: Developing drugs, treatments, therapies (treatment output)
- diagnostics: Developing clinical tests, biomarker panels (diagnostic test output)
- medical_device: Developing physical devices for patients (device output)
- digital_health: Patient-facing software, apps, clinical decision support
- other: Health services, behavioral interventions, epidemiology

Return a JSON array:
[{"application_id": 123, "primary_category": "basic_research", "category_confidence": 85}]

"""

    for i in range(num_batches):
        start = i * batch_size
        end = min(start + batch_size, len(projects))
        batch = projects[start:end]

        if not batch:
            break

        batch_content = prompt_header
        batch_content += f"Batch {i+1} of {num_batches} ({len(batch)} projects):\n\n"
        batch_content += "\n".join(format_project(p) for p in batch)

        filename = OUTPUT_DIR / f"remaining_batch_{i+1:02d}.txt"
        filename.write_text(batch_content)

        print(f"  Wrote {filename.name} ({len(batch)} projects)")

    # Summary
    summary = {
        "total_projects": len(projects),
        "num_batches": num_batches,
        "batch_size": batch_size,
        "batches": [
            {
                "batch": i + 1,
                "file": f"remaining_batch_{i+1:02d}.txt",
                "count": min(batch_size, len(projects) - i * batch_size)
            }
            for i in range(num_batches)
            if i * batch_size < len(projects)
        ]
    }
    (OUTPUT_DIR / "summary.json").write_text(json.dumps(summary, indent=2))

    print(f"\nExported {num_batches} batches to {OUTPUT_DIR}/")


def main():
    print("=" * 60)
    print("Export Remaining Training Projects")
    print("=" * 60)

    print("\nFetching projects still marked as 'training'...")
    projects = fetch_remaining_training()
    print(f"\nTotal remaining: {len(projects)}")

    if not projects:
        print("No remaining training projects!")
        return

    print("\nExporting to 10 batches...")
    export_batches(projects, num_batches=10)

    print("\nDone! Process each batch through Claude Max.")


if __name__ == "__main__":
    main()
