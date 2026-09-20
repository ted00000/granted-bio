# Limits

What the platform cannot do or does not know. Prevents public claims the
data cannot support.

## Funding: federal grants only, not private capital

The index knows about NIH-awarded funding via NIH RePORTER. It does not
know about:

- Venture funding: seed, Series A/B/C/D+, growth rounds.
- Private equity or M&A transactions (except insofar as they are
  discussed in a linked publication — which the platform doesn't parse).
- Public-market data (IPO, ticker, market cap).
- SBIR/STTR "invested equivalent" — only the federal award amount is
  captured.
- Non-NIH federal grants (NSF, DOE, DOD, USDA, etc.) — the schema has an
  enum value for those agencies but the ETL loads NIH primarily; other
  agencies are absent or extremely sparse. UNVERIFIED whether any NSF /
  DOD projects exist in current production tables.
- Non-U.S. public research funding (EU FP, UKRI, national programs).

Every "funding" number a granted.bio analysis quotes is NIH award dollars
unless otherwise stated. Do not extrapolate to total company capital.

## Time coverage: bounded window, enforced app-side

- Product surface returns only projects with `fiscal_year >= 2024` —
  hardcoded as `MIN_FISCAL_YEAR` in several API routes. Older records
  remain in the database but are invisible to the product.
- Retention target is "current FY + 2 prior FYs, window shifts each
  Sep 30 FY close" (documented in `docs/DATA_PIPELINE_PLAN.md`), but the
  window is not enforced by a scheduled deletion or partition — the app
  constant must be bumped by hand at each FY roll.
- Trial dates, patent dates, and publication years are NOT filtered by
  this window. A 2015 patent linked to a 2024 project is still returned.

## Index refresh cadence

- NIH RePORTER's own upstream refresh cadence is weekly (Sunday →
  visibility Monday) — documented in `docs/NIH_REPORTER_DATA_FACTS.md`.
- granted.bio's ingestion cadence is a **fetch-time question** — read the
  most recent `data_imports.completed_at` for the authoritative "last
  refreshed" timestamp. See the fetch spec.
- Related enrichment sources (ClinicalTrials.gov, USPTO, PubMed) have
  their own per-record `api_last_updated` timestamps; these are set at
  enrichment time, not per-refresh.

## Linkage: probabilistic in reality, direct in schema

Every project ↔ patent / trial / publication link in the DB is a direct
foreign key on a natural identifier — schema-level linkage confidence is
100%. Real-world confidence is bounded by the upstream feed's
completeness:

- **Patents** are linked only if the patent record cites the NIH grant
  number. Commercial patents that don't cite NIH funding are invisible,
  even from the same organization.
- **Trials** are linked only if the ClinicalTrials.gov record names the
  NIH grant. Industry-sponsored trials without a linked federal grant
  are invisible.
- **Publications** are linked via PubMed's grant-linkage field. Papers
  the author neglected to attribute are invisible.

Consequence: a company's IP / clinical / publication footprint as shown
by granted.bio is a **lower bound on NIH-attributed activity**, not a
complete count of the company's activity.

## Classification: not exhaustive, not audited-live

- `primary_category` covers most projects but a real residual sits in
  `other` (open-ended taxonomy problem: health services, epidemiology,
  behavioral research). Do not treat "not in a specific category" as
  "not doing that work".
