# Targeting surface

What GTM can query today for identifying and characterizing companies.
This defines what outreach targeting is buildable on the current index.

Every claim below carries the field or SQL that supports it. Where the
answer is NO or PARTIAL, the reason is stated.

Note on scope: "the full index" means all `projects` rows that pass the
application-side rolling-window filter (currently `fiscal_year >= 2024`,
hardcoded at multiple API routes). Historical rows exist in the DB but
are invisible to the product surface.

## Answers to the core targeting questions

### 1. Can small businesses be isolated from universities and institutes today, across the full index?

**YES.**

- Field: `projects.org_type` — five values: `company`, `university`,
  `hospital`, `research_institute`, `other`.
- Populated for every project (deterministic fallback to `other`
  guarantees no NULLs). Wrong assignments exist at boundary cases (see
  [classification-state.md](classification-state.md)) but "isolate
  companies" is the direction most robust against those errors — the
  rules routing to `company` (SBIR/STTR activity codes, corporate name
  suffixes) are precise; false positives into `company` from a
  university with `INC` in its name are rare.
- Exposed as `filter_org_types TEXT[]` in
  `search_projects_filtered` (`supabase/migrations/022_improve_vector_search_recall.sql`).
- Also `keyword_search` accepts `org_type_filter TEXT[]`
  (`supabase/migrations/018_keyword_search_function.sql`).
- Front-end filter chip present at `src/components/FilterChips.tsx`.

To isolate companies: `filter_org_types = ARRAY['company']`.

### 2. Is SBIR/STTR identifiable? Is award phase (I vs II) available?

**PARTIAL — must be parsed from `activity_code`, not a first-class field.**

- No `is_sbir` or `is_sttr` column.
- Identification: `projects.activity_code IN ('R41','R42','R43','R44','SB1','U44')`
  (canonical set from `etl/export_active_sbir.py:22`; note that
  `etl/process_projects.py`'s org-type rules also route `U43` to
  `company` as an SBIR-adjacent code).
- Phase parsing (client-side heuristic in `src/components/Chat.tsx:110-121`):
  - Phase I: `R41`, `R43`, `SB1`
  - Phase II: `R42`, `R44`, `U44`
- **Not a database column.** Any GTM query that needs SBIR/STTR + phase
  either builds the case expression in SQL or filters client-side after
  fetch.
- UI has an `sbirSttrOnly` quick-filter toggle at
  `src/components/FilterChips.tsx:249`.

### 3. Can award size, award date, and mechanism be filtered together?

**YES.**

`search_projects_filtered` in
`supabase/migrations/022_improve_vector_search_recall.sql` accepts:
- `filter_min_funding NUMERIC`, `filter_max_funding NUMERIC` — filters
  on `projects.total_cost`.
- `filter_fiscal_years INT[]` — filters on `projects.fiscal_year`.

Additional coverage in the projects table:
- `award_date DATE` — indexed (`idx_projects_award_date` DESC NULLS
  LAST), but **not a first-class filter parameter** of the RPC. Direct
  SQL can filter on it; going through the search RPC cannot.
- `funding_mechanism VARCHAR(100)` — indexed
  (`idx_projects_funding_mechanism`) but **not a first-class filter
  parameter** of the RPC. Direct SQL can filter; the RPC cannot.

All three concepts (size, date, mechanism) are on the projects table —
no joins required. The gap is between "what the column supports" and
"what the search RPC exposes as a parameter".

### 4. Are organization name, location, and size available?

**PARTIAL — name and location YES, size NO.**

Available:
- `org_name` VARCHAR(500)
- `org_city` VARCHAR(100)
- `org_state` VARCHAR(10) — indexed and exposed as `filter_states TEXT[]`
- `org_country` VARCHAR(50) — reserved; sparsely populated
- `org_zip` VARCHAR(20) — reserved; sparsely populated

**Source: NIH RePORTER grant records only.** The system has no
Crunchbase / LinkedIn / G2 / OpenCorporates enrichment.

Not available:
- Employee count / headcount.
- Revenue.
- Company stage (seed / Series A / …).
- Public vs private.
- Metro-area grouping (only state — no MSA rollup).

