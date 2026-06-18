# Data Pipeline Maintenance Plan — 17JUN2026

This is the plan for how we keep our data fresh after launch. It's
written in plain language. Re-date the header when revising.

It is grounded in a thorough review of the current code done
2026-06-17. Specific file:line citations are below where it matters.

---

## Standard Operating Procedure — Delta-targeted ingest

**Delta-targeted ingest is the SOP for every data refresh from this
point forward.** Full-file upsert via `load_to_supabase.py` is the
anomaly, not the default.

For each refresh:

1. **Diff first.** Run the per-entity diff script (e.g.,
   `scripts/diff-clinical-studies.ts`) against the new bulk file or
   API response. Read-only, no DB writes, no API spend. Tells you
   exactly how many rows are new, changed, and orphaned.
2. **Decide.** If new + changed is meaningful, proceed to step 3.
   If it's zero, you're done — log it and move on.
3. **Ingest only the delta.** Run the per-entity delta loader (e.g.,
   `etl/load_clinical_studies_delta.py`) against the same file. The
   loader applies the change-detection logic that matches the diff
   script and upserts only what the diff identified as new or changed.
   `updated_at` on unchanged rows is never touched.
4. **Run downstream stages selectively.** Embeddings via the default
   (NULL-only) mode of the existing embedding scripts. No blanket
   regens. No `--refresh` flag invocations.
5. **Log it.** Note what you did, what file you used, what the diff
   showed, and any issues. Until the dashboard captures this
   automatically (Phase 4+), a paragraph in a shared note or a
   commit message is enough.

**When full-file upsert IS appropriate** (the exceptions):

- Recovering from a known corrupted load where targeted ingest can't
  identify everything that needs to be re-written.
- Initial bootstrap of a new entity table (no DB state to diff against).
- After a schema change that requires every row to be re-processed
  through the loader's normalization step.

In every other case: diff first, then targeted delta ingest. If you're
about to run a full upsert and none of the exceptions above apply, stop
and ask whether you actually have a reason.

---

## What we're solving

We launched with a snapshot of NIH data. The platform's value comes
from that data being current. Today the snapshot is months stale and
we have no system for refreshing it without re-running the whole
build-from-scratch pipeline and paying for embeddings and
classifications we already paid for.

We need a pipeline that:

1. Knows what state each data source is in (fresh, stale, mid-update,
   broken).
2. Only ingests what's actually new or changed — not the whole world
   every time.
3. Only re-embeds and re-classifies rows whose embeddable or
   classifiable content actually changed.
4. Doesn't break the live site or break existing customer reports.
5. Costs essentially nothing to run when nothing changed upstream.

---

## What we have today

The current pipeline lives in `etl/` and gets run by
`scripts/load_fiscal_year.sh`. It assumes a from-scratch bulk reload
every time. It is functional but built for a different problem than
the one we have now.

The good parts (we keep these):

- The per-entity processors (`etl/process_projects.py`,
  `process_patents.py`, `process_publications.py`,
  `process_clinical.py`) are modular and well-organized. They take a
  CSV row in, give a dict out, and don't do anything weird.
- The DB schema for the data tables is solid. Natural keys exist on
  every table. Vector indexes are properly tuned. Junction tables
  use composite primary keys.
- Most loaders use upsert by natural key (`application_id` for
  projects/abstracts, `pmid` for publications, `patent_id` for
  patents), so re-running on the same data doesn't create
  duplicates. This is the single most important production-safety
  fact.
