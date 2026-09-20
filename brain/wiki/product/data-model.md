# Data model

Structural description of the granted.bio index. Durable facts only —
record counts, coverage percentages, and refresh timestamps are volatile
and specified in [/brain/skills/fetch-platform-facts.md](../../skills/fetch-platform-facts.md).

Source of truth: `supabase/migrations/*.sql` (57 files), `docs/02_DATABASE_SCHEMA.sql`
(consolidated but stale — see "Schema doc drift" below), and the ETL code in `etl/`.
When migrations and the consolidated doc disagree, migrations win.

## Core entities

Six core entities plus abstracts. All primary keys are UUIDs; every entity
also carries a natural key (`project_number`, `pmid`, `patent_id`, `nct_id`)
that is UNIQUE and drives cross-entity linkage.

### projects (NIH-funded grants)

Base table for the whole system. Every downstream entity links back through
`project_number`. Source: NIH RePORTER exports loaded via `etl/process_projects.py`.

| Column | Type | Populated |
| --- | --- | --- |
| `id` | UUID | always (PK) |
| `application_id` | VARCHAR(20) UNIQUE NOT NULL | always |
| `project_number` | VARCHAR(50) UNIQUE NOT NULL | always |
| `full_project_num` | VARCHAR(100) | usually |
| `activity_code` | VARCHAR(10) | usually — the NIH grant mechanism code (R01, R44, T32, etc.) |
| `funding_mechanism` | VARCHAR(100) | usually |
| `title` | TEXT NOT NULL | always |
| `terms` | TEXT | sparse — semicolon-separated keyword list, frequently NULL or empty |
| `phr` | TEXT | sparse — Public Health Relevance blurb |
| `org_name`, `org_city`, `org_state`, `org_country`, `org_zip` | VARCHAR | name/city/state usually; country/zip reserved but sparsely populated |
| `org_type` | VARCHAR(50) | classified (see [classification-state.md](classification-state.md)) |
| `total_cost` | DECIMAL(12,2) | usually |
| `award_date`, `project_start`, `project_end` | DATE | usually |
| `fiscal_year` | INT | usually — used as the rolling-window filter (see below) |
| `pi_names` | TEXT | usually — but delimited free text, not structured; see PI-linkage limits below |
| `funding_agency` | ENUM ('NIH','NSF','DOD','DOE','OTHER') DEFAULT 'NIH' | always |
| `is_bio_related` | BOOLEAN DEFAULT true | always |
| `is_supplement`, `supplement_number` | BOOLEAN / VARCHAR | flag for administrative supplements |
| `primary_category` | ENUM `bio_category` | classified — see [classification-state.md](classification-state.md) |
| `primary_category_confidence` | FLOAT [0,100] | populated when classified |
| `secondary_category` | TEXT | sparse; column exists but rarely populated |
| `biotools_confidence`, `biotools_subcategory`, `biotools_signals`, `biotools_reasoning` | | sparse legacy scoring fields |
| `abstract_embedding` | VECTOR(1536) | usually |
| `title_embedding`, `phr_embedding` | VECTOR(1536) | present in schema; UNVERIFIED whether currently populated |
| `import_id`, `created_at`, `updated_at` | | administrative |

**RePORTER audit fields (7 columns, added 2026-09-14).** Source-truth
enrichment from NIH RePORTER v2 API that was previously discarded at
ingest. Populated for projects synced after ~2026-08-05; coverage sits
at ~10% of the full projects table as of 2026-09-19 (grows with each
historical refill).

| Column | Type | Source |
| --- | --- | --- |
| `contact_pi_name` | TEXT | RePORTER `contact_pi_name` — the single Contact PI where `pi_names` blurs Contact vs Multi-PI vs listed personnel |
| `admin_ic` | VARCHAR(20) | `agency_ic_admin.abbreviation` — which NIH institute administers the grant (NCI, NIAID, NIMH, …) |
| `foa_number` | VARCHAR(50) | `foa_number` — the Funding Opportunity Announcement code, enables "clustered under a coordinated NIH call" signals in reports |
| `direct_cost_amt` | NUMERIC | `direct_cost_amt` — split from total |
| `indirect_cost_amt` | NUMERIC | `indirect_cost_amt` — split from total |
| `study_section` | VARCHAR(300) | `study_section` — the peer review panel that scored the grant |
| `spending_categories` | TEXT[] | NIH RCDC (Research, Condition, and Disease Categorization) topic tags — GIN indexed. **0.003% populated today**; source is a per-project RePORTER endpoint that requires a separate call, so backfill is expensive. Structurally reserved for the projects-agent Path 2 MeSH/RCDC rescue but rescue yields near zero until backfilled. |

