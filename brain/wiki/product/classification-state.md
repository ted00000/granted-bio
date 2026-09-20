# Classification state

State of the taxonomies applied to records in the granted.bio index.
Structural facts; coverage percentages that shift with each ETL run are
volatile and specified in [/brain/skills/fetch-platform-facts.md](../../skills/fetch-platform-facts.md).

Every taxonomy in this document is applied to `projects` rows or to child
records linked from projects. There is no organization-, researcher-, or
publication-level "topic" taxonomy separate from what is described here.

## Project classification: `primary_category`

The main taxonomy. Every project gets one primary category.

### Values

The Postgres enum `bio_category` currently holds **eleven** values
(base six from creation plus five added by migration `024_expand_bio_category.sql`):

`biotools`, `therapeutics`, `diagnostics`, `medical_device`,
`digital_health`, `basic_research`, `clinical`, `public_health`,
`training`, `infrastructure`, `other`.

The current production classifier (`etl/classifier.py`) uses **nine** of
these — `clinical` and `public_health` are defined in the enum but not
emitted by the classifier's `VALID_CATEGORIES` list (`etl/classifier.py:57-67`).
Any project rows with `primary_category = 'clinical'` or `'public_health'`
were assigned by an earlier code path and are not maintained by the
current classifier.

### Method

Hybrid two-pass in `etl/classifier.py`:

**Pass 1 — deterministic activity-code routing** (no LLM call).
Matches on the NIH activity code prefix or exact code. Applies confidence
= 95.0 when it fires.

- Training prefixes: `T*`, `F*`, `K*`, `D*` (e.g., T32, F30, K01, D43).
  Plus exact codes `R25`, `R36`, `R38`, `R90`, `UE5`, `ZIE`.
- Infrastructure exact codes: `P01`, `P20`, `P30`, `P40`, `P41`, `P42`,
  `P50`, `P51`, `P60`, `P2C`, `S10`, `G20`, `U13`, `R13`, `U24`, `U2C`,
  `U41`, `U42`, `ZIA`, `ZIC`, `ZIJ`, `N01`, `N02`, `OT2`, `OT3`, `S07`,
  `S08`, `S09`, `S11`.
- Ambiguous codes (R01, U54, U10, U01, etc.) are intentionally NOT in
  Pass 1 — they fall through to Pass 2.

**Pass 2 — LLM content classification** (Claude Haiku 4.5,
`claude-haiku-4-5-20251001`). Batched 20 projects per call. The prompt
poses one anchor question — "What concrete thing will exist at the end of
this project?" — and forces a JSON response with `primary_category` and
`category_confidence` (0–100).

### Confidence

- `primary_category_confidence` FLOAT [0, 100].
- Pass 1 matches: always 95.0.
- Pass 2: LLM-emitted, clamped to [0, 100] in `_normalize_llm_result`.
- Conservative rule-based fixes (`etl/fix_categories_conservative.py`): 75.0.
- Admin overrides via `/api/admin/categorization-review`: 100.0.

### Queryability

- Column has a single-column B-tree index (`idx_projects_primary_category`).
- Exposed as a multi-select filter in `search_projects_filtered` RPC
  (`filter_categories TEXT[]`).
- Exposed in the front-end filter UI at `src/components/FilterChips.tsx`.

### Known state

- Overall classification coverage is high but a substantial residual sits
  in `other` (mainly ambiguous, non-biotech health services, epidemiology,
  behavioral research). Exact percentages are volatile — see the fetch
  spec.
- The classification.log file at repo root captures the results of a
  prior full run, but log-derived counts are point-in-time snapshots and
  should not be quoted as current.
- Human-QA'd mismatch files at repo root — `category_mismatches.csv`,
  `category_fixes_conservative.csv` — are audit artifacts, not applied
  state. Applying them is a separate operator step (see
  `etl/fix_categories_conservative.py`).

## Project classification: `secondary_category`

- TEXT column, added by migration `025_add_secondary_category.sql`.
- Concept: for projects whose top two Pass-2 scores are close, record the
  runner-up.
- **Coverage is minimal.** The current canonical classifier
  (`etl/classifier.py`) does not populate it; only archived consolidation
  scripts did. The column exists and is indexed (partial index where
  NOT NULL), but effectively unpopulated in production.
- Not a reliable filter. Treat as absent.

## Organization classification: `org_type`

Deterministic, keyword-based. Never uses an LLM.

### Values

Five: `company`, `university`, `hospital`, `research_institute`, `other`.

### Method

Python keyword rules in `etl/process_projects.py`, mirrored on the
frontend at `src/lib/classify-project.ts`. Priority order:

