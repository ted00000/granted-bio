#!/usr/bin/env python3
"""
Create a batch file containing all projects that weren't classified in the first pass.

Compares source batch files against classified outputs to find missing application_ids,
then creates a consolidated batch file for re-processing through Claude Max.
"""

import os
import re
import json
from pathlib import Path

SOURCE_DIR = Path("etl/training_reclassify_batches")
CLASSIFIED_DIR = Path("etl/training_reclassify_batches/training_reclassified")
OUTPUT_FILE = Path("etl/training_reclassify_batches/missing_projects_batch.txt")


def extract_projects_from_batch(filepath: Path) -> dict:
    """Extract application_id -> project data from a source batch file."""
    content = filepath.read_text()
    projects = {}

    # Split by project delimiter
    entries = content.split("---\n")

    for entry in entries:
        if not entry.strip() or "application_id:" not in entry:
            continue

        # Parse the project fields
        project = {}
        for line in entry.strip().split("\n"):
            if ":" in line:
                key, _, value = line.partition(":")
                project[key.strip()] = value.strip()

        if "application_id" in project:
            try:
                app_id = int(project["application_id"])
                projects[app_id] = project
            except ValueError:
                pass

    return projects


def extract_classified_ids(filepath: Path) -> set:
    """Extract classified application_ids from an output file."""
    content = filepath.read_text()
    ids = set()

    # Find JSON array in content
    match = re.search(r'\[[\s\S]*\]', content)
    if not match:
        return ids

    try:
        data = json.loads(match.group())
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and "application_id" in item:
                    ids.add(int(item["application_id"]))
    except (json.JSONDecodeError, ValueError):
        pass

    return ids


def format_project(project: dict) -> str:
    """Format a project for Claude Max input."""
    return f"""---
application_id: {project.get('application_id', 'N/A')}
activity_code: {project.get('activity_code', 'N/A')}
title: {project.get('title', 'N/A')}
org_name: {project.get('org_name', 'N/A')}
phr: {project.get('phr', 'N/A')}
terms: {project.get('terms', 'N/A')}"""


def main():
    print("=" * 60)
    print("Create Missing Projects Batch")
    print("=" * 60)

    # Step 1: Load all source projects
    print("\nLoading source batch files...")
    all_projects = {}
    source_files = sorted(SOURCE_DIR.glob("batch_*.txt"))

    for filepath in source_files:
        projects = extract_projects_from_batch(filepath)
        for app_id, project in projects.items():
            if app_id not in all_projects:
                all_projects[app_id] = project

    print(f"  Found {len(all_projects)} unique projects in source files")

    # Step 2: Load all classified IDs
    print("\nLoading classified output files...")
    classified_ids = set()
    output_files = list(CLASSIFIED_DIR.glob("*"))

    for filepath in output_files:
        if filepath.name.startswith('.'):
            continue
        ids = extract_classified_ids(filepath)
        classified_ids.update(ids)
        print(f"  {filepath.name}: {len(ids)} classifications")

    print(f"\n  Total classified: {len(classified_ids)} unique IDs")

    # Step 3: Find missing projects
    source_ids = set(all_projects.keys())
    missing_ids = source_ids - classified_ids

    print(f"\nMissing projects: {len(missing_ids)}")

    if not missing_ids:
        print("No missing projects - all have been classified!")
        return

    # Step 4: Create batch file with missing projects
    print(f"\nCreating batch file: {OUTPUT_FILE}")

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

    missing_projects = [all_projects[app_id] for app_id in sorted(missing_ids)]

    batch_content = prompt_header
    batch_content += f"Missing Projects Batch ({len(missing_projects)} projects):\n\n"
    batch_content += "\n".join(format_project(p) for p in missing_projects)

    OUTPUT_FILE.write_text(batch_content)

    print(f"\n  Wrote {len(missing_projects)} projects to {OUTPUT_FILE}")
    print(f"\nDone! Paste this batch into Claude Max.")


if __name__ == "__main__":
    main()
