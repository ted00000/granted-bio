# Data Refresh SOP — 14SEP2026

Standard operating procedure for refreshing platform data. Covers both
the **catch-up** (one-time, bringing the DB current after the
2026-03-09 snapshot) and the **steady-state** (weekly refresh, same
flow at smaller volumes).

Re-date the header when revising.

Companion docs:
- [`DATA_SOURCE_PLAYBOOKS.md`](DATA_SOURCE_PLAYBOOKS.md) — per-source tactical reference
- [`DATA_PIPELINE_PLAN.md`](DATA_PIPELINE_PLAN.md) — strategic plan and phases
- [`NIH_REPORTER_DATA_FACTS.md`](NIH_REPORTER_DATA_FACTS.md) — upstream caveats

---

## Principles

1. **Signaling platform, not archive.** We capture enough to surface
   current activity and link out to authoritative sources. We do not
   try to mirror PubMed, USPTO, or ClinicalTrials.gov.
2. **Subset of fields per entity.** Each entity has a fixed list of
   fields the UI/reports actually consume (see "Field requirements"
   below). We ingest only those fields — PLUS the full raw API
   response (see principle 6).
3. **Per-project publication cap of 50, most-recent.** Center grants
   (P30/P50/U01/U54) can accumulate 1,000+ publications over a
   decade. We keep the 50 most recent per project; the platform
   never displays more than that anyway. Patents and trials have no
   cap (per-project counts are naturally small — max 4 patents,
   max 65 trials in the live DB).
4. **Retention window.** Current FY + 2 prior years (FY2024–FY2026
   today, shifts each Sep 30). Pre-window projects are ignored at
   ingest; pre-window publications/patents/trials are allowed as long
   as they link to a retained project AND make the per-project cap.
5. **Idempotent upserts.** Every write uses the entity's natural key.
   Re-running a step produces the same DB state. `updated_at` on
   unchanged rows is never touched.
6. **Always store the raw API response as `api_raw_data JSONB`.**
   Rule established 2026-09-14 after finding that every one-off
   backfill script we've written (`backfill_program_officers_api.py`,
   the aborted patent enrichment migration, etc.) exists because we
   didn't preserve the source response on original ingest. Storage
   is cheap; API calls are constrained. When we later discover we
   need a new field, we extract from stored raw (one-hour job)
   instead of re-hitting the source API for hundreds of thousands
   of rows (multi-day operation). Enforced across all four
   API-driven paths: `sync_projects_via_api.py`, `fetch_fy2026.py`,
   `enrich_clinical_trials.py`, `fetch_pubmed_metadata.py`, plus
   the patents ODP hydrator (`src/lib/patents/hydrator.ts`).

---

## Field requirements (what the platform consumes)

This is the authoritative list of what we ingest per entity. Anything
not on this list is **not ingested** even if the upstream provides it.

### Projects
- Identity: `application_id`, `project_number`
- Award: `activity_code`, `funding_mechanism`, `award_date`, `project_start`, `project_end`, `total_cost`, `direct_cost_amt`, `indirect_cost_amt`, `fiscal_year`, `foa_number`
- Content: `title`, `phr`, `terms`, `spending_categories` (NIH RCDC topic tags)
- People: `pi_names` (delimited), `contact_pi_name` (load-bearing PI, separately), `program_officer`
- Org: `org_name`, `org_type`, `org_city`, `org_state`, `org_country`, `org_zip`
- Administrative: `admin_ic` (Institute/Center abbrev), `study_section`
- Classification: `primary_category`, `primary_category_confidence` (set by the canonical classifier, not the upstream)
- Raw: `api_raw_data` (full RePORTER v2 response — see principle 6)

### Abstracts
- `application_id` (FK to projects), `abstract_text`, `abstract_length`

