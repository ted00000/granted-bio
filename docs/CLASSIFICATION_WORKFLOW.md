# NIH Grant Classification Workflow

**Document:** Complete Classification Reference for FY2026+
**Last Updated:** 2026-03-09
**Status:** Production workflow for all future batches

---

## Overview

This document captures the complete workflow for classifying NIH grants into 9 categories. It consolidates all lessons learned from classifying 150,000+ projects across FY2024-FY2026.

**Output Schema:**
```
application_id, primary_category, category_confidence, secondary_category, org_type
```

**Categories:** training, infrastructure, basic_research, biotools, therapeutics, diagnostics, medical_device, digital_health, other

**Org Types:** university, hospital, company, research_institute, other

---

## Quick Start: Running Classification

### Step 1: Export Unclassified Projects
```bash
cd etl
python find_unclassified.py
# Creates: unclassified_projects.csv
```

### Step 2: Run Classification
```bash
python classify_from_database.py
# Classifies directly from/to database
# Shows progress, handles batching, validates results
```

### Step 3: Verify Results
```sql
-- Check distribution
SELECT primary_category, COUNT(*)
FROM projects
WHERE fiscal_year = 2026
GROUP BY primary_category;

-- Check confidence distribution
SELECT
  CASE
    WHEN primary_category_confidence >= 85 THEN 'high (85+)'
    WHEN primary_category_confidence >= 70 THEN 'medium (70-84)'
    ELSE 'low (<70)'
  END as confidence_band,
  COUNT(*)
FROM projects
GROUP BY 1;
```

---

## The Two-Phase Classification Architecture

### Phase 1: Automated First-Pass (95%+ of projects)

The Python classifier handles deterministic rules and high-confidence classifications:

1. **Activity Code Determinism** (32K+ projects at 95% confidence)
2. **Core/Facility Detection** (within multi-component grants)
3. **SBIR/STTR Routing** (never basic_research)
4. **Keyword Scoring** with disambiguation rules

**Result:** Each project marked as:
- `OK` - High confidence, no review needed
- `REVIEW` - Needs human/Claude review

### Phase 2: Claude Review (REVIEW-flagged projects only)

For ambiguous cases, Claude reads the full abstract and applies nuanced judgment.

---

## Activity Code Reference (Deterministic Rules)

### Always → training (regardless of content)
```
T32, T34, T35, T90, TL1, TL4    → Institutional training
F30, F31, F32, F33, F99         → Individual fellowships
K01-K99 series                   → Career development awards
D43, D71                         → International training
R25, R90                         → Education programs
U45, UH4                         → Worker safety training
```

### Always → infrastructure (regardless of content)
```
P30, P50, P51                    → Center grants
S10, G20                         → Equipment/resource grants
U13, R13                         → Conference grants
U24, U2C                         → Resource/coordination grants
UC7                              → Biosafety labs
```

### Product Development Context (SBIR/STTR)
```
R41, R42, R43, R44, SB1, U44    → NEVER basic_research
                                 → Company org_type
                                 → Score for: therapeutics, biotools,
                                   diagnostics, medical_device, digital_health
```

### Multi-Component Grants (check for cores)
```
P01, P20, P2C, P60, U19, U54,   → Check title/abstract for core indicators
U24, U2C, UC7, UG4, U42         → Administrative cores → infrastructure
                                 → Mentoring cores → training
                                 → Research projects → normal scoring
```

---

## The 8 Disambiguation Rules

These rules prevent systematic misclassifications. Apply them in order:

### Rule 1: Tool Development vs Tool Usage
| Pattern | Category | Example |
|---------|----------|---------|
| DEVELOPS an assay/platform | biotools | "Develop a high-throughput screening platform" |
| USES an assay/platform | basic_research | "Use CRISPR screening to identify cancer genes" |

**Key verbs:** develop, design, create, build, optimize = biotools
**Key verbs:** use, apply, employ, leverage = basic_research

### Rule 2: Biomarker Intent
| Pattern | Category |
|---------|----------|
| "Identify biomarkers associated with X" | basic_research (discovery) |
| "Validate clinical biomarker panel for X" | diagnostics (clinical test) |
| "Build multiplex assay for biomarker detection" | biotools (platform) |

