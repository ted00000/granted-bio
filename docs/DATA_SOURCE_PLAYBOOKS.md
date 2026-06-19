# Data Source Playbooks — 19JUN2026

For each upstream data source we depend on, this doc describes:

1. Where it comes from
2. What shape it has (FY-bounded vs all-time, bulk vs API)
3. How we detect when it has changed
4. How we compute the delta
5. How we apply the delta
6. What downstream stages get triggered
7. What the cost characteristics are

It sits alongside `DATA_PIPELINE_PLAN.md` (strategic) — this doc is
tactical reference. When in doubt about how to update source X,
this is where to look.

Re-date the header when revising.

---

## Retention policy

**The platform retains the current fiscal year + the two prior fiscal
years. Older data is not ingested and (over time) is purged from the DB
on FY rollover.**

Today (2026-06-19): FY2024 + FY2025 + FY2026.
After Sep 30, 2026 (next FY close): FY2025 + FY2026 + FY2027.

**Why.** Our product delivers insights contemporary to current
conditions. Awards from 3+ years ago add noise without serving the
core use case (researchers asking "what's funded NOW in my space,"
"who's working on this RIGHT NOW," "what's the current investment
trajectory"). A bigger DB also costs more to host, search, and embed.

**Implications:**

- **ExPORTER FY-bounded files**: we only download files within the
  retention window. Pre-window FYs are ignored regardless of upstream
  availability.
- **NIH FAQ alignment**: NIH refreshes the "three prior FYs" at FY
  close. That's 4 FYs of actively-maintained upstream data (current +
  3 prior). Our window uses 3 of them (current + 2 prior), so the
  oldest of NIH's actively-refreshed FYs is deliberately *not*
  ingested.
- **FY rollover cleanup**: on each Sep 30 rollover, projects with
  `fiscal_year < window_floor` become eligible for purge. Abstracts,
  publication links, project_patents, and clinical_studies rows tied
  to those projects follow via FK cascade. Publications/patents/NCTs
  themselves stay if they have links to retained projects.
- **All-time files (patents, clinical studies)**: the file itself is
  cumulative, but the LINKS we care about respect retention because
  they reference project_numbers that exist in our retained projects.
  Patent and trial *records* whose only links were to purged projects
  get pruned via the same FY rollover step.

## The pattern (SOP)

Every entity refresh follows the same three-step shape:

1. **Diff** (`scripts/diff-<entity>.ts`) — read CSV/API, query DB,
   report new/changed/orphan counts. No writes, no paid API calls.
2. **Delta ingest** (`etl/load_<entity>_delta.py`) — read CSV again,
   apply same change-detection logic as the diff script, upsert only
   new + changed rows. `updated_at` on unchanged rows is never touched.
3. **Downstream stages** — embeddings via default (NULL-only) mode of
   the existing scripts; no `--refresh` invocations.

Full-file ingest via `load_to_supabase.py` is the anomaly, not the
default. See `DATA_PIPELINE_PLAN.md` for the rules on when full
upsert is appropriate.

**Current per-entity tooling status (19JUN2026):**

| Entity | Diff script | Delta loader | Status |
|---|---|---|---|
| Clinical studies | `scripts/diff-clinical-studies.ts` | `etl/load_clinical_studies_delta.py` | ✓ Both shipped |
| Patents | `scripts/diff-patents.ts` | `etl/load_patents_delta.py` | ✓ Both shipped |
| Projects (new awards) | n/a — API is the delta | `etl/sync_projects_via_api.py` | ✓ Shipped (new awards only; modifications still need ExPORTER bulk) |
| Projects (bulk) | not built yet | not built yet | Pending |
| Abstracts | not built yet | not built yet | Pending |
| Publications | not built yet | not built yet | Pending |
| Project-Publication links | not built yet | not built yet | Pending |

Each pending pair gets built when we're about to refresh that entity,
not before. Same template, different natural keys + diff fields.

---

## Per-source playbooks

### Source 1 — Projects (ExPORTER, per fiscal year)