Also on every project row: `api_raw_data` JSONB — the full RePORTER API
response, stored so any of the seven columns above can be re-extracted
without another API pull.

Related table `abstracts` holds the full abstract text keyed by
`application_id` (UNIQUE, ON DELETE CASCADE). Migration `20260309`
deduplicated ~16K duplicate abstract rows before adding the unique
constraint.

Vector indexes on projects:
- `abstract_embedding` — HNSW (migrated from IVFFLAT in `20260305` for
  recall/latency reasons; `ef_search = 200`)
- `title_embedding`, `phr_embedding` — IVFFLAT (lists=100). UNVERIFIED
  whether these are currently used by any query path.

### organizations

**No dedicated organizations table.** `org_name`, `org_city`, `org_state`,
`org_country`, `org_zip`, `org_type` live directly on the `projects` row.
Every "organization view" the product renders is a de-duplication of these
strings across the project set at query time (see
`aggregateOrganizations` in `src/lib/reports/`).

Implications:
- No canonical org ID. Case-fold + word-order dedup only.
- No org-level embedding. Similarity between orgs must be inferred from
  aggregated project vectors (not implemented).
- One-to-many by construction: an org is a set of project rows sharing a
  normalized `org_name`.

### researchers (principal investigators)

**No dedicated researchers table.** `projects.pi_names` is a delimited
text field (commas and/or semicolons). Every "researcher view" the product
renders is a split-and-dedup at query time (`aggregateResearchers`).

Implications:
- No canonical PI ID.
- **No role metadata.** Contact PI vs Multi-PI vs other listed personnel
  is not distinguishable in the field. The presentation layer takes the
  first name after splitting on `;` as the display PI — this is a
  heuristic, not ground truth.
- Funding is split evenly across co-PIs in `aggregateResearchers`. This is
  a downstream aggregation choice, not a source-truth attribution.

### patents (USPTO)

Enriched via `etl/process_patents.py` and (later) migration `20260302`
against a USPTO source.

| Column | Notes |
| --- | --- |
| `patent_id` UNIQUE NOT NULL | natural key |
| `patent_title`, `patent_abstract`, `patent_org`, `patent_type` | |
| `patent_date` DATE | issue date from USPTO (added `20260302`) |
| `filing_date`, `issue_date` | reserved earlier; UNVERIFIED whether currently populated distinct from `patent_date` |
| `assignees` TEXT[], `inventors` TEXT[], `cpc_codes` TEXT[] | added `20260302`; **sparsity UNVERIFIED** |
| `cited_by_count` INT | added `20260302` |
| `is_device_patent`, `is_therapeutic_patent`, `is_method_patent` | boolean flags (see [classification-state.md](classification-state.md)) |
| `patent_embedding` VECTOR(1536) | IVFFLAT index |
| `api_last_updated` | last USPTO API pull timestamp |
| `api_raw_data` JSONB | full USPTO API response stored on enrichment (2026-09 policy: always store the raw payload) |
| ODP columns (from `20260302`) | UNVERIFIED whether currently applied — the migration was written but not confirmed to have been run. Patent detail-page enrichment is **lazy-on-view via USPTO Open Data Portal** (`src/lib/patents/uspto-odp.ts`), not batch-backfilled. |

Note: `patents.project_number` was a column before migration `20260310`;
it was dropped and moved to the `project_patents` junction table. Any
older code that references `patents.project_number` is stale.

### clinical_studies (ClinicalTrials.gov)

Enriched via `etl/enrich_clinical_trials.py` and migration `20260301`.

| Column | Notes |
| --- | --- |
| `nct_id` VARCHAR(20) | ClinicalTrials.gov identifier |
| `project_number` VARCHAR(50) | link back to a project (many-to-many; see linkage section) |
| Composite UNIQUE `(nct_id, project_number)` | added `20260617` |
| `study_title`, `study_status`, `study_type`, `phase`, `lead_sponsor` | |
| `conditions` TEXT[], `interventions` JSONB | enriched fields |
| `enrollment_count`, `start_date`, `completion_date`, `eligibility_criteria`, `brief_summary` | enriched fields; sparsity UNVERIFIED |
| `is_diagnostic_trial`, `is_therapeutic_trial` | rule-based booleans; **`is_therapeutic_trial` default-TRUE bias removed 2026-09-14** — see `primary_purpose` below for the source-truth replacement |
| `study_embedding` VECTOR(1536) | HNSW index (migrated from IVFFLAT in `20260609`) |
| `api_last_updated`, `api_raw_data` JSONB | `api_raw_data` stores the full CT.gov v2 API response for later re-extraction without another API call |