`org_type` distinguishes "company" from "university" but does NOT encode
company size or stage.

### 5. Are PI names linked to organizations, and is the PI distinguishable from other listed personnel?

**Linked YES; role distinguishable NO.**

- `projects.pi_names` is a delimited free-text string on the project row
  (commas and/or semicolons).
- Every project has both `pi_names` and `org_name`, so PI → org is
  implicit through the project. But there is **no dedicated researchers
  table** and **no PI-organization junction table** — every aggregation
  is a query-time split-and-dedup.
- **No role field.** Contact PI vs Multi-PI vs Co-Investigator vs Program
  Officer is not distinguishable in the field. The UI takes the first
  segment after splitting on `;` as the "primary" PI for display — this
  is a presentation heuristic, not source truth.
- The `PIProfile` type at `src/lib/chat/types.ts:192-199` exposes
  `pi_name`, `organizations`, `total_funding`, `project_count`,
  `publication_count`, `projects` — no role field.

### 6. Can a company be characterized by its patent, trial, and publication presence?

**YES — via project aggregation, with linkage caveats.**

Linkage chain: `projects.org_name` (dedup) → `project_number`s → junction
tables → child records.

- Patents: via `project_patents` junction (added `20260310`).
- Publications: via `project_publications` junction.
- Trials: via `clinical_studies.project_number` (many-to-many, composite
  unique with `nct_id`).

The org-profile endpoint (`/api/org/[name]/route.ts`) implements the
aggregation: parallel patent/publication/trial counts for the org's
project set, deduplicated by core project number (handles supplements
and continuation grants like `1R44MH136894-01` and `5R44MH136894-02` as
the same underlying project).

**All linkages are direct foreign keys — no probabilistic matching, no
confidence scores on the join.** Real-world confidence is bounded by
the upstream feeds: only patents/trials/pubs that acknowledge an NIH
grant number are captured. Industry-sponsored trials without NIH
linkage and patents that don't cite NIH funding are invisible.

### 7. Can a set of example organizations be profiled and similar organizations returned?

**NO — not by any built mechanism.**

- No `org_embedding` column exists on the projects table or elsewhere.
- No org-similarity RPC.
- Similarity is a **project-level** primitive only (via
  `abstract_embedding` HNSW index).
- Buildable, not built. Approaches would be: (a) average an org's
  project embeddings and index the result; (b) query-time compute an
  "org vector" from the org's top-N project vectors and rank other orgs
  by aggregate similarity. Neither is implemented.

## What became filterable 2026-09-14 to 2026-09-20

The audit-cycle ships added several new dimensions the search + chat
surfaces now support. All are source-truth (not classifier-derived).

### 8. Trial-quality dimensions (chat surface, 2026-09-18)

**YES — client-side chip toggles + Sonnet tool-schema filters in
searchTrials.**

`search_clinical_studies` now returns the trial-quality pack on every
row (extended via `20260918_extend_search_rpcs.sql`), so Chat can
compute chip counts and apply toggle filters without extra queries.

Available filters:
- **Industry-sponsored** (`lead_sponsor_class === 'INDUSTRY'`)
- **Randomized** (`allocation === 'RANDOMIZED'`)
- **FDA-regulated** (`is_fda_regulated_drug === true || is_fda_regulated_device === true`)
- **DMC** (`has_dmc === true`) — added 2026-09-20

Contact-PI, admin_ic, spending_categories and FOA number are on every
project row returned by `search_projects_filtered` as well, though no
UI chip surfaces them yet.

Sonnet natural-language surface (`src/lib/chat/tools.ts`) documents
all four booleans in its tool schema — a chat query like "industry-
sponsored randomized trials with a DMC" compiles to the structured
filters.

### 9. Contact PI vs Multi-PI

**PARTIAL — the Contact PI is now a distinct field (`contact_pi_name`)
on the projects table (added 2026-09-14). Coverage is ~10% today
(populated on rows synced after ~2026-08-05).**

- `pi_names` (delimited free text) remains the historical field.
- `contact_pi_name` is the single Contact PI extracted from RePORTER
  directly — no more heuristic split.