| | |
|---|---|
| **URL** | `https://reporter.nih.gov/exporter/projects/download/<fy>` |
| **Format** | CSV (`RePORTER_PRJ_C_FY<fy>.csv`) |
| **Files we care about** | Current FY + 3 prior FYs (FY2023–FY2026 today) per the upstream's "3 prior FYs are refreshed" rule |
| **Cadence (upstream)** | Documented: fiscal-year close (Sep 30 + downstream). Observed: irregular — current file dates do not match the documented cycle. **We poll, not schedule.** |
| **Detection** | Daily `HEAD` request per FY file; act when `Last-Modified` advances |
| **Natural key** | `application_id` (unique) |
| **Delta computation** | Download file → parse → for each row compare CSV `application_id` against DB. Output: new (not in DB), changed (in both, embeddable/classifiable fields differ), orphan (in DB not in CSV — for record-keeping only, never deleted) |
| **Delta application** | Feed delta-only rows through existing `etl/process_projects.py` + `load_to_supabase.py` chain. Idempotent upsert on `application_id`. As of 2026-06-19 `load_to_supabase.py` no longer classifies inline — projects land with `primary_category = NULL` and are filled by the post-load classifier step. |
| **Downstream stages** | (a) Project embedding regen — only if `title + phr + terms + abstract` hash differs from stored `embed_content_hash`. (b) Classification — runs against rows with NULL `primary_category` (default) via `etl/classify_projects_batched.py` (which wraps the canonical `etl/classifier.py`). Pass 1 (activity-code routing) is deterministic in Python; Pass 2 (content categories) goes through Claude Haiku. See "Classification SOP" section below. |
| **Cost characteristics** | Per changed row: ~$0.00002 embedding (OpenAI) + Haiku classification (~$0.0001/proj). For a 1000-row delta that's roughly $0.12 total. Negligible. About 40% of projects skip the LLM entirely thanks to Pass 1 deterministic routing. The cost-killer is blanket regen on unchanged content — what Phase 3 fixes. |
| **Production safety notes** | Upsert idempotency is ✓. No special concerns once Phase 3 guards are in. |

### Source 2 — Abstracts (ExPORTER, per fiscal year)

| | |
|---|---|
| **URL** | `https://reporter.nih.gov/exporter/abstracts/download/<fy>` |
| **Format** | CSV (`RePORTER_PRJABS_C_FY<fy>.csv`); separated from projects "due to file size considerations" per FAQ |
| **Cadence (upstream)** | Same as projects |
| **Detection** | Same — daily `HEAD` per FY file |
| **Natural key** | `application_id` (FK to projects, UNIQUE per migration `20260309_abstracts_unique_constraint.sql`) |
| **FK dependency** | An abstract row is meaningless without its project row. **Always ingest projects before abstracts** for the same FY. |
| **Delta computation** | Same shape as projects: diff CSV `application_id` set vs DB |
| **Delta application** | `load_to_supabase.py:317` upsert on `application_id`. Idempotent. |
| **Downstream stages** | Triggers project embedding regen (the abstract is part of the embedded text). Same hash-skip guard from Phase 3. |
| **Cost** | Same as projects (the embedding cost is on the project, not the abstract) |
| **Production safety** | Idempotent ✓; FK ordering matters |

### Source 3 — Publications (ExPORTER, per fiscal year)

| | |
|---|---|
| **URL** | `https://reporter.nih.gov/exporter/publications/download/<fy>` |
| **Format** | CSV (`RePORTER_PUB_C_FY<fy>.csv`) |
| **Cadence (upstream)** | Same as projects |
| **Detection** | Daily `HEAD` per FY file |
| **Natural key** | `pmid` (unique) |
| **Delta computation** | Diff CSV `pmid` set vs DB. Same publication can appear across multiple FY files (deduped on `pmid`). |
| **Delta application** | `load_to_supabase.py:321` upsert on `pmid`. Idempotent. |
| **Downstream stages** | Publication embedding regen — only on title change (Phase 3 hash guard). |
| **Cost** | Trivial — publication embedding is title-only, ~$0.00001 per row |
| **Production safety** | Idempotent ✓ |

### Source 4 — Project–Publication links (ExPORTER, per fiscal year)