**Trial-quality pack (14 columns, added 2026-09-14).** Source-truth
enrichment from CT.gov's `protocolSection.designModule`,
`sponsorCollaboratorsModule`, and `oversightModule`. Consumed by every
report's Executive Summary, Field Maturity, Industry Engagement section
(new), and trial detail page. Every column is re-extracted from
`api_raw_data`, so a bug in extraction can be corrected without another
API pull.

| Column | Type | Source |
| --- | --- | --- |
| `primary_purpose` | VARCHAR(50) | `designModule.designInfo.primaryPurpose` (TREATMENT / DIAGNOSTIC / PREVENTION / SUPPORTIVE_CARE / SCREENING / HEALTH_SERVICES_RESEARCH / BASIC_SCIENCE / DEVICE_FEASIBILITY / OTHER / ECT) |
| `lead_sponsor_class` | VARCHAR(50) | `sponsorCollaboratorsModule.leadSponsor.class` (INDUSTRY / NIH / FED / NETWORK / OTHER / …) |
| `allocation` | VARCHAR(50) | `designModule.designInfo.allocation` (RANDOMIZED / NON_RANDOMIZED / NA) |
| `masking` | VARCHAR(50) | `designModule.designInfo.maskingInfo.masking` (NONE / SINGLE / DOUBLE / TRIPLE / QUADRUPLE) |
| `has_dmc` | BOOLEAN | `oversightModule.oversightHasDmc` |
| `is_fda_regulated_drug` | BOOLEAN | `oversightModule.isFdaRegulatedDrug` |
| `is_fda_regulated_device` | BOOLEAN | `oversightModule.isFdaRegulatedDevice` |
| `why_stopped` | TEXT | `statusModule.whyStopped` — populated when a trial is Terminated / Suspended / Withdrawn |
| `condition_mesh` | TEXT[] | `derivedSection.conditionBrowseModule.meshes` (MeSH descriptor names) — GIN indexed |
| `intervention_mesh` | TEXT[] | `derivedSection.interventionBrowseModule.meshes` — GIN indexed |
| `collaborators` | JSONB | `sponsorCollaboratorsModule.collaborators[]` (name + class per collaborator) |
| `overall_officials` | JSONB | `contactsLocationsModule.overallOfficials[]` (name + affiliation + role) |
| `primary_outcomes` | JSONB | `outcomesModule.primaryOutcomes[]` |
| `secondary_outcomes` | JSONB | `outcomesModule.secondaryOutcomes[]` |

The `condition_mesh` and `intervention_mesh` columns power the **Path 3
MeSH-rescue** in the trials agent — trials that don't share a
`project_number` with any surfaced NIH project but whose condition or
intervention MeSH tags overlap the topic's extracted MeSH descriptors
are added as an additive rescue. On the 2026-09-19 radioligand cancer
therapy report, Path 3 added 193 trials on top of 280 (Path 1, NIH-linked)
+ 151 (Path 2, semantic title) — a ~+40% recall lift.

### publications (PubMed)

| Column | Notes |
| --- | --- |
| `pmid` VARCHAR(20) UNIQUE NOT NULL | natural key |
| `pub_title`, `journal_title`, `journal_abbr`, `pub_year`, `pub_date` | |
| `author_list`, `affiliation`, `pmc_id`, `issn` | sparsity varies; UNVERIFIED |
| `pi_email` VARCHAR(255) | added migration `013`; sparse — extracted from `affiliation` |
| `is_methods_journal`, `is_therapeutic_journal`, `is_computational_journal` | rule-based flags on journal name |
| `publication_embedding` VECTOR(1536) | IVFFLAT index |
| `mesh_terms` TEXT[] | **added `20260918_publications_mesh.sql`.** MajorTopic MeSH descriptors from PubMed efetch. GIN indexed. Backfilled 2026-09-18 via `etl/fetch_pubmed_mesh.py`; current coverage is ~62% of all publications (317,565 of ~512K as of ship day). Rows without an efetch response yet return NULL, not empty array. |
| `api_raw_data` JSONB | full PubMed esummary + efetch response for later re-extraction |