- When both are present, `contact_pi_name` is authoritative.
- Coverage grows with the historical RePORTER refill.

### 10. Which NIH institute administers a grant

**YES — as of 2026-09-14 via `projects.admin_ic` (10% coverage today).**

- Source: RePORTER `agency_ic_admin.abbreviation` (NCI, NIAID, NIMH, …).
- Exposed as `filter_admin_ics TEXT[]` in `search_projects_filtered`
  since 2026-09-18.
- Consumed narratively in the Executive Summary
  (`formatAdminIcSplitForPrompt` — cites concentration when one IC
  administers ≥40% of surfaced grants).

### 11. FOA / RFA / PAR clustering

**YES — via `projects.foa_number` (10% coverage today).**

- Source: RePORTER `foa_number`.
- Exposed as `filter_foa_numbers TEXT[]` in `search_projects_filtered`.
- Executive Summary surfaces FOAs that appear on ≥3 surfaced grants
  (`formatFoaClusteringForPrompt`).

### 12. MeSH-based topic matching

**PARTIAL — on trials (via Path 3 rescue) and publications (in
Executive Summary), NOT as a first-class filter.**

- `clinical_studies.condition_mesh` and `intervention_mesh` (~90%+
  coverage) power the Path 3 MeSH-rescue in the trials agent —
  additive trial retrieval on top of project-linkage and semantic
  title match.
- `publications.mesh_terms` (62% coverage after 2026-09-18 backfill)
  is consumed by the Executive Summary via `formatPubMeshForPrompt`
  (top pub descriptors + coverage) and `formatPubTrialMeshOverlap`
  (descriptors appearing on both trials and pubs).
- **No first-class MeSH filter is exposed in search RPCs or chat.**
  Structural work; a "filter by MeSH descriptor" chip is a next-ship.

## Things a reasonable person might assume are filterable but are NOT

1. **Venture funding / private capital.** No Series A/B/C, no seed, no
   investor names, no round amounts, no valuations. Total_cost is NIH
   award only.
2. **Company stage or age.** `org_type` says "company"; it does not say
   "seed-stage" vs "publicly traded pharma".
3. **Headcount growth or hiring signals.** No LinkedIn or news
   integration.
4. **Recent product launches or FDA approvals.** No launch-date tracking;
   inferable at best from patent/trial recency.
5. **PR / news mentions.** No news feed.
6. **PI role beyond Contact PI.** `contact_pi_name` (added 2026-09-14)
   distinguishes the Contact PI on ~10% of projects. Multi-PI vs
   Co-Investigator vs Program Officer distinctions remain absent.
7. **CPC / IPC code filtering** on patents. `patents.cpc_codes` TEXT[]
   exists but sparsity is UNVERIFIED and no filter surface exposes it.
8. **Metro area / MSA.** State is the finest geo cut.
9. **Trial phase as a first-class filter of `search_projects_filtered`.**
    `clinical_studies.phase` exists and is indexed, but is not a
    parameter of the projects-search RPC.
10. **Funding mechanism as a first-class RPC filter.** Column exists,
    indexed; RPC does not expose it. Direct SQL works.
11. **Award date as a first-class RPC filter.** Column exists, indexed;
    RPC exposes fiscal year, not award date.
12. **Industry-only patents / trials.** If the patent or trial isn't
    linked to an NIH project, it's not in the index at all.
13. **MeSH descriptor filtering as a first-class dimension.** Consumed
    inside report generation and available as raw columns; no user-
    facing filter chip exists yet.

## What the surface actually supports for GTM lists

The reliable, no-caveats company-targeting query today is:

- `org_type = 'company'`
- optional: `activity_code IN (SBIR/STTR set)` for federally-funded early
  stage
- optional: `filter_fiscal_years INT[]` for recency
- optional: `filter_min_funding` / `filter_max_funding` for award-size
  bracket
- optional: `filter_states TEXT[]` for geography
- optional: `filter_categories TEXT[]` for taxonomy bucket
- optional: `query_embedding` for topical rerank

Anything beyond that — company size, funding round, similar-orgs
retrieval, role-based PI outreach, industry-only IP — is not present in
the index and would require external enrichment.
