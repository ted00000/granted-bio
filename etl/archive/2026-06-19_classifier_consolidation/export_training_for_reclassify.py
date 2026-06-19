#!/usr/bin/env python3
"""
Export projects currently classified as 'training' for reclassification via Claude Max.

These projects were classified by activity code (F/K/T awards) instead of content.
They should be reclassified by scientific content.
"""

import os
import json
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv('.env.local')

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Training activity codes that were previously auto-classified
TRAINING_CODES = [
    'T32', 'T34', 'T35', 'T90', 'TL1', 'TL4',  # Institutional training
    'F30', 'F31', 'F32', 'F33', 'F99',          # Individual fellowships
    'K01', 'K02', 'K05', 'K07', 'K08', 'K12', 'K22', 'K23', 'K24', 'K25', 'K26', 'K43', 'K76', 'K99', 'KL2',  # Career development
    'D43', 'D71',                                # International training
    'R25', 'R90'                                 # Education programs
]


def fetch_training_projects():
    """Fetch projects with training activity codes."""
    all_projects = []
    batch_size = 1000
    offset = 0

    while True:
        response = supabase.table("projects").select(
            "application_id, project_number, title, org_name, phr, terms, activity_code, primary_category"
        ).in_("activity_code", TRAINING_CODES).range(offset, offset + batch_size - 1).execute()

        if not response.data:
            break

        all_projects.extend(response.data)
        print(f"  Fetched {len(all_projects)} training projects...")

        if len(response.data) < batch_size:
            break

        offset += batch_size

    return all_projects


def format_project(project: dict) -> str:
    """Format a single project for Claude Max input."""
    phr = project.get('phr') or ''
    # Truncate PHR to save context space
    if len(phr) > 800:
        phr = phr[:800] + '...'

    return f"""---
application_id: {project['application_id']}
activity_code: {project.get('activity_code') or 'N/A'}
title: {project.get('title') or 'N/A'}
org_name: {project.get('org_name') or 'N/A'}
phr: {phr}
terms: {project.get('terms') or 'N/A'}"""


def export_batches(projects: list, batch_size: int = 50, output_dir: str = "etl/training_reclassify_batches"):
    """Export projects as batch files for Claude Max."""
    os.makedirs(output_dir, exist_ok=True)

    num_batches = (len(projects) + batch_size - 1) // batch_size

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

        batch_content = prompt_header
        batch_content += f"Batch {i+1} of {num_batches} ({len(batch)} projects):\n\n"
        batch_content += "\n".join(format_project(p) for p in batch)

        filename = f"{output_dir}/batch_{i+1:04d}.txt"
        with open(filename, "w") as f:
            f.write(batch_content)

        print(f"  Wrote {filename} ({len(batch)} projects)")

    # Summary file
    with open(f"{output_dir}/summary.json", "w") as f:
        json.dump({
            "total_projects": len(projects),
            "batch_size": batch_size,
            "num_batches": num_batches,
            "activity_codes": TRAINING_CODES,
            "batches": [
                {
                    "batch": i + 1,
                    "file": f"batch_{i+1:04d}.txt",
                    "start_offset": i * batch_size,
                    "count": min(batch_size, len(projects) - i * batch_size)
                }
                for i in range(num_batches)
            ]
        }, f, indent=2)

    print(f"\nExported {num_batches} batches to {output_dir}/")
    return num_batches


def main():
    import sys

    batch_size = 50
    for arg in sys.argv:
        if arg.startswith("--batch-size="):
            batch_size = int(arg.split("=")[1])

    print("=" * 60)
    print("Export Training Projects for Reclassification")
    print("=" * 60)
    print(f"Batch size: {batch_size}")
    print(f"Activity codes: {', '.join(TRAINING_CODES)}")

    print("\nFetching training projects...")
    projects = fetch_training_projects()
    print(f"\nTotal projects to reclassify: {len(projects)}")

    # Show breakdown by activity code
    from collections import Counter
    by_code = Counter(p.get('activity_code') for p in projects)
    print("\nBy activity code:")
    for code, count in sorted(by_code.items(), key=lambda x: -x[1])[:10]:
        print(f"  {code}: {count}")

    print("\nExporting batches...")
    num_batches = export_batches(projects, batch_size=batch_size)

    print(f"\nDone! {num_batches} batches created.")
    print("Paste each batch into Claude Max and save the JSON responses.")
    print("Then use import_classifications.py to apply the new classifications.")


if __name__ == "__main__":
    main()