**MeSH now populated.** Prior to 2026-09-18, publication MeSH was
absent. The backfill script pulls `MedlineCitation.MeshHeadingList` from
PubMed efetch XML and captures only the `MajorTopic="Y"` descriptors —
minor MeSH is noisier (most articles carry 10-20 minors covering
background material) and would dilute the topic-match signal.

## Linkage tables

All cross-entity links are **direct foreign keys**. No probabilistic
matching, no confidence scores on any link row.

| Junction | Columns | Grain | Notes |
| --- | --- | --- | --- |
| `project_publications` | `(project_number, pmid)` composite PK | many-to-many | ETL-loaded from NIH RePORTER's project-to-publication linkage file |
| `project_patents` | `(project_number, patent_id)` composite PK | many-to-many | Added `20260310`; backfilled from the earlier `patents.project_number` column |
| `clinical_studies` | `(nct_id, project_number)` composite unique | many-to-many | The trials table is itself the junction — one row per trial-per-project link |

There is no `project_researchers` or `project_organizations` junction —
those relationships are string-embedded on the `projects` row (`pi_names`,
`org_name`) and aggregated at query time.

### Linkage confidence

Every link is direct FK, so schema-level confidence is 100%. Real-world
confidence, however, is bounded by the completeness of the upstream
linkage feeds:

- Project ↔ patent links rely on NIH-acknowledged patents (the applicant
  cited the grant number). Commercial patents that don't cite NIH funding
  are absent.
- Project ↔ trial links rely on the CT.gov record naming the NIH grant.
  Industry-sponsored trials without a linked federal grant are absent.
- Project ↔ publication links rely on PubMed's grant-linkage field.

See [limits.md](limits.md) for the buyer-facing consequences.

## Semantic search surface

Semantic search runs against per-record 1536-dim vectors from OpenAI's
`text-embedding-3-small` (schema comments in `docs/02_DATABASE_SCHEMA.sql:602`
confirm the model; no other embedding model is referenced in the codebase).

Vector-indexed columns:

| Table | Column | Index type | Notes |
| --- | --- | --- | --- |
| `projects` | `abstract_embedding` | HNSW (ef_search=200) | primary field for topic search |
| `projects` | `title_embedding` | IVFFLAT (lists=100) | UNVERIFIED whether queried |
| `projects` | `phr_embedding` | IVFFLAT (lists=100) | UNVERIFIED whether queried |
| `clinical_studies` | `study_embedding` | HNSW (ef_search=200) | trial semantic search |
| `patents` | `patent_embedding` | IVFFLAT (lists=100) | patent semantic search |
| `publications` | `publication_embedding` | IVFFLAT (lists=100) | publication semantic search |

Search RPCs (defined as Postgres functions):
- `search_projects(query_embedding, match_threshold, match_count, min_biotools_confidence)`
- `search_projects_filtered(query_embedding, ..., filter_fiscal_years, filter_categories, filter_org_types, filter_states, filter_min_funding, filter_max_funding, filter_admin_ics, filter_foa_numbers, filter_spending_categories)` — this is the RPC that carries structured filter capability. Extended `20260918` to accept the RePORTER-audit-field filter parameters. Also returns the seven audit fields on every row for downstream client-side filtering.
- `search_clinical_studies(query_embedding, match_threshold, match_count)` — extended `20260918` to return trial-quality pack fields (`primary_purpose`, `lead_sponsor_class`, `allocation`, `masking`, `has_dmc`, `is_fda_regulated_drug`, `is_fda_regulated_device`, `condition_mesh`, `intervention_mesh`) on every row. Chat surface uses these for client-side filter chip toggles.
- `search_patents(query_embedding, match_threshold, match_count)`
- `keyword_search(search_keyword, category_filter, org_type_filter, state_filter, min_funding_filter, result_limit)` — ILIKE on `abstracts.abstract_text` (no trigram index in production; see comment in migration `018`)

There is **no** `search_publications` vector RPC in the migration set. Publications appear to be retrieved via joins from projects, not via direct semantic search. UNVERIFIED whether an app-layer wrapper does client-side vector similarity.

## Time coverage and the rolling window

