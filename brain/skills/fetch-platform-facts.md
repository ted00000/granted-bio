---
name: fetch-platform-facts
description: How to retrieve volatile platform facts (record counts, coverage percentages, window dates, refresh timestamps, pricing, tier names). These change; never store them as facts elsewhere.
---

# Fetch platform facts

**This file specifies WHERE to fetch each volatile fact. It does NOT
store the fact.** Everything below moves — record counts grow with each
ETL run, coverage percentages shift with each classifier run, pricing
and tier names can change with a landing-page redeploy.

Rules of use:

- Never quote a number in another wiki page. Point to this spec.
- The **live site** (www.granted.bio) is canonical over any doc, comment,
  or code constant for pricing and tier names. If the live site disagrees
  with a code constant, the site wins.
- The **database** is canonical for record counts and coverage percentages.
  If a hero-page stat disagrees with a DB count, the DB wins.
- Timestamp your answer when you fetch. Values decay quickly.

## Volatile facts and where to retrieve them

### Record counts

Total rows per core entity.

- **Canonical source:** the production database.
- **Query:**
  ```sql
  SELECT
    (SELECT COUNT(*) FROM projects WHERE is_bio_related = TRUE) AS projects,
    (SELECT COUNT(*) FROM projects
       WHERE is_bio_related = TRUE AND fiscal_year >= 2024) AS projects_in_window,
    (SELECT COUNT(*) FROM patents) AS patents,
    (SELECT COUNT(*) FROM publications) AS publications,
    (SELECT COUNT(*) FROM clinical_studies) AS trials;
  ```
- The `fiscal_year >= 2024` guard mirrors the app-side rolling-window
  filter — this is the count a user actually sees when they search. Report
  both `projects` and `projects_in_window`; they differ significantly.
- **Do NOT** trust the `stats` array in `src/app/page.tsx` (currently
  180K / 50K / 503K / 39K, rounded, code comment dates them to
  2026-07-28). Those are manually maintained hero-page constants; use them
  only when explaining what the marketing site displays, never as an
  authoritative count.

### Record counts by classification bucket

`primary_category` distribution, `org_type` distribution.

- **Canonical source:** the production database.
- **Query:**
  ```sql
  SELECT primary_category, COUNT(*)
  FROM projects
  WHERE is_bio_related = TRUE AND fiscal_year >= 2024
  GROUP BY primary_category ORDER BY 2 DESC;

  SELECT org_type, COUNT(*)
  FROM projects
  WHERE is_bio_related = TRUE AND fiscal_year >= 2024
  GROUP BY org_type ORDER BY 2 DESC;
  ```
- **Do NOT** quote figures from `classification.log` at the repo root —
  it's a point-in-time snapshot from an older run.

### Classification coverage percentages

Share of projects with each classification field populated / above a
confidence threshold.

- **Canonical source:** the production database.
- **Query template:**
  ```sql
  SELECT
    COUNT(*) AS total,
    COUNT(primary_category) AS with_primary_category,
    COUNT(*) FILTER (WHERE primary_category_confidence >= 80) AS high_confidence,
    COUNT(*) FILTER (WHERE primary_category = 'other') AS in_other_bucket,
    COUNT(*) FILTER (WHERE secondary_category IS NOT NULL) AS with_secondary
  FROM projects
  WHERE is_bio_related = TRUE AND fiscal_year >= 2024;
  ```

### Rolling-window boundaries

Current `MIN_FISCAL_YEAR` value, current window in years.

- **Canonical source:** the codebase. Grep:
  ```bash
  grep -rn "MIN_FISCAL_YEAR" src/
  ```
- Expected to match "current FY + 2 prior" as of the last operator-driven
  bump. If the constant lags the calendar, that's a bug (bump-by-hand
  policy — see [data-model.md](../wiki/product/data-model.md)).

### Last data refresh timestamp

When the ETL last completed a successful load.

