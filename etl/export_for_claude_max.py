#!/usr/bin/env python3
"""
Export projects in batches for classification via Claude Max.

Generates text files with batched project data that can be pasted into Claude Max.
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


def fetch_projects(limit: int = None, offset: int = 0):
    """Fetch projects that need classification."""
    all_projects = []
    batch_size = 1000
    current_offset = offset

    while True:
        query = supabase.table("projects").select(
            "application_id, project_number, title, org_name, phr, terms, activity_code, primary_category"
        ).order("total_cost", desc=True)

        end_idx = current_offset + batch_size - 1
        if limit:
            end_idx = min(end_idx, offset + limit - 1)
        query = query.range(current_offset, end_idx)

        response = query.execute()
        if not response.data:
            break

        all_projects.extend(response.data)
        print(f"  Fetched {len(all_projects)} projects...")

        if limit and len(all_projects) >= limit:
            all_projects = all_projects[:limit]
            break
        if len(response.data) < batch_size:
            break

        current_offset += batch_size

    return all_projects


def format_project(project: dict) -> str:
    """Format a single project for Claude Max input."""
    return f"""---
application_id: {project['application_id']}
activity_code: {project.get('activity_code') or 'N/A'}
title: {project.get('title') or 'N/A'}
org_name: {project.get('org_name') or 'N/A'}
phr: {(project.get('phr') or 'N/A')[:500]}
terms: {project.get('terms') or 'N/A'}
current_category: {project.get('primary_category') or 'N/A'}"""


def export_batches(projects: list, batch_size: int = 50, output_dir: str = "etl/claude_max_batches", start_batch: int = 1):
    """Export projects as batch files for Claude Max."""
    os.makedirs(output_dir, exist_ok=True)

    num_batches = (len(projects) + batch_size - 1) // batch_size

    for i in range(num_batches):
        start = i * batch_size
        end = min(start + batch_size, len(projects))
        batch = projects[start:end]

        batch_content = f"Classify these {len(batch)} NIH grants. Return a JSON array with classifications.\n\n"
        batch_content += "\n".join(format_project(p) for p in batch)

        batch_num = start_batch + i
        filename = f"{output_dir}/batch_{batch_num:04d}.txt"
        with open(filename, "w") as f:
            f.write(batch_content)

        print(f"  Wrote {filename} ({len(batch)} projects)")

    # Also create a summary file
    with open(f"{output_dir}/summary.json", "w") as f:
        json.dump({
            "total_projects": len(projects),
            "batch_size": batch_size,
            "num_batches": num_batches,
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

    # Parse args
    limit = None
    offset = 0
    batch_size = 50
    start_batch = 1

    for arg in sys.argv:
        if arg.startswith("--limit="):
            limit = int(arg.split("=")[1])
        elif arg.startswith("--offset="):
            offset = int(arg.split("=")[1])
        elif arg.startswith("--batch-size="):
            batch_size = int(arg.split("=")[1])
        elif arg.startswith("--start-batch="):
            start_batch = int(arg.split("=")[1])

    print("=" * 60)
    print("Export Projects for Claude Max")
    print("=" * 60)
    print(f"Batch size: {batch_size}")
    if limit:
        print(f"Limit: {limit}")
    if offset:
        print(f"Offset: {offset}")
    if start_batch > 1:
        print(f"Start batch: {start_batch}")

    print("\nFetching projects...")
    projects = fetch_projects(limit=limit, offset=offset)
    print(f"\nTotal projects: {len(projects)}")

    print("\nExporting batches...")
    export_batches(projects, batch_size=batch_size, start_batch=start_batch)

    print("\nDone! Paste each batch file into Claude Max and save the JSON responses.")
    print("Then use import_claude_max_results.py to apply the classifications.")


if __name__ == "__main__":
    main()
