# Semantic Review Instructions

You are reviewing NIH grant projects that need semantic classification. For each project, apply the classification rules from PROJECT_PROMPT_SEMANTIC.md.

## Output Format

For each project, output:
```
application_id,primary_category,category_confidence,secondary_category,org_type,reasoning
```

## Quick Reference - Categories

- **training** (95): Activity codes T32, F31, K01, etc. - Career/fellowship/training grants
- **infrastructure** (95): Activity codes P30, P50, S10, etc. - Cores, centers, equipment
- **basic_research**: Understanding mechanisms, pathways, biology - knowledge is deliverable
- **biotools**: DEVELOPING tools, assays, methods, platforms for researchers
- **therapeutics**: DEVELOPING drugs, treatments, therapies for patients
- **diagnostics**: DEVELOPING clinical tests, biomarker panels for diagnosis
- **medical_device**: DEVELOPING physical devices for patient care
- **digital_health**: DEVELOPING patient/clinician-facing software
- **other**: Health services, behavioral (no drugs), epidemiology, cohorts

## Key Decision Rules

1. **USES vs DEVELOPS**: Using scRNA-seq to study cancer = basic_research. Improving scRNA-seq = biotools.
2. **Activity code overrides**: Training/fellowship codes → training even if topic sounds like research
3. **SBIR/STTR (R41-R44, SB1, U44)**: Never basic_research - always product development
4. **Behavioral without drugs**: → other (not therapeutics)
5. **Primary deliverable drives classification**: Not methods used, not disease studied

## Process Each Project

1. Check activity code for deterministic rules
2. Read title and abstract
3. Ask: "What is the PRIMARY DELIVERABLE?"
4. Classify and assign confidence (90-95 if clear, 75-85 if spanning categories)
5. Add brief reasoning (1 sentence)