- **Canonical source:** the production database.
- **Query:**
  ```sql
  SELECT job_type, completed_at, status, stats
  FROM processing_jobs
  WHERE status = 'completed'
  ORDER BY completed_at DESC
  LIMIT 5;

  SELECT year, agency, completed_at, projects_added, projects_updated
  FROM data_imports
  WHERE status = 'completed'
  ORDER BY completed_at DESC
  LIMIT 5;
  ```
- Cross-check against the NIH RePORTER upstream cadence documented in
  [docs/NIH_REPORTER_DATA_FACTS.md](../../docs/NIH_REPORTER_DATA_FACTS.md)
  (weekly, Sunday → Monday visibility).

### Per-source enrichment freshness

How recent the last USPTO / ClinicalTrials.gov / PubMed enrichment pull was.

- **Canonical source:** the production database.
- **Query:**
  ```sql
  SELECT MAX(api_last_updated) AS last_patent_enrichment FROM patents;
  SELECT MAX(api_last_updated) AS last_trial_enrichment FROM clinical_studies;
  ```
- PubMed doesn't carry an `api_last_updated` on the publications row;
  fall back to `MAX(created_at) FROM publications` as an approximation
  and note it as such.

### Audit-cycle field coverage (added 2026-09-14 to 2026-09-20)

Coverage percentages for the source-truth enrichment fields shipped in
the audit-cycle work. These grow with each historical backfill run.

- **Canonical source:** the production database.
- **Query template — trials:**
  ```sql
  SELECT
    COUNT(*) AS total_trials,
    COUNT(primary_purpose) AS with_primary_purpose,
    COUNT(lead_sponsor_class) AS with_lead_sponsor_class,
    COUNT(allocation) AS with_allocation,
    COUNT(*) FILTER (WHERE has_dmc IS NOT NULL) AS with_dmc_flag,
    COUNT(*) FILTER (WHERE condition_mesh IS NOT NULL) AS with_condition_mesh,
    COUNT(*) FILTER (WHERE intervention_mesh IS NOT NULL) AS with_intervention_mesh
  FROM clinical_studies;
  ```
- **Query template — projects (audit-cycle fields):**
  ```sql
  SELECT
    COUNT(*) AS total,
    COUNT(contact_pi_name) AS with_contact_pi,
    COUNT(admin_ic) AS with_admin_ic,
    COUNT(foa_number) AS with_foa,
    COUNT(direct_cost_amt) AS with_direct_cost,
    COUNT(study_section) AS with_study_section,
    COUNT(*) FILTER (WHERE spending_categories IS NOT NULL) AS with_spending_categories
  FROM projects
  WHERE is_bio_related = TRUE;
  ```
- **Query template — publications MeSH:**
  ```sql
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE mesh_terms IS NOT NULL) AS with_mesh_terms,
    ROUND(100.0 * COUNT(*) FILTER (WHERE mesh_terms IS NOT NULL) / COUNT(*), 1) AS pct_covered
  FROM publications;
  ```
- Baseline snapshots for context (do NOT quote in outbound material —
  re-fetch each time):
  - Trial-quality pack: ~90% of trials with an `api_raw_data` row.
  - Project audit fields: ~10% of ~200K projects (2026-09-19).
  - Publication `mesh_terms`: ~62% (317,565 of ~512K, 2026-09-18).
  - `spending_categories`: 0.003% (6 rows, 2026-09-19).

### Report generation performance

Wall-clock times and cost signals for topic-report generation.

- **Canonical source:** the production database + Anthropic dashboard.
- **Query — recent completed reports and their wall time:**
  ```sql
  SELECT
    topic,
    status,
    persona,
    project_count,
    EXTRACT(EPOCH FROM (updated_at - created_at)) AS wall_seconds,
    created_at
  FROM user_reports
  WHERE status = 'complete'
  ORDER BY created_at DESC
  LIMIT 20;
  ```
- Baseline for context: after the 2026-09-20 Phase 5→Phase 4 merge, the
  first successful radioligand cancer therapy report completed in 7m
  11s at 511 trials / 636 publications / 119 projects. Broad topics
  before the merge were hitting the "generator opcode" retry loop and
  taking 30-45 min with 2-3× LLM cost.