### Rule 3: Drug Mechanism vs Drug Development
| Pattern | Category |
|---------|----------|
| "Understand how drug X works" | basic_research |
| "Optimize drug X for efficacy" | therapeutics |
| "Develop drug delivery system" | therapeutics (OR medical_device if novel hardware) |

### Rule 4: AI/ML by Application
| Application | Category |
|-------------|----------|
| ML for protein folding prediction | basic_research |
| ML drug screening pipeline | therapeutics |
| ML tool for researchers | biotools |
| ML clinical diagnosis app | diagnostics |
| ML patient-facing app | digital_health |

### Rule 5: digital_health Requires Deployment Context
- Software for researchers → biotools
- Software for clinicians (decision support) → digital_health
- Software for patients → digital_health

**Gate words:** patient, clinician, clinic, hospital, deployed, end user

### Rule 6: Behavioral Interventions
| Pattern | Category |
|---------|----------|
| Behavioral intervention WITHOUT drugs | other |
| Behavioral + pharmacotherapy | therapeutics |

**Behavioral signals:** smoking cessation, CBT, mindfulness, lifestyle modification, peer support

### Rule 7: Combination Projects
Classify by PRIMARY innovation (usually Aim 1 or title focus).
Assign secondary category if runner-up score ≥30% of winner.

### Rule 8: "other" is Genuinely Residual
True "other" examples:
- Health policy research
- Epidemiological surveys
- Implementation science
- Health services research
- Community health interventions (without drug/device)

**Before using "other":** Re-read abstract for hidden deliverables.

---

## Category Definitions with Examples

### 1. training (15-16% of projects)
**Definition:** Programs focused on training/education/career development.

**Examples:**
- T32 institutional training grants
- K99 career transition awards
- Mentoring cores in P01 grants

### 2. infrastructure (12-13% of projects)
**Definition:** Core facilities, equipment, coordination, resources that support research.

**Examples:**
- P30 cancer center support grants
- S10 instrumentation grants
- Biostatistics cores, Genomics cores
- SEER cancer registries

### 3. basic_research (40-42% of projects)
**Definition:** Understanding biology/mechanisms WITHOUT product output.

**Key signals:**
- "Elucidate mechanism of..."
- "Understanding role of..."
- "Characterize function of..."

**Output:** Knowledge, not a product.

### 4. biotools (3-4% of projects)
**Definition:** DEVELOPING tools/platforms/methods for researchers.

**Key signals:**
- "Develop a platform for..."
- "Novel assay for..."
- "Computational pipeline for..."
- "Community resource"

**Output:** Tool that other researchers use.

### 5. therapeutics (14-15% of projects)
**Definition:** DEVELOPING drugs, treatments, interventions.

**Key signals:**
- "Drug development"
- "Clinical trial"
- "Gene therapy for..."
- "Vaccine candidate"

**Output:** Treatment for patients.

### 6. diagnostics (1.5-2% of projects)
**Definition:** DEVELOPING clinical tests for detection/diagnosis.

**Key signals:**
- "Diagnostic test for..."
- "Early detection"
- "Liquid biopsy"
- "Point-of-care test"

**Output:** Clinical diagnostic.

### 7. medical_device (0.5-1% of projects)
**Definition:** DEVELOPING physical devices for patient treatment.

**Key signals:**
- "Implantable device"
- "Neural interface"
- "Prosthetic"
- "Tissue scaffold"

**Output:** Physical medical device.

**Gate:** Requires development intent words (develop, design, fabricate, engineer).

### 8. digital_health (0.5-1% of projects)
**Definition:** DEPLOYING software/apps for patient care.

**Key signals:**
- "Telemedicine platform"
- "mHealth app"
- "Clinical decision support"
- "Remote patient monitoring"

**Output:** Patient-deployed software.

**Gate:** Requires deployment context (patient, clinician, clinic).

### 9. other (6-7% of projects)
**Definition:** Research that doesn't fit above categories.

**Examples:**
- Health disparities research
- Implementation science
- Epidemiological cohort studies
- Behavioral interventions without drugs

---

## Org Type Classification

### company (always for SBIR/STTR)
**Signals:** LLC, Inc., Corp., Therapeutics, Biosciences, Pharmaceuticals

### university
**Signals:** University, College, Institute of Technology

### hospital
**Signals:** Hospital, Medical Center, Health System, Clinic
**Note:** "University of X Medical Center" → hospital (not university)

