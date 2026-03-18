#!/usr/bin/env python3
"""
Reclassify projects using Claude Sonnet for better accuracy.

Uses the improved decision framework prompt and Sonnet's stronger reasoning.
"""

import os
import json
import time
from anthropic import Anthropic
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv('.env.local')

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
if not ANTHROPIC_API_KEY:
    raise ValueError("Missing ANTHROPIC_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
anthropic = Anthropic(api_key=ANTHROPIC_API_KEY)

CLASSIFICATION_PROMPT = """Analyze this NIH grant and classify it. Return only valid JSON, no other text.

Project Data:
Title: {title}
Organization: {org_name}
Abstract: {abstract}
Public Health Relevance: {phr}
Keywords: {terms}
Activity Code: {activity_code}

Return JSON in this exact format:
{{
  "primary_category": "training|infrastructure|basic_research|biotools|therapeutics|diagnostics|medical_device|digital_health|other",
  "category_confidence": 0-100,
  "reasoning": "1-2 sentence explanation"
}}

## ACTIVITY CODE PRE-FILTER (Check FIRST!)

Always → training: T32, T34, T35, T90, TL1, TL4, F30-F33, F99, K01-K99 series, D43, D71, R25, R90
Always → infrastructure: P30, P41, P42, P50, P51, S10, G20, U13, R13, U24, U2C

## THE 9 CATEGORIES

1. training - Programs for training/education/career development of researchers
2. infrastructure - Core facilities, centers, equipment, coordination grants, reference atlases, databases, biobanks, consortium data resources (HuBMAP, Human Cell Atlas, ENCODE)
3. basic_research - Understanding biology/mechanisms WITHOUT a tool/drug/diagnostic. OUTPUT = knowledge. Includes tissue mapping, cell atlas creation, characterization studies
4. biotools - DEVELOPING research tools, assays, platforms, methods. OUTPUT = tool for researchers
5. therapeutics - DEVELOPING drugs/treatments for patients. OUTPUT = therapy. NOT behavioral interventions
6. diagnostics - DEVELOPING clinical tests for disease detection. OUTPUT = diagnostic test
7. medical_device - DEVELOPING physical devices for patient treatment. Must be MEDICAL
8. digital_health - CLINICAL software for PATIENT care only. Telemedicine, EHR tools, patient-facing apps. NOT research data visualization or scientific databases
9. other - Health services, behavioral interventions, epidemiology, non-biomedical research

## DECISION FRAMEWORK

STEP 1 - Who is the end user?
- Scientist/researcher → biotools, basic_research, or infrastructure
- Patient/clinician/caregiver → diagnostics, digital_health, therapeutics, or medical_device

STEP 2 - What is the output?
- Product sold to researchers → biotools
- Knowledge/dataset for community → basic_research
- Shared platform/standard/data commons → infrastructure
- Clinical detection/diagnosis → diagnostics
- Software for clinical care → digital_health
- Drug/biologic/cell therapy → therapeutics
- Physical device on patients → medical_device

## BOUNDARY TIE-BREAKERS

Biotools vs Basic Research:
- Product with customer → biotools
- Paper or dataset → basic_research
- "Developing new sequencing method" → biotools
- "Using sequencing to map brain" → basic_research

Biotools vs Infrastructure:
- One lab sells it → biotools
- Consortium builds for everyone → infrastructure
- "Cell sorting platform" → biotools
- "Reference cell atlas for community" → infrastructure

Diagnostics vs Digital Health:
- Clinical detection claim → diagnostics
- Managing/monitoring health behavior → digital_health

Diagnostics vs Biotools:
- Research-use only, no regulatory intent → biotools (even with clinical samples)
- FDA pathway, patient diagnosis → diagnostics

Medical Device vs Therapeutics:
- Physical device on body → medical_device
- Drug/biologic/cell therapy → therapeutics

## RED HERRINGS (Don't be fooled!)

- Disease mentions ≠ therapeutics (researchers study diseases with tools)
- ML/imaging ≠ diagnostics (often just biotools for research)
- Clinical samples ≠ diagnostics (research context = biotools)
- SBIR/STTR = usually biotools or therapeutics, rarely digital_health"""


def classify_project(project: dict, retries: int = 2) -> dict:
    """Classify a single project using Sonnet with timeout and retries."""
    prompt = CLASSIFICATION_PROMPT.format(
        title=project.get("title") or "N/A",
        org_name=project.get("org_name") or "N/A",
        abstract="N/A",  # Abstract not stored in projects table
        phr=project.get("phr") or "N/A",
        terms=project.get("terms") or "N/A",
        activity_code=project.get("activity_code") or "N/A"
    )

    for attempt in range(retries + 1):
        try:
            response = anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=512,
                timeout=30.0,  # 30 second timeout
                messages=[{"role": "user", "content": prompt}]
            )

            text = response.content[0].text.strip()

            # Handle markdown code blocks
            if text.startswith("```json"):
                text = text.replace("```json\n", "").replace("\n```", "")
            elif text.startswith("```"):
                text = text.replace("```\n", "").replace("\n```", "")

            result = json.loads(text)
            return result
        except Exception as e:
            if attempt < retries:
                print(f"  Retry {attempt + 1}/{retries} after error: {e}")
                time.sleep(2)  # Wait before retry
            else:
                print(f"  Error classifying: {e}")
                return None