### Topic MeSH cache

- **Canonical source:** the production database.
- **Query:**
  ```sql
  SELECT topic_normalized, condition_mesh, intervention_mesh,
         extractor_version, extracted_at
  FROM topic_mesh_cache
  ORDER BY extracted_at DESC
  LIMIT 20;
  ```
- Each row corresponds to one topic string that has passed through
  either the trials-agent Path 3 or the projects-agent Path 2 rescue.
  Not user-facing.

### Pricing (price, promotion, discount availability)

- **Canonical source:** the live site — [www.granted.bio/pricing](https://www.granted.bio/pricing).
- The `PricingPage` at `src/app/pricing/page.tsx` and `src/app/page.tsx`
  currently reference `$199` and the platform-pass framing. **This is a
  code snapshot; the live site is authoritative** because a
  landing-page redeploy is faster than an update to this doc.
- Stripe products / prices in the Stripe dashboard are the source of
  truth for what a checkout session actually charges. If the site and
  Stripe disagree, that's a bug — flag it.

### Tier names and entitlements

What tiers exist and what they include.

- **Canonical source (public naming):** the live site — pricing page,
  FAQ, and any tier-comparison surfaces.
- **Canonical source (implementation):** the `user_profiles.tier` enum
  values (`free`, `basic`, `advanced`, `unlimited`, `beta`) plus the
  platform-pass mechanism in `user_profiles.platform_pass_expires_at`
  (migration `20260903`).
- Note the current model: `$199 = one included analysis + 3-month
  platform pass, reset on each additional purchase`. This is documented
  as an internal decision in memory ([[project_pricing_model]]) and
  described publicly on the site. When they disagree, the site wins.

### Search quota by tier

Free-tier searches/month vs Pro searches/month.

- **Canonical source (public):** live pricing page + FAQ.
- **Canonical source (implementation):** grep the tier gate code:
  ```bash
  grep -rn "searches_this_month\|SEARCH_LIMIT\|monthly_limit" src/
  ```
- Current stated ratio is "10/mo free vs 500/mo pro" per pricing FAQ; do
  not repeat these numbers without checking the site AND the code
  constant — they should agree.

### Sample analyses (which topics have public samples)

Which topics are exposed as public samples on the site.

- **Canonical source:** the production database.
- **Query:**
  ```sql
  SELECT id, title, topic, created_at
  FROM user_reports
  WHERE is_public_sample = TRUE
  ORDER BY created_at DESC;
  ```
- Cross-check against the routes under `src/app/sample/*/page.tsx` — each
  is a `permanentRedirect` shell to a specific `user_reports.id`.

### Coverage by taxonomy category / by state / by year

Any "how much data do we have on X" question.

- **Canonical source:** the production database.
- Do not use samples in the `docs/*.pdf` files as evidence — those are
  point-in-time snapshots of generated analyses.

### Live-site claims that need verification before quoting

The landing page (`src/app/page.tsx`) and pricing page
(`src/app/pricing/page.tsx`) carry copy that reads like fact. Before
using any of the following in outbound material, re-verify against the
current site (which may have been redeployed since this doc):

- Total data counts in the hero stat block.
- The phrase "cross-linked at the project_number level" — accurate for
  patents/trials/publications, but note the linkage-confidence caveat in
  [limits.md](../wiki/product/limits.md).
- "500/mo vs the free tier's 10/mo" — check current tier caps.
- "12 months of refresh" — check credit expiry defaults.
- "14 days to refine & regenerate" — check retry credit window.
- "Every $199 pass includes three months of platform access" — check
  the current platform-pass duration in the Stripe webhook code
  (`src/app/api/stripe/webhook/route.ts` resets
  `platform_pass_expires_at = NOW() + N days`).

### Anything not in this list

If you need a fact that isn't specified above, and it changes over time,
add it here — do not put it in a wiki page.
