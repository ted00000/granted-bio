#!/usr/bin/env python3
"""
Fix misclassified organization types in the projects table.

Uses deterministic keyword matching to correct obvious misclassifications:
- Universities with "UNIVERSITY", "UNIV", "COLLEGE" in name
- Hospitals with "HOSPITAL", "MEDICAL CENTER" in name
- Research institutes with "INSTITUTE", "INST" in name
- Companies with SBIR/STTR activity codes or corporate suffixes
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
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def classify_org_type(org_name: str, activity_code: str = "") -> str | None:
    """
    Deterministic org type classification based on keyword patterns.
    Returns the org_type if a clear match is found, or None to keep existing.

    Priority order:
    1. University keywords (highest)
    2. Hospital keywords
    3. Research institute keywords
    4. Company indicators (lowest)
    """
    if not org_name:
        return None

    org = org_name.upper()
    code = (activity_code or "").upper()

    # University patterns (highest priority)
    if (
        "UNIVERSITY" in org or
        " UNIV " in org or
        " UNIV," in org or
        org.startswith("UNIV ") or
        org.endswith(" UNIV") or
        "COLLEGE" in org
    ):
        return "university"

    # Hospital/Medical Center patterns
    if (
        "HOSPITAL" in org or
        "MEDICAL CENTER" in org or
        "MEDICAL CTR" in org or
        "MED CTR" in org or
        "HEALTH SYSTEM" in org or
        "CHILDREN'S HOSPITAL" in org or
        "CHILDRENS HOSPITAL" in org
    ):
        return "hospital"

    # Research Institute patterns
    if (
        "INSTITUTE" in org or
        " INST " in org or
        " INST," in org or
        org.endswith(" INST")
    ):
        return "research_institute"

    # SBIR/STTR activity codes are always commercial
    if (
        code.startswith("R41") or code.startswith("R42") or
        code.startswith("R43") or code.startswith("R44") or
        code.startswith("SB1") or code.startswith("U43") or
        code.startswith("U44")
    ):
        return "company"

    # Corporate suffixes typically indicate companies
    if (
        org.endswith(" INC") or
        org.endswith(" INC.") or
        org.endswith(", INC") or
        org.endswith(", INC.") or
        org.endswith(" LLC") or
        org.endswith(", LLC") or
        org.endswith(" CORP") or
        org.endswith(" CORP.") or
        org.endswith(", CORP") or
        org.endswith(" LTD") or
        org.endswith(" LTD.")
    ):
        return "company"

    # No clear pattern
    return None


def fetch_projects_needing_fix():
    """Fetch projects that may have incorrect org_type classification."""
    print("Fetching projects to check...")

    all_projects = []
    offset = 0
    batch_size = 1000

    while True:
        response = supabase.table("projects").select(
            "project_number, org_name, org_type, activity_code"
        ).range(offset, offset + batch_size - 1).execute()

        if not response.data:
            break

        all_projects.extend(response.data)
        offset += batch_size

        if len(response.data) < batch_size:
            break

    print(f"Fetched {len(all_projects)} projects")
    return all_projects


def analyze_and_fix(projects: list, dry_run: bool = True):
    """Analyze projects and fix misclassified org_types."""

    fixes_needed = defaultdict(list)

    for project in projects:
        org_name = project.get("org_name") or ""
        activity_code = project.get("activity_code") or ""
        current_type = project.get("org_type")
        project_number = project.get("project_number")

        correct_type = classify_org_type(org_name, activity_code)

        # Only fix if we have a deterministic classification AND it differs
        if correct_type and correct_type != current_type:
            fixes_needed[f"{current_type} -> {correct_type}"].append({
                "project_number": project_number,
                "org_name": org_name,
                "old_type": current_type,
                "new_type": correct_type
            })

    # Summary
    print("\n" + "=" * 60)
    print("Organization Type Corrections Needed")
    print("=" * 60)

    total_fixes = 0
    for change, items in sorted(fixes_needed.items()):
        print(f"\n{change}: {len(items)} projects")
        # Show examples
        for item in items[:3]:
            print(f"  - {item['org_name'][:60]}...")
        if len(items) > 3:
            print(f"  ... and {len(items) - 3} more")
        total_fixes += len(items)

    print(f"\nTotal fixes needed: {total_fixes}")

    if dry_run:
        print("\nDRY RUN - no changes made. Run with --execute to apply.")
        return

    # Apply fixes
    print("\nApplying fixes...")
    updates_done = 0

    for change, items in fixes_needed.items():
        for item in items:
            try:
                supabase.table("projects").update({
                    "org_type": item["new_type"]
                }).eq("project_number", item["project_number"]).execute()

                updates_done += 1
                if updates_done % 1000 == 0:
                    print(f"  Updated {updates_done} projects...")
            except Exception as e:
                print(f"  Error updating {item['project_number']}: {e}")

    print(f"\nUpdated {updates_done} projects.")


def main():
    import sys

    dry_run = "--execute" not in sys.argv

    print("=" * 60)
    print("Fix Organization Type Classifications")
    print("=" * 60)

    projects = fetch_projects_needing_fix()
    analyze_and_fix(projects, dry_run=dry_run)


if __name__ == "__main__":
    main()