- `org_type` is deterministic keyword routing. It gets boundary cases
  wrong (university medical centers routed to `university`; independent
  institutes named "X Institute" routed to `hospital` when they aren't).
  Wrong rows are catalogued in `org_type_mismatches.csv` as a lower
  bound.
- `secondary_category` column exists but is effectively unpopulated in
  production.
- Trial `is_therapeutic_trial` **no longer defaults to TRUE** (fixed
  2026-09-14). Use the source-truth `primary_purpose` field for
  downstream analysis; the boolean is retained for backward compatibility
  with older records.
- Patent CPC codes: column exists, coverage UNVERIFIED, no filter surface.

### Audit-cycle fields: real values, low coverage today

The audit-cycle work (2026-09-14 to 2026-09-20) captured seven new
source-truth fields on projects (`contact_pi_name`, `admin_ic`,
`foa_number`, `direct_cost_amt`, `indirect_cost_amt`, `study_section`,
`spending_categories`), fourteen on trials (the trial-quality pack), and
one on publications (`mesh_terms`).

- Trial pack (~90% coverage where `api_raw_data` is populated) and
  publication `mesh_terms` (62% coverage after the 2026-09-18 backfill)
  are broadly usable today.
- Project audit fields sit at ~10% coverage — populated only on
  projects synced after ~2026-08-05. Historical RePORTER refill will
  grow this.
- `spending_categories` is populated on 0.003% of projects today (6 of
  ~200K). The projects-agent Path 2 MeSH/RCDC rescue is wired to it but
  yields near-zero until backfilled.

Report narrative gracefully degrades when coverage is thin — the
formatters print explicit "no data on the surfaced projects — legacy
rows loaded before the RePORTER audit ship" messages, and small-N
hedging is enforced in the prompt.

## Entity structure: no canonical org or PI records

- No `organizations` table. "Organization" is a de-duplication of
  `projects.org_name` at query time. Two rows that differ only in
  formatting (extra spaces, punctuation, "The" prefix) may or may not
  merge depending on the dedup rules of the specific aggregation.
- No `researchers` table. "Researcher" is a split of `pi_names` on
  commas/semicolons at query time. No canonical PI identifier — two rows
  for the same person written differently are two people to the system.
- No PI role. Contact PI vs Multi-PI vs Co-Investigator vs Program
  Officer is not distinguishable in `pi_names`.

## Semantic search: what it doesn't index

- **No publication-level semantic search RPC** (publications are
  retrieved via joins from surfaced projects, not by direct query
  against `publication_embedding`). UNVERIFIED whether an app-layer
  wrapper performs client-side cosine similarity.
- **No org-level embedding.** "Show me similar companies" is not a
  built primitive.
- **No researcher-level embedding.** Same.
- Semantic similarity is a project-level primitive only, using
  `abstract_embedding` (HNSW) — plus `patent_embedding`,
  `study_embedding`, `publication_embedding` (IVFFLAT) for their
  respective entities.
- MeSH-based topic retrieval was added 2026-09-14 (trials) and
  2026-09-18 (publications), but only as an **augmentation** inside
  report generation — no first-class "MeSH search" RPC or chat surface
  yet.

## Analysis output: bounded and stylized

- Every analysis references only NIH-linked records. The White Space
  section's "broader NIH" denominator is a keyword-filtered count of
  the full projects table — directional, not comparable across topics.
- Market Context is a live web-search pass, not sourced from the index.
  Its facts are only as fresh as the web at generation time.
- Named PIs and institutions are not permitted in Next Steps or in
  Competitive Topology's strategic implications — this is a deliberate
  editorial rule (avoid prescriptive institutional targeting), not a
  data gap. The information is present; the section text withholds it.

## What a buyer might reasonably expect but the platform does not have

- Company financials (revenue, headcount, valuation, funding rounds).
- Contact information for PIs beyond an occasional `pi_email` extracted
  from PubMed affiliation strings (`publications.pi_email` — sparse and
  legacy). No LinkedIn URLs, no phone numbers, no verified emails.
- News / PR / press-release feed.
- Deal / partnership announcements as a structured field.
- Job postings, hiring signals, patent-litigation records.
- FDA submission/approval status as a first-class field (some inferable
  from trial phase + status).
- Non-U.S. R&D funding data.
- Company-to-company similarity retrieval.
- Historical time series of coverage growth for the buyer to audit
  (`data_imports` table exists but has UNVERIFIED public visibility).

## What the platform does NOT enforce

- Deletion / retention windows are not enforced by the database. The
  application-side `MIN_FISCAL_YEAR` filter is a soft cutoff; older
  records remain queryable if you bypass the RPC filters.
- Rate limiting on share-token resolution is table-backed at 20/min per
  IP. Rate limits on authenticated report generation are enforced at the
  application layer via credit ledger checks, not at the DB.