def fetch_projects(limit: int = None, offset: int = 0, exclude_infrastructure: bool = False):
    """Fetch projects that need classification. Paginates through all if no limit."""
    all_projects = []
    batch_size = 1000
    current_offset = offset

    while True:
        query = supabase.table("projects").select(
            "application_id, project_number, title, org_name, phr, terms, activity_code, primary_category, primary_category_confidence"
        ).order("total_cost", desc=True)

        # Optionally exclude obvious infrastructure grants
        if exclude_infrastructure:
            query = query.not_.ilike("activity_code", "P50%").not_.ilike("activity_code", "P20%").not_.ilike("activity_code", "P30%")

        # Fetch batch
        end_idx = current_offset + batch_size - 1
        if limit:
            end_idx = min(end_idx, offset + limit - 1)
        query = query.range(current_offset, end_idx)

        response = query.execute()
        if not response.data:
            break

        all_projects.extend(response.data)
        print(f"  Fetched {len(all_projects)} projects...")

        # Check if we've hit the limit or got fewer than batch_size
        if limit and len(all_projects) >= limit:
            all_projects = all_projects[:limit]
            break
        if len(response.data) < batch_size:
            break

        current_offset += batch_size

    return all_projects


def main():
    import sys

    dry_run = "--execute" not in sys.argv

    # Parse optional limit and offset from args
    limit = None
    start_offset = 0
    for arg in sys.argv:
        if arg.startswith("--limit="):
            limit = int(arg.split("=")[1])
        elif arg.startswith("--offset="):
            start_offset = int(arg.split("=")[1])

    print("=" * 60)
    print("Reclassify Projects with Sonnet")
    print("=" * 60)

    if dry_run:
        print("DRY RUN - will show changes but not apply them")
        print("Run with --execute to apply changes")

    # Fetch all projects (or limited subset)
    if start_offset > 0:
        print(f"Resuming from offset {start_offset}")
    projects = fetch_projects(limit=limit, offset=start_offset, exclude_infrastructure=False)
    print(f"\nFetched {len(projects)} projects (starting at offset {start_offset})\n")

    changes = []

    for i, project in enumerate(projects):
        app_id = project["application_id"]
        old_category = project.get("primary_category")
        old_confidence = project.get("primary_category_confidence")

        abs_pos = start_offset + i + 1
        print(f"[{abs_pos}/154159] {project['project_number']}: {project['title'][:60]}...")

        result = classify_project(project)

        if not result:
            print("  SKIP - classification failed")
            continue

        new_category = result.get("primary_category")
        new_confidence = result.get("category_confidence", 0)
        reasoning = result.get("reasoning", "")

        if new_category != old_category:
            changes.append({
                "application_id": app_id,
                "project_number": project["project_number"],
                "title": project["title"][:60],
                "old": old_category,
                "new": new_category,
                "confidence": new_confidence,
                "reasoning": reasoning
            })
            print(f"  CHANGE: {old_category} -> {new_category} ({new_confidence}%)")
            print(f"  Reason: {reasoning}")
        else:
            print(f"  OK: {new_category} ({new_confidence}%)")

        # No rate limiting needed - API latency (~3-4s) provides natural throttling

    # Summary
    print("\n" + "=" * 60)
    print(f"Classification Changes: {len(changes)} of {len(projects)}")
    print("=" * 60)

    # Save changes to log file for review
    from datetime import datetime
    log_file = f"etl/reclassify_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(log_file, "w") as f:
        json.dump({
            "total_projects": len(projects),
            "total_changes": len(changes),
            "changes": changes
        }, f, indent=2)
    print(f"\nChanges log saved to: {log_file}")

    # Print summary by category transition
    from collections import Counter
    transitions = Counter(f"{c['old']} -> {c['new']}" for c in changes)
    print("\nChanges by category transition:")
    for transition, count in transitions.most_common():
        print(f"  {transition}: {count}")

    if dry_run:
        print("\nDRY RUN - no changes applied. Run with --execute to apply.")
        return

    # Apply changes
    print("\nApplying changes...")
    applied = 0
    errors = 0
    for i, change in enumerate(changes):
        try:
            supabase.table("projects").update({
                "primary_category": change["new"],
                "primary_category_confidence": change["confidence"]
            }).eq("application_id", change["application_id"]).execute()
            applied += 1
            if applied % 100 == 0:
                print(f"  Applied {applied}/{len(changes)} changes...")
        except Exception as e:
            errors += 1
            print(f"  Error updating {change['project_number']}: {e}")

    print(f"\nDone. Applied {applied} changes, {errors} errors.")


if __name__ == "__main__":
    main()