- `projects.fiscal_year` is the anchoring time field. It is populated for
  ~all projects.
- The **rolling window is enforced in application code, not in the
  database.** Multiple API routes hard-code `MIN_FISCAL_YEAR` and apply
  `.gte('fiscal_year', MIN_FISCAL_YEAR)` — verified at
  `src/app/api/org/[name]/route.ts:52`. Value is **2024** as of the
  reconnaissance date.
- No trigger, no CHECK constraint, no partitioning, no scheduled deletion.
  Older records remain in the DB, invisible to the product surface but
  present.
- The retention rule (current fiscal year + 2 prior years, window shifts
  every Sep 30 FY close) is documented in
  [docs/DATA_PIPELINE_PLAN.md](../../../docs/DATA_PIPELINE_PLAN.md) but
  the enforcement mechanism today is the hard-coded `MIN_FISCAL_YEAR`
  constant — it must be bumped by hand on each FY roll.
- Trial dates (`start_date`, `completion_date`), patent `patent_date`, and
  publication `pub_year` are **not filtered by the rolling window**. A
  patent from 2015 linked to a 2024 project will still be returned.

## Other tables (user, billing, sharing, admin)

Not part of the intelligence index but present in the same DB:

- `user_profiles` — email, tier, role, Stripe IDs, beta and platform-pass
  expiry timestamps.
- `report_purchases` — Stripe payment audit trail.
- `report_credits` — credit ledger (`generation`, `refresh`, `retry`
  credit types) with granted/consumed/expires timestamps and bindings to
  the report the credit was spent on.
- `user_reports` — generated analyses; JSONB fields for `funding_stats`,
  `projects`, `clinical_trials`, `patents`, `publications`,
  `top_organizations`, `top_researchers`, `all_projects`,
  `all_organizations`, `all_researchers`, plus `markdown_content`,
  `agent_outputs`, and an `is_public_sample` flag that grants anon read
  access when TRUE (admin-set).
- `analysis_shares` — tokenized share links (`token`, `expires_at`,
  `revoked_at`, `view_count`).
- `share_views` — per-view rows with `viewer_hash` = HMAC(secret, ip::ua),
  never storing raw IP/UA.
- `share_rate_limits` — table-backed rate limiter (20/min per IP on token
  resolution).
- `saved_projects`, `saved_trials`, `saved_people` — user bookmarks; store
  the natural key (application_id, nct_id) or free-text name only.
- `topic_mesh_cache` — added `20260918`. Cached MeSH descriptor
  extraction from arbitrary topic strings. Keyed on
  `topic_normalized` (case-fold + whitespace-collapse of the raw
  topic); columns `condition_mesh TEXT[]`, `intervention_mesh TEXT[]`,
  `extractor_version INT`, `extracted_at`. Used by the trials-agent Path
  3 rescue and the projects-agent Path 2 rescue to avoid a Haiku call on
  a repeated topic. Extractor is Claude Haiku 4.5 via
  `src/lib/search/mesh-extraction.ts` using Anthropic tool_use for
  guaranteed-valid JSON output.
- `data_imports`, `processing_jobs`, `etl_jobs` — ETL run history.
- `category_corrections` — audit trail of human review of borderline
  classifications.
- `api_usage` — per-user token/cost tracking for Anthropic calls.
- `beta_invites` — admin-managed allowlist.

## Enums in use

- `funding_agency`: `NIH`, `NSF`, `DOD`, `DOE`, `OTHER`
- `bio_category`: eleven values in the Postgres enum — see
  [classification-state.md](classification-state.md) for the current
  classifier's usage of them.
- `confidence_level`: `HIGH`, `MODERATE`, `LOW` — defined but lightly used
  in core tables.
- `job_status`: `queued`, `processing`, `completed`, `failed`
- `user_tier`: `free`, `basic`, `advanced`, `unlimited`, `beta`

## Schema doc drift

`docs/02_DATABASE_SCHEMA.sql` is dated 2026-01-25 and does NOT reflect
migrations added since. Columns missing from the consolidated doc include
`all_projects`, `all_organizations`, `all_researchers`, `is_public_sample`,
`sender_display_name`, `interpretation`, `recovery_attempts`,
`platform_pass_expires_at`, `beta_claimed_at`, `beta_expires_at`, and
several trial/patent enrichment fields. When answering questions about
schema, read migrations, not the consolidated file.