### research_institute
**Named examples:** Scripps, Broad, Salk, Fred Hutchinson, Jackson Laboratory, Wistar, Allen Institute

### other
**Examples:** Government agencies, foundations, non-profits

---

## Confidence Scoring

### Activity Code Determinism
- Training/infrastructure codes → 95%

### Content-Based Scoring
Based on margin (top score - second score):
- Margin ≥10 → 90%
- Margin ≥6 → 85%
- Margin ≥3 → 85%
- Margin ≥2 → 80%
- Margin ≥1 → 80% (if max_score ≥5) or 75%
- Margin <1 → 70%

### Absolute Score Boosts (minimum confidence floor)
- Max_score ≥20 → 90% minimum
- Max_score ≥12 → 85% minimum
- Max_score ≥6 → 80% minimum

---

## Historical Distribution Targets

Based on validated FY2024-2025 data:

| Category | % of Classified | Count (150K) |
|----------|-----------------|--------------|
| training | 15-16% | ~22,000 |
| infrastructure | 12-13% | ~18,000 |
| basic_research | 40-42% | ~60,000 |
| biotools | 3-4% | ~5,000 |
| therapeutics | 14-15% | ~21,000 |
| diagnostics | 1.5-2% | ~2,500 |
| medical_device | 0.5-1% | ~1,000 |
| digital_health | 0.5-1% | ~1,000 |
| other | 6-7% | ~10,000 |
| unclassified | 4% | ~6,000 |

**If your batch deviates significantly from these percentages, investigate.**

---

## Known Edge Cases

### 1. "Develops method to study X"
- If method is primary deliverable AND for community → biotools
- If method serves a biological question → basic_research
- **Heuristic:** Look for distribution intent words (open source, shared resource, community, made available)

### 2. "Understand mechanism to improve treatment"
- If output is a drug/intervention ready for testing → therapeutics
- If output is knowledge about why treatments work → basic_research
- **Heuristic:** Check for clinical trial, lead compound, drug candidate

### 3. P01/U19 Research Projects (not cores)
- Go through content-based scoring like R01
- Only cores are auto-infrastructure

### 4. Cancer Center Support (P30)
- Always infrastructure, regardless of title

### 5. SEER Registries
- Always infrastructure (data infrastructure)

---

## Troubleshooting

### Too many basic_research
- Check if therapeutics title signals are being captured
- Verify Rule 11 (therapeutic title intent) is working
- May need to strengthen title-based therapeutics boosts

### Too few biotools
- biotools dropped from Haiku's 11K to ~4K (mostly correct)
- Haiku over-classified "uses tool" as biotools
- Check distribution intent is being detected

### Too many "other"
- Re-check behavioral intervention detection
- Verify health services/epi patterns
- Some legitimate (policy, epidemiology)

### Low confidence cluster at 50-60%
- These are genuinely ambiguous or lack abstract
- conf=0 with abstract < 50 chars is correct
- R-series with no signals → basic_research at 60% is fallback

---

## Quality Checklist

Before finalizing a classification batch:

- [ ] Category distribution within expected ranges
- [ ] ≥88% at confidence ≥80%
- [ ] SBIR/STTR → never basic_research
- [ ] Training codes → 100% training
- [ ] Infrastructure codes → 100% infrastructure
- [ ] No company org_type for university names
- [ ] Random sample spot-check (10-20 projects per category)

---

## File Locations

```
etl/
├── classify_from_database.py    # Main classification script
├── semantic_classifier.py       # Rule-based classifier module
├── find_unclassified.py         # Export unclassified to CSV
├── import_classifications.py    # Import classifications to DB
├── classification_prompt.md     # Claude Max prompt for manual review
└── HANDOFF_NEXT_CHAT.md        # Detailed handoff (legacy)

docs/
├── CLASSIFICATION_WORKFLOW.md   # This document
├── 03_CLASSIFICATION_ALGORITHM.md  # Biotools-specific algorithm (older)
└── CLASSIFICATION_IMPROVEMENT_PLAN.md  # Few-shot learning plan (optional)
```

---

## Revision History

| Date | Change |
|------|--------|
| 2026-03-09 | Created comprehensive workflow from FY2024-2026 lessons |
| 2026-03-09 | Added database-integrated classification script |