1. `UNIVERSITY`, ` UNIV `, `COLLEGE` → `university`
2. `HOSPITAL`, `MEDICAL CENTER`, `HEALTH SYSTEM`, `CHILDREN'S HOSPITAL` → `hospital`
3. `INSTITUTE`, ` INST ` → `research_institute`
4. SBIR/STTR activity codes (`R41`, `R42`, `R43`, `R44`, `SB1`, `U43`, `U44`) → `company`
5. Corporate suffixes (` INC`, ` LLC`, ` CORP`, ` LTD`) → `company`
6. Fallback → `other`

### Coverage

Every project has an `org_type` — the deterministic fallback to `other`
guarantees no NULLs. Coverage of *correct* org_type is a separate
question:

- The classifier misclassifies systematically at boundary cases: entities
  named "X UNIVERSITY MEDICAL CENTER" resolve to `university` when the
  operating unit is a hospital; independent institutes named like
  "LUNDQUIST INSTITUTE" resolve to `hospital` when they are research
  institutes.
- The audit file `org_type_mismatches.csv` at repo root catalogs known
  errors. The count of rows there is a **lower bound** on wrong assignments
  — only rows that failed a specific consistency check are listed.
- The 2026-02-15 fixup (`migrations/fix_org_type_universities.sql`)
  reclassified 2,379 records that had been marked `company` but were
  actually universities.
- **No confidence score is tracked for org_type.**

### Queryability

- B-tree index (`idx_projects_org_type`).
- Exposed as `filter_org_types TEXT[]` in `search_projects_filtered`.
- Exposed as multi-select filter chips in the front-end.

## Trial classification

### `phase` (ClinicalTrials.gov)

- VARCHAR(50), indexed.
- Values: `PHASE1`, `PHASE2`, `PHASE3`, `PHASE4`, `EARLY_PHASE1`, `NA`.
- Sourced verbatim from ClinicalTrials.gov; may be missing for older
  records.
- Queryable directly on the column; not currently a first-class filter in
  `search_projects_filtered`.

### `study_status`

- VARCHAR(50), not enum-constrained.
- Free text from ClinicalTrials.gov (`RECRUITING`, `ACTIVE, NOT RECRUITING`,
  `COMPLETED`, `TERMINATED`, `WITHDRAWN`, `SUSPENDED`, …).

### `is_diagnostic_trial`, `is_therapeutic_trial`

- Boolean flags, rule-based on title keywords.
- **Default-TRUE bias on `is_therapeutic_trial` was removed 2026-09-14.**
  The rule no longer defaults to TRUE on ambiguous titles; it emits NULL
  (or FALSE where FALSE is explicitly warranted). The upstream inflation
  it caused — ~68% of trials biased as "therapeutic" in older reports —
  is fixed.
- **Prefer `primary_purpose` (source-truth from CT.gov) for all
  downstream use.** The old classifier boolean is kept for backwards
  compatibility with pre-2026-09 records where `primary_purpose` may
  still be NULL, but every new report renders `primary_purpose` counts
  in its Executive Summary and prompt-level analysis.

### `primary_purpose` (source-truth, CT.gov)

- VARCHAR(50), added `20260914` (see [data-model.md](data-model.md)).
- Source: `protocolSection.designModule.designInfo.primaryPurpose`.
- Values: `TREATMENT`, `DIAGNOSTIC`, `PREVENTION`, `SUPPORTIVE_CARE`,
  `SCREENING`, `HEALTH_SERVICES_RESEARCH`, `BASIC_SCIENCE`,
  `DEVICE_FEASIBILITY`, `OTHER`, `ECT`.
- Coverage: ~90%+ on trials with an `api_raw_data` payload; NULL on
  older records where CT.gov didn't emit the field.
- **Displaces the classifier-boolean.** Executive Summary framing rule:
  "if you cite N therapeutic trials, use the TREATMENT count, not the
  legacy is_therapeutic_trial boolean" (enforced in the synthesis
  prompt).

### `lead_sponsor_class` (source-truth, CT.gov)

- VARCHAR(50), added `20260914`.
- Source: `protocolSection.sponsorCollaboratorsModule.leadSponsor.class`.
- Values: `INDUSTRY`, `NIH`, `FED`, `NETWORK`, `OTHER`, `INDIV`,
  `UNKNOWN`.
- Enables the industry-vs-academic split rendered in the new **Industry
  Engagement** report section (`renderIndustryEngagementSection`).

## Patent classification

### `is_device_patent`, `is_therapeutic_patent`, `is_method_patent`

- Boolean flags, rule-based on title keywords in `etl/process_patents.py`.
- 100% coverage.

### `patent_type`

- VARCHAR(50), populated from USPTO metadata via migration `20260302`.
- Sparsity UNVERIFIED.

### CPC codes

- Column `cpc_codes` TEXT[] exists in the patents table (added
  `20260302`).
- Sparsity UNVERIFIED — the column exists but population depends on the
  USPTO API pull path actually returning CPC arrays. No coverage stats
  available from the codebase alone.
- Not currently exposed as a filter in any search RPC or UI surface.