| | |
|---|---|
| **URL** | `https://reporter.nih.gov/exporter/linktables/download/<fy>` |
| **Format** | CSV (`RePORTER_PUBLNK_C_FY<fy>.csv`) |
| **Cadence (upstream)** | Same as projects |
| **Detection** | Daily `HEAD` per FY file |
| **Natural key** | `(project_number, pmid)` composite PK on `project_publications` table |
| **FK dependency** | Both endpoints must exist in `projects` and `publications` respectively. **Always ingest projects + publications before link tables** for the same FY. |
| **Delta computation** | Diff CSV `(project_number, pmid)` pairs vs DB |
| **Delta application** | `load_to_supabase.py:347` upsert on `project_number,pmid` (Phase 0 #2 fix applied 2026-06-17). Cross-batch links no longer filtered out (Phase 0 #3 fix). |
| **Downstream stages** | None — link table is terminal |
| **Cost** | Free — just SQL writes |
| **Production safety** | Idempotent on composite PK ✓ |

### Source 5 — Patents (ExPORTER, all-time)

| | |
|---|---|
| **URL** | `https://reporter.nih.gov/exporter/patents/download` (no FY) |
| **Format** | CSV (`Patents.csv`) — **single all-time file**, contains every patent NIH RePORTER has ever tracked |
| **Cadence (upstream)** | Not documented. Observed: 2026-06-15 update. **We poll, not schedule.** |
| **Detection** | Daily `HEAD` request — single file |
| **Natural keys** | `patent_id` (patents table); `(project_number, patent_id)` composite (project_patents link table — created by migration `20260310_patent_junction_table.sql`) |
| **Delta computation** | **Two diffs run together:** (a) new `patent_id`s in CSV not in DB `patents` table; (b) new `(project_number, patent_id)` links in CSV not in DB `project_patents` table |
| **Delta application** | `etl/process_patents.py` returns both `patents_dict` and `links_list`; loader upserts both. Existing code handles this. |
| **All-time file implication** | The CSV contains hundreds of thousands of rows that are mostly already in DB. A naive full upsert touches every row's `updated_at`. **Use the diff script (Phase 2.1) to ingest only the actual delta**, not the whole file. |
| **Downstream stages** | Patent embedding — only on title change (Phase 3 hash guard) |
| **Cost** | Trivial per row; the all-time-file pattern means a slim delta against existing DB. |
| **Production safety** | Idempotent on `patent_id` and on `(project_number, patent_id)` ✓ |
| **Patent caveat to remember** | Per ExPORTER FAQ: "Only issued patents are listed; patent applications in-progress are excluded." Not a code concern, but worth remembering for any FTO-related framing in the product. |

### Source 6 — Clinical Studies (ExPORTER, all-time)

| | |
|---|---|
| **URL** | `https://reporter.nih.gov/exporter/clinicalstudies/download` (no FY) |
| **Format** | CSV (`ClinicalStudies.csv`) — **single all-time file** containing every NCT linkage NIH has ever recorded |
| **Cadence (upstream)** | Not documented. Observed: 2026-06-15 update. **We poll, not schedule.** |
| **Detection** | Daily `HEAD` request — single file |
| **Natural key** | `(nct_id, project_number)` composite — the new unique constraint added by migration `20260617_clinical_studies_composite_unique.sql`. A single NCT can be linked to multiple NIH projects, so the link, not the NCT, is the natural unit. |
| **Delta computation** | Diff CSV `(nct_id, project_number)` pairs vs DB. Also worth surfacing rows where `study_status` or `study_title` changed (NCTs frequently change status as trials progress). |
| **Delta application** | `etl/process_clinical.py` via `load_to_supabase.py:329` — upserts on composite (Phase 0 #1 fix applied 2026-06-17). **Requires the new constraint to be applied in prod before next ingest.** |
| **All-time file implication** | Same as patents — most rows are already in DB. **Use the diff script before ingest** to avoid blanket touch-every-row writes. |
| **Downstream stages** | (a) Clinical study embedding — only on title or conditions change (Phase 3 hash guard). (b) ClinicalTrials.gov runtime enrichment (Source 8) for status/phase/enrollment. Separate pipeline. |
| **Cost** | Trivial |
| **Production safety** | Now idempotent on composite ✓ post Phase 0.5. Previously was silently failing or losing links. |

### Source 7 — RePORTER API (live)

| | |
|---|---|
| **URL** | `https://api.reporter.nih.gov/v2/projects/search` (Projects), `/v2/publications/search` (Publications) |
| **Format** | JSON, paginated (default 50, max 500 per page, max offset 14,999 → 15,000-record per-query cap) |
| **Covers** | Projects (including abstracts as a project field), Publications. **Does NOT cover** patents or clinical studies. |
| **Cadence (upstream)** | Weekly refresh, Sunday night → Monday morning visibility per FAQ |
| **Detection** | Not "detection" — pulled on a schedule. Daily cron asks "any awards with `award_notice_date` in the last N days?" |
| **Available date filters** | `award_notice_date`, `date_added`, `project_start_date`, `project_end_date`. **No `last_modified_date` filter exists**, so the API can capture new awards but NOT modifications to existing ones — that's why ExPORTER bulk remains mandatory. |
| **Delta computation** | The API result IS the delta — we asked for "since X" and got just those rows. No separate diff step required. |
| **Delta application** | `etl/sync_projects_via_api.py`. Pulls API → maps to ExPORTER-shaped dicts → applies bio-boundary filter (`process_projects.is_bio_related`) → classifies via canonical `etl/classifier.py` → upserts projects + abstracts on `application_id`. Does NOT regen embeddings; run `etl/generate_embeddings_batched.py` (default NULL-only mode) after. |
| **Rate limits** | "No more than one URL request per second"; large jobs to "weekends or weekdays between 9:00 PM and 5:00 AM EST." IP blocking risk. **Schedule daily cron for off-peak.** |
| **Downstream stages** | Same as Source 1 (Projects) — embeddings + classification. Classification is inline (canonical classifier called from the sync script), unlike Source 1 which defers classification to the post-load step. |
| **Cost** | Free (NIH API has no charge); the cost is in embeddings + classification on the new rows. |
| **Production safety** | Rate-limit aware; daily small windows keep volume tiny |

### Source 8 — ClinicalTrials.gov API (runtime + batch enrichment)

| | |
|---|---|
| **URL** | `https://clinicaltrials.gov/api/v2/studies/<nct_id>` |
| **Format** | JSON per NCT |
| **Covers** | Trial *content* — status, phase, enrollment, conditions, eligibility |
| **Already wired** | `etl/enrich_clinical_trials.py` (batch), `src/lib/reports/agents/trials.ts:307` (per-report runtime) |
| **Cadence** | Continuous — CT.gov is the live authoritative source |
| **Delta computation** | We query per-NCT for whichever trial we need to refresh. Bulk refresh = iterate over NCTs in DB. |
| **Cost** | Free; no documented rate limit issues. |
| **Production safety** | Read-only enrichment; no risk to DB schema |
| **Relationship to Source 6** | Source 6 (ExPORTER clinical_studies) gives us the *project ↔ NCT linkage*. Source 8 gives us the *trial content*. Both are required. |

### Source 9 — USPTO ODP (future — patent content enrichment)

| | |
|---|---|
| **URL** | `https://data.uspto.gov/apis/getting-started` (JS-rendered; couldn't inspect via tooling; needs manual investigation) |
| **Format** | TBD |
| **Status** | **Deferred.** Patent content displayed today comes from ExPORTER's `Patents.csv` (patent_id, title, assignee from iEdison) + runtime deep-link to USPTO image-ppubs and patents.google.com. Quality is acceptable for the launch product. |
| **When to revisit** | If patent display becomes a sales pain point or if we want pending-application coverage |
| **Relationship to Source 5** | Same shape as Source 6 ↔ Source 8: ExPORTER carries the *NIH project ↔ patent linkage*; USPTO would carry richer *patent content* (titles, abstracts, classifications, assignees, pending applications). |

---

## Classification SOP

Classification is part of the project ingest pipeline, not a separate
source. It runs against whatever rows are in `projects` and writes
back `primary_category`, `primary_category_confidence`, `org_type`.

**One canonical classifier**, as of 2026-06-19: `etl/classifier.py`
exposes `classify_projects(projects, abstracts_map)` — Pass 1 is
deterministic activity-code routing in Python (training: T/F/K/D
prefixes + R25/R36/R38/R90/UE5/ZIE; infrastructure: P/S/G center
codes, U13/U24/U2C/U41/U42 cooperative agreements, ZIA/ZIC/ZIJ
intramural, N01/N02/OT2/OT3 contracts); Pass 2 is Claude Haiku 4.5
for content categories (basic_research, biotools, therapeutics,
diagnostics, medical_device, digital_health, other). Pass 1 routes
~40% of projects deterministically and skips the LLM entirely.

| Scenario | Tool | Notes |
|---|---|---|
| Bulk reclassify every row | `python3 etl/classify_projects_batched.py` | Wraps the canonical classifier. Invoked by `load_fiscal_year.sh` step 6. Use `--limit N` and `--dry-run` to sanity-check. |
| New awards from RePORTER API | `python3 etl/sync_projects_via_api.py` | Classifies inline as part of the catch-up; no extra step needed. |
| Newly-loaded rows from ExPORTER bulk | `python3 etl/classify_projects_batched.py` (post step 6 of `load_fiscal_year.sh`) | `load_to_supabase.py` no longer classifies inline; rows land with `primary_category = NULL`. |
| Fix NULL rows specifically | `python3 etl/reclassify_existing.py --where-null` | Targeted version of the bulk reclassifier. |
| Audit a single category (e.g. "other") | `python3 etl/reclassify_existing.py --current-category other` | Useful when category quality regresses on one slice. |
| Re-score low-confidence rows | `python3 etl/reclassify_existing.py --confidence-below 70` | Confidence ≤ 30 cases are the admin review queue. |
| Audit a single activity-code prefix | `python3 etl/reclassify_existing.py --activity-prefix K` | Useful for Pass 1 spot-checks. |
| Validate a prompt change | `python3 scripts/validate_classifier_prompt.py` | Replays a deterministic 500-project sample against `etl/category_disagreements_clean.json` and prints per-category accuracy + top mistakes. Use `--model <id>` to A/B different LLMs. |

`etl/reclassify_existing.py` always prints the matching-row count
and asks for confirmation before spending API budget; pass `--yes`
to skip the prompt, `--dry-run` to skip the write.

**What to never do.** The historical batch one-off scripts
(`reclassify_*.py`, `classify_batches_*.py`, `classify_semantic_*.py`,
etc.) have been archived to `etl/archive/2026-06-19_classifier_consolidation/`
and the historical docs to `docs/archive/2026-06-19_classifier_consolidation/`.
Don't resurrect them — re-running them would re-introduce the
inconsistent classification states the consolidation cleaned up. If
you need behavior that's not covered above, extend
`reclassify_existing.py` (add a new filter) rather than spinning
up a new script.

**Validation data.** `etl/category_disagreements.json` and
`etl/category_disagreements_clean.json` are gold-standard corrections
preserved from the March 2026 review. They're the validation oracle
for any future prompt change. Don't move or rename them.

**Design rationale.** `docs/CLASSIFIER_PROMPT_REVIEW.md` is the
itemized review that drove the prompt design (Pass 1 list,
biotools-vs-therapeutics distinctions, SBIR/STTR nuance, etc.).
Read it before changing the prompt.

---

## What this implies for the dashboard

The playbooks above are 9 sources. The dashboard at `/admin/data-sources`
needs to render them all coherently. Synthesizing the requirements:

### Per-source row, the dashboard must answer:

1. **What is this source?** Name, type (`ExPORTER_bulk` / `RePORTER_API` / `CT.gov_API` / etc.), URL, whether it's per-FY or all-time, what entities it covers.
2. **Where is upstream right now?**
   - For bulk: file `Last-Modified` timestamp from `HEAD` probe.
   - For API: most recent successful pull time, last queried date range.
3. **Where is our DB right now?**
   - Row count of the affected table(s)
   - Most recent `updated_at` in the affected table(s)
4. **What's the visible delta?**
   - From last diff run (if available): new / changed / orphan counts
   - From freshness probe alone (no diff): "upstream advanced N days ago, you haven't checked the delta yet" — soft signal
5. **What's running or has run?**
   - Active jobs hitting this source (real-time)
   - Last 5 job runs with status, duration, rows processed, errors
6. **Cost projection (when actionable):**
   - If a diff has been computed: "ingesting this delta will trigger ~N embeddings (~\$X) and ~M classifications (~\$Y)"

### Dashboard feature functions (compiled from the playbooks)

The dashboard is more than a read-only state display — eventually it
needs these *actions*, each gated behind explicit operator confirmation:

| Function | What it does | Triggers when |
|---|---|---|
| **Freshness probe** | `HEAD` each upstream URL, query DB counts, write to `data_source_state` | Daily cron, automatic. No operator action. |
| **Run diff** | Operator-triggered per source. Downloads the upstream file (for bulk sources), computes delta, writes structured result to `data_source_state`. Doesn't touch entity tables. | Manual button on the dashboard, OR scheduled when freshness probe detects upstream advance. |
| **Preview ingest** | Operator-triggered. Reads the latest diff result. Shows projected row counts + cost projection (embed/classify calls). Does NOT write to DB. | Manual button before any actual ingest, always. |
| **Run ingest** | Operator-triggered with explicit confirmation. Runs the delta-only ingest, logs to `etl_jobs`. | Manual, after Preview, never automatic. |
| **Per-source kill switch** | Disables freshness probe + ingest for a single source | Manual, used when something's broken upstream and we want to stop probing. |
| **Re-trigger downstream** | Operator-triggered. Re-runs embeddings / classification for a specific row or set of rows. | Manual, used to recover from a partial failure. |
| **Job history view** | Surfaces every `etl_jobs` row tied to this source with timestamps, status, error messages | Always visible. |
| **Cost ledger view** | Cumulative spend per source (estimated from job results' `embedded_count` × per-row cost) | Always visible. Monthly/weekly rollups. |

### Build order implication for the dashboard

The playbook-level functions don't need to all ship at once. Sensible
order based on what the playbooks reveal:

- **First:** Freshness probe + per-source state display (read-only).
  This is purely informational; covers 80% of what an operator needs to
  know.
- **Second:** Run diff per source (operator-triggered button). Delivers
  the actual truth that the freshness probe only hints at.
- **Third:** Preview ingest (cost projection). Risk-free because no DB
  writes; sets the operator up to make an informed decision.
- **Fourth:** Run ingest (with explicit confirmation). The first
  feature that actually writes to entity tables.
- **Fifth:** Job history view, kill switches, cost ledger, re-trigger
  downstream. Operational maturity features; ship as we feel the pain.

This order follows the principle from `DATA_PIPELINE_PLAN.md`:
*read-only diagnostics first, writes second*.

---

## Cross-source coordination rules

Some sources have ordering dependencies the dashboard must enforce or
warn about:

1. **Projects must be ingested before abstracts** for the same FY
   (FK dependency).
2. **Projects + publications must be ingested before link tables**
   for the same FY (FK dependency).
3. **Patents (Source 5) can be ingested independently** — no FK on
   project_patents that would block.
4. **Clinical studies (Source 6) can be ingested independently** —
   project_number is just an FK reference; missing project rows would
   just fail the FK and surface in the diff as orphans.
5. **RePORTER API (Source 7) and ExPORTER projects bulk (Source 1)
   may overlap.** If both ingest fresh data targeting the same
   `application_id`, the second-to-run wins. This is *fine* because of
   idempotent upsert — but the dashboard should make the timing
   transparent so we know which source ran more recently.

---

## How this complements the existing plan

`DATA_PIPELINE_PLAN.md` (the strategic plan) defines:

- What we're solving and why
- Principles we follow (small bites, no double-pay, etc.)
- The 6 build phases (Phase 0 defensive fixes through Phase 6 ExPORTER
  ingest path)

This doc (`DATA_SOURCE_PLAYBOOKS.md`) defines:

- Per-source how-to detail
- Dashboard feature requirements compiled from the per-source views

Together they should be enough that any future session — or any new
person — can pick up the data work without re-learning the constraints
from scratch.
