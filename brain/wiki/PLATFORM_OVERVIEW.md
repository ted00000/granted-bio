# granted.bio — Platform Overview

Single-file snapshot for use in Claude conversations outside Claude Code.
Self-contained enough that another Claude can answer platform-level
questions without needing to touch the repo. Detailed decompositions
live in the sibling files:

- [product/data-model.md](product/data-model.md) — every table, every column
- [product/classification-state.md](product/classification-state.md) — taxonomies and their coverage
- [product/analysis-structure.md](product/analysis-structure.md) — report generation, sections, gates
- [product/targeting-surface.md](product/targeting-surface.md) — what GTM can query today
- [product/limits.md](product/limits.md) — durable "we don't know that" list
- [../skills/fetch-platform-facts.md](../skills/fetch-platform-facts.md) — how to fetch volatile facts (counts, coverage %, refresh dates)

**Last updated: 2026-09-20** — post the audit-cycle + Phase-5→Phase-4
merge ships.

## What granted.bio is

A life-sciences research intelligence platform. Users type a research
topic (e.g., "radioligand cancer therapy", "liquid biopsy for early
cancer detection") and get a topic-level intelligence report that
synthesizes NIH-funded research, its associated clinical trials,
patents, and publications, plus live market context — into one written
analysis (100-125K chars, ~20 sections) they can read, share, and
regenerate.

Primary user segments (priority order, locked):
1. **Researchers** — mapping the funded landscape for a topic, sanity-
   checking their positioning, drafting grants
2. **Investors** — sizing the NIH-linked pipeline for a therapeutic
   area, cross-checking founder pitches
3. **BD / commercial** — surfacing collaboration surface area
   (uncorked 2026-08-11)

## Stack

- **Next.js 15 App Router** on Vercel (Fluid Compute, 900s maxDuration
  on the Inngest webhook route)
- **Supabase Postgres** with pgvector — HNSW indexes on projects and
  trials, IVFFLAT elsewhere
- **Inngest** for background report generation — one function, one
  event (`report.generate.requested`), four steps (post the 2026-09-20
  Phase-5-merge; see below)
- **Anthropic Claude** — Sonnet 4.6 for synthesis, Haiku 4.5 for
  cheap classification + MeSH extraction, Opus 4.8 for post-synthesis
  audit
- **OpenAI text-embedding-3-small** — 1536-dim vectors for all
  semantic search
- **Stripe** for billing — pricing is `$199 = one included analysis +
  3-month platform pass, reset on each purchase`. Site is live and
  taking real payments (`www.granted.bio`).

## Core data model (structural)

Six core entities, plus abstracts and enrichment tables. Every entity
has a natural key (`project_number`, `pmid`, `patent_id`, `nct_id`) that
is UNIQUE and drives cross-entity linkage. All cross-entity links are
direct FK joins on natural keys — no probabilistic matching.

- **projects** (NIH RePORTER grants) — the base table. Every downstream
  entity links back through `project_number`. ~200K rows total, ~50K
  after the app-side `fiscal_year >= 2024` rolling-window filter.
- **clinical_studies** (ClinicalTrials.gov) — many-to-many with projects
  via composite `(nct_id, project_number)`. HNSW index on
  `study_embedding`.
- **patents** (USPTO) — linked via `project_patents` junction. IVFFLAT
  index on `patent_embedding`. Detail-page enrichment is lazy-on-view
  via USPTO Open Data Portal.
- **publications** (PubMed) — linked via `project_publications`
  junction. IVFFLAT index on `publication_embedding`. **`mesh_terms`
  TEXT[]** populated on 62% of rows as of the 2026-09-18 backfill.
- **organizations** — no dedicated table. Every "org view" is a de-dup
  of `projects.org_name` at query time.
- **researchers** — no dedicated table. `pi_names` is delimited free
  text; every "researcher view" is a split-and-dedup at query time.
  `contact_pi_name` (added 2026-09-14, ~10% coverage) is the source-
  truth Contact PI for the ~10% of projects with recent RePORTER pulls.

Every enriched entity also carries `api_raw_data` JSONB (2026-09
policy: always store the full API response so any column can be
re-extracted without another API pull).

### Trial-quality pack (14 columns, added 2026-09-14)

Source-truth capture from CT.gov's `designModule`,
`sponsorCollaboratorsModule`, `oversightModule`, `derivedSection`, and
`outcomesModule`. Every column is used narratively by the Executive
Summary and rendered on the trial detail page.

- `primary_purpose`, `lead_sponsor_class`, `allocation`, `masking`,
  `has_dmc`, `is_fda_regulated_drug`, `is_fda_regulated_device`,
  `why_stopped`
- `condition_mesh TEXT[]`, `intervention_mesh TEXT[]` (both GIN
  indexed — power the Path 3 MeSH-rescue)
- `collaborators`, `overall_officials`, `primary_outcomes`,
  `secondary_outcomes` (JSONB structured fields)

**~90% coverage** on trials with an `api_raw_data` row.

### RePORTER project audit fields (7 columns, added 2026-09-14)

Source-truth capture from the RePORTER v2 API. `contact_pi_name`,
`admin_ic`, `foa_number`, `direct_cost_amt`, `indirect_cost_amt`,
`study_section`, `spending_categories TEXT[]`.

**~10% coverage** today — populated only on projects synced after
~2026-08-05. Historical RePORTER refill grows this over time.
`spending_categories` sits at 0.003% (6 rows); reserved for after the
NIH RCDC per-project endpoint is systematically pulled.

### Classification state

- `projects.primary_category` — 11-value enum, 9 emitted by current
  classifier (Haiku 4.5 batched, ~95% Pass-1 activity-code deterministic +
  Pass-2 LLM). Coverage high; residual sits in `other`.
- `projects.org_type` — deterministic keyword routing. Boundary cases
  wrong (universities vs medical centers).
- Trial `is_therapeutic_trial` **no longer defaults TRUE** as of
  2026-09-14. Downstream analysis uses `primary_purpose` (source-truth).
- Patent booleans (`is_device_patent`, `is_therapeutic_patent`,
  `is_method_patent`) — keyword-based, 100% coverage, coarse.
- MeSH — captured on both trials (2026-09-14) and publications
  (2026-09-18). Not exposed as a first-class filter yet.

## Report generation architecture

`POST /api/reports` writes a `status='generating'` row and enqueues
`report.generate.requested`. Inngest function runs **four phases**
(down from five as of 2026-09-20):

1. **Phase 1 — Projects agent.** Semantic search (Path 1) + MeSH/RCDC
   rescue (Path 2, near-zero yield today). Returns the topic-relevant
   project set.
2. **Phase 2 — Data agents in parallel.**
   - Trials agent: Path 1 (project-linked) + Path 2 (semantic title) +
     Path 3 MeSH rescue. Path 3 adds ~30-40% more trials on broad topics.
   - Patents, publications, market (Sonnet + `web_search`) — parallel.
3. **Phase 3 — Aggregation** (deterministic, no LLM). Funding stats,
   org/researcher rollup.
4. **Phase 4 — Synthesis + persist.** ~9 Sonnet calls in parallel,
   lint retry, Opus audit-agent, post-audit lint retry #2, completeness
   gate, then inline DB write. Returns `{ ok: true }` — a tiny payload
   so Inngest's step checkpoint stays trivial.

**Architecture note (2026-09-20).** Phase 5 was a separate persist step
that received `{ reportData, agentOutputs }` from Phase 4. On broad
topics like cancer, that payload exceeded Inngest's ~4 MB step-state
cap, triggering "error validating generator opcode" at the boundary.
Inngest retried the whole synthesis 3× (~30-45 min, 2-3× LLM cost) before
giving up. Merging save into Phase 4 keeps the multi-megabyte object out
of Inngest's checkpoint. See commit `7dec07a`.

### Report sections (in order)

- How to Use This Report (static)
- What This Report Does Not Cover (static, persona-tuned)
- **Executive Summary** — 3 paragraphs, ~250 words. Now consumes:
  trial-quality pack (primary_purpose split, sponsor mix, rigor
  evidence), RePORTER audit fields (admin_ic split, FOA clustering,
  spending categories), publication MeSH (top descriptors + coverage),
  cross-source MeSH overlap.
- What Surprised Us — algorithmic anomaly detection, Sonnet narrates.
- Field Maturity Assessment — TRL estimate + historical benchmark.
- Competitive Topology — 3-5 methodological clusters.
- **Industry Engagement** (new, added 2026-09-14) — deterministic block
  from `renderIndustryEngagementSection`. Industry-lead / academic-
  with-collaborator / academic-only breakdown, names sponsors.
- White Space Analysis — topic-adaptive taxonomy + broader-NIH gap
  detection. **The central positioning claim.**
- Research Positioning (researcher) OR Investment Signals (investor)
- NIH Funding Landscape (researcher) / NIH Funding Analysis (investor)
- Key Research Projects — table + top-10 project cards
- Market Context — live web-search (Sonnet + `web_search` tool)
- Clinical Development Pipeline — includes
  `renderTerminatedTrialsCallout` when trials carry `why_stopped`.
- Patent Activity / IP Landscape
- Key Publications — curated selection with quotes
- Key Organizations, Key Researchers — deterministic rollups
- Next Steps — 6-8 action items, banned from naming PIs/institutions
- About This Report

### Post-synthesis gates

1. Regex lint (deterministic)
2. Sonnet lint retry #1 (≤ 240s budget)
3. Opus audit-agent (currently ON, ~$0.83/report)
4. Sonnet lint retry #2 (post-audit)
5. Completeness gate — throws if any section is thin/missing

If any gate throws → Inngest retry → up to 2 retries → `status='failed'`
and auto-granted retry credit.

## Targeting surface (what GTM can query today)

**YES:**
- `org_type = 'company'` — isolate small businesses
- SBIR/STTR — parseable from `activity_code` (R41-R44, SB1, U43/44)
- Award size, fiscal year, category, state — filterable via
  `search_projects_filtered`
- Since 2026-09-18: **industry-sponsored / randomized / FDA-regulated /
  DMC** as trial filter chips in Chat (source-truth from CT.gov)
- Since 2026-09-14: `admin_ic`, `foa_number`, `spending_categories`
  filters on `search_projects_filtered` (low coverage, growing)
- Cross-source MeSH signal in every Executive Summary (trials pipeline
  vs publication base convergence/divergence)

**PARTIAL:**
- Contact PI — `contact_pi_name` on ~10% of projects; `pi_names`
  (delimited free text) elsewhere
- MeSH-based topic retrieval — augmentation inside reports; no
  standalone filter yet

**NO:**
- Venture funding, private capital, company stage/size
- Headcount, revenue, valuation
- News, PR, hiring signals
- Industry-only patents/trials that don't cite an NIH grant
- Similar-organizations retrieval (no org-level embedding)

## Durable limits (never claim beyond these)

- Funding = NIH award dollars only. No VC, PE, non-NIH federal, EU/UKRI.
- Time coverage: `fiscal_year >= 2024`, hardcoded app-side. Rolling
  window shifts each Sep 30 FY close (bump-by-hand policy today).
- Linkage confidence: schema is 100% (direct FK) but real-world coverage
  is bounded by upstream feeds — commercial patents that don't cite NIH
  are invisible, industry-only trials are invisible, unattributed pubs
  are invisible.
- No canonical org table, no canonical researcher table. Both are
  query-time aggregations.
- Market Context is live web-search — as fresh as the web that moment,
  not from the granted.bio index.

## Recent significant ships (2026-09-14 → 2026-09-20)

- **2026-09-14**: Removed `is_therapeutic_trial` default-TRUE bias.
  Added trial-quality pack (14 columns). Added RePORTER project audit
  fields (7 columns). Added condition_mesh/intervention_mesh with GIN
  indexes.
- **2026-09-18**: Extended `search_projects_filtered` and
  `search_clinical_studies` RPCs to expose the new filters and return
  the new columns on every row. Added `topic_mesh_cache` table for
  Haiku-extracted topic MeSH. Backfilled `publications.mesh_terms`
  (317,565 rows, ~62% coverage, ~10 min via `etl/fetch_pubmed_mesh.py`).
  Extended trials agent with Path 3 MeSH rescue. Chat filter chips for
  industry / randomized / FDA-regulated added.
- **2026-09-19**: Fixed the completeness-gate 45-min retry loop —
  `generateSectionInsights` migrated from raw text→JSON regex parsing to
  Anthropic tool_use (`generateStructured`).
- **2026-09-20**:
  - Merged Phase 5 (persist) into Phase 4 (synthesis) — eliminated the
    "generator opcode" step-state size failure on broad topics.
  - Wired PubMed MeSH end-to-end: publications agent selects and
    aggregates, Executive Summary consumes via `formatPubMeshForPrompt`
    and cross-source overlap via `formatPubTrialMeshOverlap`.
  - Added DMC chip to Chat trial filters.

## Performance snapshot (2026-09-20)

- Reference report: radioligand cancer therapy, researcher persona.
- **7 min 11 sec** wall time — down from 12 min pre-audit-cycle, and
  from 30-45 min during the payload-size failure window on 2026-09-18.
- 119 projects, 511 trials (Path 1: 280, Path 2: 151, Path 3 rescue: +193),
  636 publications (39% carrying MeSH descriptors), 153 patents.
- ~122K char markdown output. 1× report cost (no Inngest retry loop).

## Pricing model

- $199 per report + 3-month platform pass reset on each purchase.
- Beta users: 3-report lifetime cap.
- Admin bypass with shadow credit ledger row for audit.
- `report_credits` ledger tracks `generation`, `refresh`, `retry` credit
  types with granted/consumed/expires timestamps.
- Stripe live in production; test keys remain in Preview/Development.