## Publication classification

### `is_methods_journal`, `is_therapeutic_journal`, `is_computational_journal`

- Boolean flags, rule-based on journal name/abbreviation.
- 100% coverage; but rule-based journal classification is coarse.

### MeSH terms

**Captured on both trials and publications (added 2026-09-14 and
2026-09-18 respectively).**

- `publications.mesh_terms TEXT[]` — MajorTopic descriptors from
  PubMed efetch. GIN indexed. ~62% coverage (317,565 rows) after the
  2026-09-18 backfill. Minor MeSH is intentionally NOT captured — too
  noisy for topic-match signal.
- `clinical_studies.condition_mesh TEXT[]` and `intervention_mesh
  TEXT[]` — CT.gov-derived MeSH from `derivedSection.conditionBrowseModule.meshes`
  and `derivedSection.interventionBrowseModule.meshes`. Both GIN indexed.
  ~90%+ coverage on trials with an `api_raw_data` payload.
- `topic_mesh_cache` table — Haiku-extracted MeSH from arbitrary topic
  strings, cached to avoid re-extracting on repeated topics.

Consumption:
- **Trials-agent Path 3 rescue.** Extracts topic MeSH via Haiku, adds
  trials whose `condition_mesh` or `intervention_mesh` overlaps the
  extracted terms as an additive rescue on top of the standard project-
  linkage and semantic-title paths.
- **Cross-source MeSH overlap** in the Executive Summary prompt. The
  synthesizer computes descriptors that appear on BOTH the surfaced
  trials AND the surfaced publications, then narrates alignment or
  disconnect (`formatPubTrialMeshOverlap` in `src/lib/reports/synthesize.ts`).
- **Projects-agent Path 2 rescue** — projects whose `spending_categories`
  RCDC tags overlap the extracted MeSH. Currently yields near-zero due
  to sparse `spending_categories` coverage (0.003%); reserved for after
  the historical RePORTER refill.

## Legacy classification fields

- `biotools_confidence`, `biotools_subcategory`, `biotools_signals`,
  `biotools_reasoning`, `biotools_high_confidence` materialized view.
  These reflect an earlier "is this a biotools project" scoring path that
  predates the current 9-value classifier. They remain in the schema and
  still influence one RPC parameter (`min_biotools_confidence`) but the
  primary_category enum has largely superseded them for downstream use.
- Category-specific confidence columns (`diagnostics_confidence`,
  `therapeutics_confidence`, `medical_device_confidence`,
  `digital_health_confidence`) are reserved but sparse; the current
  classifier only writes to `primary_category_confidence`.

## Classification as filter vs. stored output

| Taxonomy | Stored on record? | Queryable filter in a search RPC? | Filter in the UI? |
| --- | --- | --- | --- |
| `primary_category` | yes | yes (`search_projects_filtered`) | yes |
| `secondary_category` | column exists, sparse | no | no |
| `org_type` | yes | yes (`search_projects_filtered`) | yes |
| project `admin_ic` | yes (10% coverage) | yes (`search_projects_filtered.filter_admin_ics`, ext. 2026-09-18) | not yet |
| project `foa_number` | yes (10% coverage) | yes (`.filter_foa_numbers`, ext. 2026-09-18) | not yet |
| project `spending_categories` | column exists, 0.003% coverage | yes (`.filter_spending_categories`, ext. 2026-09-18) | not yet |
| trial `phase` | yes | no direct filter in the RPC | no direct filter chip |
| trial `study_status` | yes | no | no |
| trial `primary_purpose` | yes (~90%) | returned by `search_clinical_studies`; client-side chip toggle in Chat | yes (Chat chip: filter by TREATMENT/DIAGNOSTIC via `industry_sponsored`/`randomized`/`fda_regulated`/`has_dmc` — not `primary_purpose` directly) |
| trial `lead_sponsor_class` | yes | returned; client-side toggle "Industry-sponsored" | yes (Chat chip) |
| trial `allocation`, `masking`, `has_dmc` | yes | returned; client-side toggles "Randomized" and "DMC" | yes (Chat chips) |
| trial `is_fda_regulated_drug`, `is_fda_regulated_device` | yes | returned; client-side toggle "FDA-regulated" | yes (Chat chip) |
| trial diag/therap booleans | yes | no | no |
| trial `condition_mesh`, `intervention_mesh` | yes (~90%+) | not exposed as first-class filter; consumed via Path 3 rescue in report generation | no |
| patent booleans (device/therap/method) | yes | no | no |
| patent `cpc_codes` | column exists, sparse | no | no |
| publication booleans | yes | no | no |
| publication `mesh_terms` | yes (62% after 2026-09-18 backfill) | not exposed as first-class filter; consumed via Executive Summary cross-source overlap | no |

The gap between "stored" and "queryable" is important for GTM design —
see [targeting-surface.md](targeting-surface.md).