### Publications
- Identity: `pmid`, `pmc_id`
- Bibliographic: `pub_title`, `journal_title`, `journal_abbr`, `pub_year`, `pub_date`, `author_list`, `issn`, `affiliation`
- Derived flags (set at ingest by [`etl/process_publications.py`](../etl/process_publications.py) from journal + title keywords): `is_methods_journal`, `is_therapeutic_journal`, `is_computational_journal`
- **Not ingested:**
  - `abstract` — runtime-lazy via PubMed `efetch` ([src/lib/reports/agents/publications.ts:182](../src/lib/reports/agents/publications.ts#L182))
  - `pi_email` — separate enrichment, populated by a dedicated script
- Internal: `publication_embedding` (title-based, set by our embedding script)
- Raw: `api_raw_data` (full PubMed esummary record — see principle 6)

### project_publications (link table)
- Composite key: `(project_number, pmid)`
- `created_at`

### Patents
- Identity: `patent_id`, `application_number` (from USPTO ODP lookup)
- Bibliographic: `patent_title`, `patent_org`, `issue_date`, `filing_date`, `patent_type`, `patent_type_code`, `patent_status`
- People: `inventors[]`, `assignees[]` (original applicant), `current_assignees[]` (post-transfer owner)
- Prosecution: `examiner_name`, `art_unit`, `assignment_history` (JSONB — conveyance chain)
- Classification: `cpc_codes[]`, `uspc_code` (USPTO classifications), plus rule-based `is_device_patent`, `is_method_patent`, `is_therapeutic_patent`
- Ingest state: `api_last_updated`, `hydration_error`, `hydration_error_at`
- Raw: `api_raw_data` (bundle of ODP search + meta_data + assignment responses)
- **Not ingested at bulk time — lazy on view:** All ODP-hydrated fields (inventors, assignees, CPC codes, examiner, etc.) populate only when a user opens the patent detail page. See `src/lib/patents/hydrator.ts`. At 60 req/min per key, bulk backfill is not feasible (~42h dedicated key time for all 49K patents).
- Not ingested: `abstract` — some patents have it from a legacy NIH-linked load (~1% overall coverage, ~70% for report-surfaced patents); no active enrichment path.

### project_patents (link table)
- Composite key: `(project_number, patent_id)`
- `created_at`

### Clinical studies
- Identity: `nct_id`, `project_number`, composite unique `(nct_id, project_number)`
- Bibliographic: `study_title`, `study_status`, `phase`, `study_type`, `enrollment_count`, `start_date`, `completion_date`, `eligibility_criteria`, `brief_summary`, `api_last_updated`
- Sponsor: `lead_sponsor` (name), `lead_sponsor_class` (INDUSTRY / NIH / OTHER_GOV / NETWORK / OTHER), `collaborators` (JSONB [{name, class}])
- People: `overall_officials` (JSONB [{name, role, affiliation}] — source-truth trial PI attribution with role: PRINCIPAL_INVESTIGATOR / STUDY_CHAIR / STUDY_DIRECTOR)
- Purpose + rigor: `primary_purpose` (TREATMENT / PREVENTION / DIAGNOSTIC / SCREENING / SUPPORTIVE_CARE / HEALTH_SERVICES_RESEARCH / BASIC_SCIENCE / DEVICE_FEASIBILITY / OTHER), `allocation` (RANDOMIZED / NON_RANDOMIZED / NA), `intervention_model` (PARALLEL / SINGLE_GROUP / CROSSOVER / FACTORIAL / SEQUENTIAL), `masking` (NONE / SINGLE / DOUBLE / TRIPLE / QUADRUPLE), `has_dmc`
- Content: `conditions[]`, `interventions` (JSONB)
- Topic tags: `condition_mesh[]`, `intervention_mesh[]` (NIH MeSH descriptors from CT.gov's derivedSection — canonical vocabulary shared with PubMed)
- Endpoints: `primary_outcomes` (JSONB), `secondary_outcomes` (JSONB)
- Regulatory: `is_fda_regulated_drug`, `is_fda_regulated_device`, `why_stopped` (populated only on early-terminated trials)
- Legacy title-keyword flags (retained but no longer authoritative — prefer `primary_purpose`): `is_therapeutic_trial`, `is_diagnostic_trial`
- Raw: `api_raw_data` (full CT.gov v2 response)

---

## Order of operations

The refresh runs as a numbered sequence. Steps depend on earlier
steps as noted. Steady-state (weekly cron) and catch-up (one-time)
both follow this order.

| # | Step | Tool | Source | Dependency | Status |
|---|---|---|---|---|---|
| 1 | New project awards + abstracts | `etl/sync_projects_via_api.py` | RePORTER `/v2/projects/search` | — | ✓ Shipped |
| 2 | Publication links (per-project cap 50) | `etl/sync_publication_links.py` (NEW) | RePORTER `/v2/publications/search` | 1 | ✗ To build |
| 3 | Publication metadata | `etl/fetch_pubmed_metadata.py` (NEW) | PubMed `esummary` | 2 | ✗ To build |
| 4 | Embeddings (projects + new pubs, NULL-only) | `etl/generate_embeddings_batched.py` | OpenAI | 1, 3 | ✓ Shipped |
| 5 | Patents + project_patents | `scripts/diff-patents.ts` → `etl/load_patents_delta.py` | ExPORTER `Patents.csv` | — (independent) | ✓ Shipped |
| 6 | Clinical studies | `scripts/diff-clinical-studies.ts` → `etl/load_clinical_studies_delta.py` | ExPORTER `ClinicalStudies.csv` | — (independent) | ✓ Shipped |
| 7 | Trial content enrichment | `etl/enrich_clinical_trials.py` | ClinicalTrials.gov API | 6 (or runtime) | ✓ Shipped |
| 8 | Patent/trial embeddings (NULL-only) | `etl/generate_embeddings_batched.py --entity patents/clinical_studies` | OpenAI | 5, 6 | ✓ Shipped |

Steps 5 and 6 can run in parallel with 1-4; they only depend on the
ExPORTER files being downloaded. Steps 7 and 8 wait on their
upstream step.

---

## Per-step detail

### Step 1 — Projects + abstracts (RePORTER API)

`etl/sync_projects_via_api.py` pulls awards with `date_added >=
<floor>` and `fiscal_year` in the retention window. Maps API JSON
to the dict shape `load_to_supabase` expects, applies the
bio-boundary filter ([`etl/process_projects.py:is_bio_related`](../etl/process_projects.py)),
classifies inline via the canonical classifier
([`etl/classifier.py`](../etl/classifier.py)), upserts projects +
abstracts.

**API constraint:** maximum offset 14,999 → effective 15,000-row
per-query cap. If `meta.total > 15,000` for a single
`from_date`, **date-chunk** with `--to-date` to split the window.
The script supports both `--from-date` and `--to-date`. Verify the
total with a free probe before committing to a chunking scheme:

```bash
curl -s -X POST 'https://api.reporter.nih.gov/v2/projects/search' \
  -H 'Content-Type: application/json' \
  -d '{"criteria":{"fiscal_years":[2024,2025,2026],"date_added":{"from_date":"YYYY-MM-DD"}},"limit":1,"offset":0}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['meta']['total'])"
```

**Rate limit:** 1 req/sec per NIH guidance. The script sleeps 1.0s
between pages.

**Bio-filter pass rate:** ~85% historically (from window 1
dry-run: 8,940 kept / 10,519 fetched).

**Cost:** Haiku classification at ~$0.0001/proj; ~40% of projects
skip the LLM entirely (Pass 1 deterministic routing). For a 10k
window, ~$0.60.

**Run with `--dry-run` first** to surface counts before committing
to DB writes.

### Step 2 — Publication links (NEW)

`etl/sync_publication_links.py` to be built. For each
`project_number` we want to refresh links for, call:

```
POST https://api.reporter.nih.gov/v2/publications/search
{
  "criteria": { "core_project_nums": ["<core>"] },
  "limit": 50,
  "offset": 0,
  "sort_field": "pmid",
  "sort_order": "desc"
}
```

Where `<core>` is the project_number with funding-type digit prefix
stripped (`5U01DA041022-12` → `U01DA041022`). PMIDs are roughly
chronological, so `sort_field=pmid desc, limit=50` gives us the
**50 most recent** in a single call — this is how the per-project
cap is applied at the fetch stage.

Response per row: `{coreproject, pmid, applid}`. Upsert
`(project_number, pmid)` into `project_publications` with
`on_conflict='project_number,pmid'`.

**Rate limit:** 1 req/sec. For the catch-up over ~18.8K new project
awards: ~5.2h wall time.

**For the historical link backfill** (across all 154K projects, not
just new ones): ~43h wall time. This is a separate phase and
should run overnight.

### Step 3 — Publication metadata (NEW)

`etl/fetch_pubmed_metadata.py` to be built. For PMIDs that exist
in `project_publications` but not in `publications` yet, batch via
PubMed E-utilities `esummary`:

```
GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi
   ?db=pubmed&id=<pmid1>,<pmid2>,...&retmode=json
```

Up to 200 PMIDs per call. From the JSON, extract:
- `title` → `pub_title`
- `fulljournalname` → `journal_title`
- `source` → `journal_abbr`
- `pubdate` → `pub_year`, `pub_date` (parse the "2018 Aug" format)
- `authors[].name` → `author_list` (join with `;`)
- `articleids` where `idtype=pmc` → `pmc_id`
- `issn`, `essn` → `issn`

Apply [`etl/process_publications.py`](../etl/process_publications.py)
flag logic to set `is_methods_journal`, `is_therapeutic_journal`,
`is_computational_journal` from the journal + title keywords. Upsert
into `publications` on `pmid`.

**Affiliation** is available via `efetch` (separate, slower call).
Decision: skip at ingest, add later as a lazy enrichment if needed.

**Abstract** is already lazy-fetched at report time (existing
behavior).

**Rate limits:** 3 req/sec without API key, 10 req/sec with. For
~300-500K new PMIDs at 200/batch = ~2,000-2,500 calls = ~15-30 min.

### Step 4 — Embeddings (existing)

`etl/generate_embeddings_batched.py` in default NULL-only mode
embeds rows where the embedding column is NULL. Run after steps 1-3
so it picks up the newly-inserted projects and publications.

**Cost:** OpenAI text-embedding-3-small, ~$0.00002/embedding. For
20K new projects + 300K new pubs = ~$6.40.

### Steps 5-6 — Patents and clinical studies (existing, manual)

Run the existing delta-aware loaders against the latest ExPORTER
files. Both are all-time files; the delta scripts compute new
links against the DB state.

```bash
# Patents
npx tsx scripts/diff-patents.ts <path-to-Patents.csv>
python3 etl/load_patents_delta.py <path-to-Patents.csv>

# Clinical studies
npx tsx scripts/diff-clinical-studies.ts <path-to-ClinicalStudies.csv>
python3 etl/load_clinical_studies_delta.py <path-to-ClinicalStudies.csv>
```

These pick up any new (project_number, patent_id) and (nct_id,
project_number) pairs that didn't exist before — including those
tied to the newly-synced projects from step 1.

**ExPORTER refresh cadence:** not documented by NIH, but observed to
be **weekly** for both files. Confirmed observations:
- `Patents.csv`: 2026-06-14 release, 2026-06-21 release (7 days apart)
- `ClinicalStudies.csv`: same cadence — 2026-06-14, 2026-06-21

Treat as weekly refreshes (probably Sunday-night → Monday). Download
on Monday morning and run the diff + delta in the same Monday
maintenance window as the rest of the SOP. The deltas are small —
the 2026-06-21 release added 31 patents + 68 patent links + 23
clinical studies, plus 144 patent metadata changes and 82 trial
status updates. Quick to ingest.

**Clinical-studies batch size note:** the delta loader defaults to
upserting in 25-row batches, not 100. The composite-key ON CONFLICT
+ vector index update on `study_embedding` is heavy enough that
100-row batches reliably hit the PostgREST statement timeout.
25 works; if you ever see `code 57014` (`canceling statement due to
statement timeout`), drop further.

### Step 7 — Trial content enrichment (existing)

`etl/enrich_clinical_trials.py` queries ClinicalTrials.gov for
each NCT in our DB without `api_last_updated`, populates the rich
fields (phase, conditions, eligibility, etc.). Can also be left to
runtime enrichment ([src/lib/reports/agents/trials.ts:307](../src/lib/reports/agents/trials.ts#L307))
on first report demand.

### Step 8 — Patent + trial embeddings (existing)

Same script as step 4 with `--entity` flag. Title-only embeddings
for patents and trials.

---

## Catch-up run book (2026-06-21)

The catch-up brings the DB current from the 2026-03-09 snapshot
through today. Total ~18,792 new project awards expected, split
across two API windows due to the 15K offset cap.

### Pre-flight checks
- [ ] Confirm `.env.local` has `ANTHROPIC_API_KEY`,
      `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- [ ] Free probe to verify total counts:
  - Window 1 (2026-03-09 → 2026-05-15): expect ~10,519
  - Window 2 (2026-05-16 → today): expect ~8,273

### Sequence

1. **Projects + abstracts, window 1**
   ```
   python3 etl/sync_projects_via_api.py --from-date 2026-03-09 --to-date 2026-05-15
   ```
2. **Projects + abstracts, window 2**
   ```
   python3 etl/sync_projects_via_api.py --from-date 2026-05-16
   ```
3. **Build + run** `etl/sync_publication_links.py` for the new
   project_numbers from steps 1-2.
4. **Build + run** `etl/fetch_pubmed_metadata.py` for the new PMIDs.
5. **Embeddings:**
   ```
   python3 etl/generate_embeddings_batched.py
   ```
6. **Patents:** download latest `Patents.csv`, run diff + delta.
7. **Clinical studies:** download latest `ClinicalStudies.csv`, run
   diff + delta.
8. **Trial enrichment** (optional — runtime path also works).

### Post-flight verification

- [ ] `SELECT COUNT(*) FROM projects WHERE date_added >= '2026-03-09'` → ~16-17K (after bio filter)
- [ ] `SELECT COUNT(*) FROM project_publications WHERE created_at > '2026-06-21'` → tens of thousands
- [ ] Spot-check a few projects on the live site to confirm linked content displays
- [ ] **Bump landing-page hero stats.** `src/app/page.tsx:17-22` has a
      hardcoded `const stats = [...]` with rounded totals for NIH
      Projects, Patents, Publications, and Clinical Trials. After
      each refresh, re-check DB counts and update any that ticked
      into a new K-rounded value. Small weekly deltas usually don't
      cross a K boundary — only bump when they do.

---

## Steady-state operation

Once the catch-up is complete, the same flow runs weekly. Suggested
schedule:

- **Mon 06:00 ET:** projects + abstracts (RePORTER API refreshes
  Sun night per the FAQ)
- **Mon 06:30 ET:** download fresh `Patents.csv` + `ClinicalStudies.csv`
  from ExPORTER (also appears to release weekly — see Steps 5-6).
  Run diff + delta loaders against the new files.
- **Mon 07:00 ET:** publication links + metadata (depends on
  step 1 completion)
- **Mon 08:00 ET:** embeddings (depends on steps 1-3, 5, 6)

Weekly volumes are tiny (~100-500 new awards/week historically;
larger during shutdown push-throughs). The 1-hour staggering covers
slow runs without overlap.

### Phase 5.2 reminder

The Vercel cron wiring for steady-state isn't built yet — sync runs
manually until then. See [`DATA_PIPELINE_PLAN.md`](DATA_PIPELINE_PLAN.md)
Phase 5.

---

## Historical link backfill (separate phase)

The 1,036 (API) vs 223 (DB) gap for one ABCD project signals that
our existing project–publication link coverage is significantly
behind, not just for new awards. A one-time backfill of step 2
across all 154K projects (with the 50-cap policy in place) recovers
this.

- **Wall time:** ~43h at 1 req/sec
- **Expected output:** ~1.5M total link rows (vs current 307K), most
  growth from existing center-grant projects that were undercollected
- **Cost:** zero (free API)

Run this once after the catch-up validates the new scripts.
Probably as an overnight job. Re-running is safe — upserts are
idempotent.

---

## Historical raw-data backfill (separate phase)

Every API-driven ETL now writes `api_raw_data JSONB` on every new or
updated row (see principle 6). Rows synced BEFORE 2026-09-14 have
`api_raw_data = NULL` and can't be filled from local state — the raw
response wasn't preserved at the time.

Consequence: any future column addition on `projects`, `publications`,
or `patents` will only auto-populate on rows touched since 2026-09-14.
Historical rows require a targeted re-fetch.

For projects specifically, the historical gap can be closed by:

```bash
python3 etl/sync_projects_via_api.py --refresh-all
```

- **Scope:** every project row currently in the DB (~200K)
- **Wall time:** ~55h at 1 req/sec
- **Effect:** re-fetches the RePORTER response for every project,
  writes `api_raw_data` and re-populates every extracted column
  (including the RePORTER audit fields added 2026-09-14:
  `contact_pi_name`, `admin_ic`, `foa_number`, `direct_cost_amt`,
  `indirect_cost_amt`, `study_section`, `spending_categories`)
- **Cost:** zero (free API)
- **When to run:** once, opportunistically. Not required — the
  quarterly refresh covers new rows on its own.

The `--refresh-all` flag doesn't exist yet; it's a planned extension
to `sync_projects_via_api.py`. Alternative today: a one-off script
that iterates project_numbers and calls the transform. Same effect.

For `publications` and `patents`, the analogous historical refresh
would be `fetch_pubmed_metadata.py --refresh-all` (~30 minutes for
300K rows at 10 req/s with NCBI key) and USPTO ODP lazy hydration
which is per-view by design (never bulk-refresh).

---

## What's explicitly NOT in this SOP

- USPTO patent content enrichment (deferred — current patent display
  is acceptable via runtime image-ppubs link-outs)
- PubMed `efetch` for affiliation strings at ingest time (defer to
  lazy enrichment if/when product needs it)
- Re-embedding rows whose content didn't change (Phase 3 of
  `DATA_PIPELINE_PLAN.md` — `embed_content_hash` skip-guard)
- Re-classifying rows whose content didn't change (same Phase 3
  pattern with `classify_content_hash`)
- Per-project caps on patents or clinical studies (not needed — DB
  shows max 4 patents and 65 trials per project; no long tail)
- Mirroring full PubMed / USPTO / CT.gov records. We capture the
  fields the platform displays; users link out for everything else.