- Embedding scripts are idempotent in their default mode: they only
  embed rows where the embedding column is NULL
  ([etl/generate_embeddings_batched.py:85](etl/generate_embeddings_batched.py#L85)).
  So re-runs don't blow up the bill unless someone passes a
  `--refresh` flag.

The bad parts (we will not repeat these):

1. **Classification re-runs on every project, every time.**
   `etl/classify_projects_batched.py` fetches *all* projects without
   a WHERE clause ([line 38](etl/classify_projects_batched.py#L38))
   and runs Claude on every one of them — even if nothing about the
   project changed since last run. This is the single biggest
   recurring cost in the current pipeline.

2. **The clinical_studies upsert is using the wrong key.**
   `etl/load_to_supabase.py:329` upserts clinical studies on
   `nct_id` alone. But a single NCT can be linked to multiple NIH
   projects. The correct natural key is `(nct_id, project_number)`,
   which `etl/fetch_linked_data.py:242-245` actually uses
   correctly elsewhere. Result: when two projects link to the same
   trial, the second write silently overwrites the first link.
   This is a silent data-loss bug already present in the live DB.

3. **The project_publications link upsert may not be safe.**
   `load_to_supabase.py:347` writes to the project_publications link
   table using `.upsert()` without an explicit `on_conflict`
   parameter. Behavior depends on the client library auto-detecting
   the composite primary key, which is fragile. Should be explicit.

4. **Link tables are built scoped to "this load only".**
   In `load_to_supabase.py:333-346`, the link records are filtered
   to include only projects and publications loaded *in this batch*.
   If we load a fresh FY2025 projects file but FY2024 publications
   are already in the DB, we never create the FY2025-project to
   FY2024-publication link. Silent data loss the second time you
   run a partial load.

5. **The admin upload UI is mostly theater.**
   `src/app/admin/upload/page.tsx` lets an admin upload a CSV to a
   Supabase storage bucket and creates an `etl_jobs` row. The
   server route `src/app/api/admin/etl/process/route.ts:46-49`
   marks the job as "running" — and then does nothing. The actual
   pipeline scripts are never triggered. The comment at line 51-59
   acknowledges this is incomplete. The UI looks like a working
   data dashboard but isn't one.

6. **The `etl_jobs` table is orphaned.**
   Migration `002_etl_jobs.sql` defines a perfectly fine job-state
   tracking table. The admin Jobs page reads from it. But the
   actual Python ETL scripts never write to it. Nothing in
   `etl/load_to_supabase.py` or any of the processors logs to
   `etl_jobs`. So the Jobs page only ever shows the cosmetic rows
   the upload UI creates — never reality.

7. **No checkpointing or transaction boundaries.**
   `load_fiscal_year.sh` runs 8 sequential steps. If step 3
   (patent embeddings) fails, steps 4-8 still run, leaving the DB
   in a partially-updated state with no signal that something
   broke. There's no way to resume from where it stopped.

---

## Principles we follow from here on

These are non-negotiable for everything we build in this plan.

1. **Small bites, no rush.**
   Each piece of work is a single shippable commit. We can stop
   between any two of them with no half-built state in production.
   Claude Max gives us cheap development time; the cost is paid
   external services (Claude embeddings, classification API calls).
   We optimize for those, not for finishing fast.

2. **Don't pay twice for the same work.**
   Every expensive operation gets a change-detection guard. We
   embed if and only if the embedded content actually changed. We
   classify if and only if the classified content actually changed.
   No exceptions. No `--refresh` flags that blanket-regenerate.

3. **Read-only diagnostics first, writes second.**
   Before any write that could touch production data, there is a
   read-only diagnostic that tells us what's about to happen. The
   diff script. The dashboard. The Last-Modified probe. We make
   the system observable before we make it active.

4. **Idempotent or don't run.**
   Every write path uses an explicit `on_conflict` with the
   correct natural key. No relying on client-library defaults. The
   clinical_studies bug and the project_publications link
   ambiguity are both fixed before we add any new write paths.

5. **The dashboard reads, the cron writes.**
   The state dashboard never calls live upstream URLs at page-load
   time. A daily cron probes upstream, writes to a state table,
   and the dashboard reads from that table. Page loads are free.

6. **Existing customer data is sacred.**
   Existing reports reference application_ids, pmids, patent_ids,
   nct_ids. No refresh job may ever change these identifiers or
   hard-delete a row that an existing report references. Orphans
   (rows in DB but no longer in the bulk file) get reported, not
   deleted, until we've decided what to do with them.

---

## What "done" looks like

When this plan is fully built out, here is what we have:

A. **A dashboard at `/admin/data-sources`** that shows, for each
   data source we depend on, three things:
   - Where the upstream is right now (file date for ExPORTER,
     "live" for the APIs).
   - Where our DB is right now (row counts, most recent
     `updated_at`).
   - What jobs are running against this source, what ran last, and
     when.

B. **A daily probe cron** at `/api/cron/refresh-data-source-state`
   that does 9 HEAD requests + 9 SELECT COUNTs and updates a
   small `data_source_state` table. Total cost: pennies a month.

C. **A local diff script** per entity that, given a downloaded
   bulk file, tells us exactly what's new, what's changed, and
   what's a potential orphan compared to the DB — without
   touching the DB. Run by us, on our machines, when we want
   truth.

D. **A delta-aware ingestor** that takes the diff script output
   and only loads the changed rows. Reuses the existing
   `process_*.py` modules. No re-loading of unchanged rows.

E. **Change-detection guards on embeddings and classification.**
   A small hash column per table records the content that produced
   the current embedding/classification. Before a re-embed or
   re-classify, we compare current hash to stored hash. If they
   match, we skip the API call.

F. **A weekly RePORTER API cron** that pulls projects with
   `award_notice_date` in the last 7 days, runs them through the
   delta-aware ingestor. Fills the time gap between ExPORTER
   refreshes. Bounded to about 1 request per second to respect
   NIH's rate-limit guidance.

G. **A monthly catch-up reminder**, not a job — a calendar item
   for us — to check the dashboard for any source that hasn't
   been refreshed recently and decide what to do.

---

## How we get there

These are the small bites, in order. Each is independently
shippable and each leaves the production site stable.

**Phase 0: stop the bleeding (no production deploys needed).**

- 0.1 Fix the clinical_studies upsert key in
  `etl/load_to_supabase.py:329` to be the composite
  `(nct_id, project_number)`. This is a one-line code change.
  Document the silent-data-loss case in the commit message.
- 0.2 Fix the project_publications link upsert in
  `load_to_supabase.py:347` to use an explicit `on_conflict`.
  One-line change.
- 0.3 Remove the link-table scoping in
  `load_to_supabase.py:333-346` so we generate links against the
  full DB state, not just the in-batch rows.

These three are quick, defensive, and unlock everything else. They
don't add features; they keep the current pipeline from quietly
losing data the next time we run it.

**Phase 1: the state table and the dashboard.**

- 1.1 New migration: `data_source_state` table. Stores per-source
  upstream version, DB row count, DB high-water mark, last probe
  time, last diff time, last diff result.
- 1.2 New cron `/api/cron/refresh-data-source-state` that probes
  every source (HEAD + COUNT) and upserts the table. Wired into
  `vercel.json`. Daily.
- 1.3 New page `/admin/data-sources` that renders the state
  table. Read-only.

After phase 1 we can see, at a glance, where every source stands.

**Phase 2: diff scripts.**

- 2.1 `scripts/diff-bulk-vs-db.ts` for patents (smallest entity,
  lowest risk). Reads a CSV, queries DB, outputs new/changed/orphan
  counts. No writes. Run locally.
- 2.2 Same for clinical_studies.
- 2.3 Same for projects + abstracts + publications.

Each one of these is a separate small commit. Running them is a
manual step the operator chooses to do.

**Phase 3: change-detection hashes.**

- 3.1 Migration adds `embed_content_hash TEXT` to projects,
  patents, publications, clinical_studies.
- 3.2 Modify each embedding script: compute the hash of current
  content; skip embedding if it matches stored hash.
- 3.3 Migration adds `classify_content_hash TEXT` to projects.
- 3.4 Modify classification: skip if hash matches.

After phase 3, re-running a pipeline on unchanged content costs
nothing in API calls.

**Phase 4: the delta-aware loader.**

- 4.1 Modify `load_to_supabase.py` (or write a wrapper) so it can
  take a delta CSV and run only the changes through the existing
  processors.
- 4.2 Wire `etl_jobs` writes into the loader so the Jobs page
  actually shows what ran.

**Phase 5: the RePORTER API cron.**

- 5.1 New cron `/api/cron/sync-reporter-api` that queries the
  API for `award_notice_date` in the last 7 days, runs the
  results through the delta-aware loader.
- 5.2 Wired into `vercel.json`. Weekly, Monday morning ET to
  catch the Sun-night upstream refresh.

**Phase 6: real ExPORTER bulk ingest path (only when ExPORTER updates).**

- 6.1 Cron probes ExPORTER URLs daily, if `Last-Modified`
  advances it queues a job, alerts us, and we kick off the
  bulk download + diff + delta-ingest from our laptops or a
  dedicated runner. Not fully automated initially — manual
  trigger after notification.

---

## What is explicitly NOT in scope

- A complete rewrite of the `etl/` Python scripts. They mostly
  work. We patch around them and reuse their processors.
- Migrating away from CSV intermediates. They're fine.
- Real-time streaming ingestion. Daily is plenty.
- Dropping any data already in the DB. Even bad data stays
  until we have a clear migration story for it.
- Automated USPTO ODP integration. Defer until we decide
  patent-content enrichment is worth the work.
- Adding more report personas, marketing copy work, etc. —
  this doc is data only.

---

## Open questions

These we don't have answers to yet. Each gets resolved before
the relevant phase, not now.

1. What hash algorithm and what fields go into the embed hash?
   Probably SHA-256 of `title + phr + terms + abstract`. We
   nail this down in Phase 3.
2. Does the RePORTER API V2's `criteria` object support the
   `date_added` filter we plan to use, with the exact semantics
   we expect? Confirm in Phase 5 prep.
3. How do we want to handle a row that disappears from the
   bulk file (orphan)? Phase 2 just reports them. Phase 6
   probably soft-flags. Hard delete is off the table.
4. What FYs do we ingest for ExPORTER? Just the current FY?
   Or all FYs we've ever cared about? Probably FY2024 + 2025 +
   2026 to align with the "three prior FYs are refreshed" rule.

---

## How we know we're done

Concrete signals that this plan is fully realized:

- Dashboard `/admin/data-sources` shows all 9 sources with
  green-ish freshness indicators most of the time.
- A re-run of the full pipeline on unchanged content costs less
  than $1 in API calls (today it costs ~$50-100+ because
  classification is blanket).
- We can describe, in one sentence, the last time each data
  source got refreshed.
- The clinical_studies bug and the project_publications link
  ambiguity are gone from the code.
- The Jobs page shows real jobs from real ingest runs, not
  cosmetic ones from the upload UI.
