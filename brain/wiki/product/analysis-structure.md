# Analysis structure

What a generated granted.bio analysis contains and how each section is
produced. Sourced from `src/lib/reports/` (synthesis + section generators),
`src/lib/inngest/functions.ts` (orchestration), and the section render
pages under `src/app/reports/[id]/*/`.

Model names and prompt-level constraints are durable enough to belong
here. Concrete token counts and per-section max-token budgets can shift;
the current values in this file reflect the code at reconnaissance time.

## What generation requires

A user submits a topic (free text). Everything else is derived.

Auth and payment gates are enforced in `POST /api/reports`:

1. Supabase auth required (401 if unauthenticated).
2. Beta-tier users: 3-report lifetime cap enforced by
   `user_profiles.tier = 'beta'` + `beta_expires_at > now()`.
3. Non-admin, non-beta users must have a completed `report_purchases` row
   for the specific topic. Admin and beta users bypass payment.
4. Persona: `researcher` (default) or `investor` — a runtime toggle that
   changes section framing, not which data is fetched.

**Any authenticated, paying user can generate an arbitrary topic
themselves.** There is no operator-only generation path in the code. The
platform-pass model provisions credits (`report_credits`) that any user
can spend.

Admins/associates can bypass payment; when they do, a shadow credit
ledger row is written for audit.

## Interpretation step (pre-flight)

Before the expensive generation, the user picks one of three
interpretations of their topic. Handled by
`/api/reports/interpret-topic`:

1. Claude Haiku 4.5 generates three candidates labeled NARROW, STANDARD,
   BROAD, each with a `semanticQuery` (natural language for embedding
   search) and a `keywordQuery` (pipe-separated terms).
2. Three parallel semantic project counts against the projects index
   (capped at 500 per query for the preview).
3. Claude Sonnet 4.6 critiques the three and recommends one based on
   count deltas and vocabulary fit.
4. Response returns the interpretations + counts + recommendation.

Topic-relevance gate `check-topic`: if project count for any
interpretation is < 5, `data_limited` is set on the eventual report row.
A scope-relevance signal (`computeTopicRelevanceSignal`) also tags the
topic as `off-topic`, `weak`, `moderate`, or `strong` based on the
on-topic ratio of surfaced projects against the topic's core tokens.

## Orchestration

Once the user commits, `POST /api/reports` writes a `status='generating'`
row into `user_reports` and enqueues an Inngest event
`report.generate.requested`. The Inngest function
(`src/lib/inngest/functions.ts`) runs four phases (down from five as of
2026-09-20 — Phase 5 was merged into Phase 4; see architecture note
below):

- **Phase 1 — Projects agent.** Semantic + keyword search against
  `projects.abstract_embedding` (HNSW). Returns the set of projects the
  rest of the report is built from, plus their `project_number`s for
  downstream fanout. Two paths:
  - Path 1: `search_projects_filtered` RPC (semantic vector match).
  - Path 2 (added 2026-09-18): MeSH/RCDC rescue — projects whose
    `spending_categories` overlap the topic's Haiku-extracted MeSH.
    Currently near-zero yield due to sparse coverage; reserved for
    after the historical RePORTER backfill.
- **Phase 2 — Data agents in parallel.**
  - Trials agent: three paths — Path 1 (project-linked), Path 2
    (semantic-title match), Path 3 MeSH rescue (added 2026-09-18) —
    trials whose `condition_mesh` ∪ `intervention_mesh` overlaps the
    topic-extracted MeSH descriptors. On broad topics this can add
    30-40% more trials than Path 1+2 alone.
  - Patents agent: project_number join to `project_patents` → `patents`.
    Detail-page enrichment is lazy-on-view via USPTO ODP, not bulk.
  - Publications agent: project_number join to `project_publications` →
    `publications`. Now selects `mesh_terms` (added 2026-09-20) and
    aggregates them into `topMeshTerms` and `meshCoverage` for
    downstream cross-source signals.
  - Market agent: Claude Sonnet 4.6 with the `web_search` tool — this
    call goes to the open web, not to the index.
- **Phase 3 — Aggregation** (deterministic, no LLM). Compute funding
  stats, deduplicate and roll up organizations and researchers from the
  project set's `org_name` / `pi_names` strings.
- **Phase 4 — Synthesis + persist.** The heavy LLM phase (~9 Sonnet
  calls in parallel, plus lint retry and optional Opus audit). At the
  end of Phase 4, the completed report is written to `user_reports`
  inline. Phase 4 returns `{ ok: true }` — a tiny payload Inngest can
  trivially checkpoint.

**Architecture note (2026-09-20).** Phase 5 was previously a separate
"persist" step that received `{ reportData, agentOutputs }` from Phase 4
as an Inngest step return. On broad topics that payload exceeded
Inngest's step-state size limit (~4 MB) and the boundary threw "error
validating generator opcode" — Inngest retried the whole synthesis, hit
the same limit, retried again → three retries × ~10 min = 30-45 min
loop with 2-3× the LLM cost. Merging save into Phase 4 keeps the
multi-megabyte object out of Inngest's checkpoint entirely. Same DB
writes, same columns, no feature loss.

## Sections produced

Every section is generated in Phase 4 unless noted. The Dashboard is a
render-time composition, not a distinct generation step.

### Dashboard tiles

Six metric tiles rendered at `src/app/reports/[id]/DashboardTiles.tsx`.
Deterministic — no LLM.

- Projects count + total funding
- Trials count + top phase
- Patents count
- Publications count
- Organizations count
- Researchers count

Funding-by-year delta is computed with a two-point guard that skips the
current partial FY.

### Executive Summary + Next Steps

Combined narrative rendered on the dashboard.

- Model: Claude Sonnet 4.6.
- Input: funding stats (total, projectCount, orgCount, piCount, byYear,
  byCategory), trial phase and status breakdowns, top-10 patent + top-15
  trial summaries, market-context overview, and — added 2026-09-14 to
  2026-09-20 — a large audit-cycle block:
  - **Trial primary purpose split** (source-truth from
    `primary_purpose`, verbatim counts required).
  - **Lead sponsor mix** (source-truth from `lead_sponsor_class`).
  - **Trial rigor evidence**: randomized-N, double-blinded-N,
    DMC-present-N, FDA-regulated-drug-N, FDA-regulated-device-N,
    industry-collaborator-N, early-terminated-N (all of / N total).
  - **NIH admin_ic split** (which institute administers each grant).
  - **FOA clustering** (grants under the same funding opportunity call,
    surfaced when ≥3 grants share an FOA).
  - **Spending categories** (NIH RCDC tags — top 10 across sample).
  - **Publication MeSH descriptors** (top 10 with coverage denominator).
  - **Cross-source MeSH overlap** — descriptors that appear on both the
    surfaced trials AND the surfaced publications, with per-side counts.
    This is the research-to-translation-alignment signal.
- Output shape: three paragraphs (~250 words). Paragraph 1 = hardest
  quantitative facts. Paragraph 2 = positioning cleavages, project/org
  names allowed for factual concentration. Paragraph 3 = persona-specific
  watchpoints.
- Enforced constraints (in the prompt): no AI tell-tale phrases; if
  citing two years side-by-side, must append the two-point trend hedge;
  no approximations for category shares (verbatim from `byCategory`);
  trial status uses the compact form `N in progress/planned/completed vs
  M terminated/suspended/withdrawn (total)`; do not attribute
  terminations to a cause without evidence. Purpose framing rule (added
  2026-09-14): if citing "N therapeutic trials", MUST use the TREATMENT
  count from `primary_purpose`, NOT the legacy `is_therapeutic_trial`
  boolean.
- Next Steps is a separate Sonnet call (6–8 action items). Banned:
  named PIs/institutions as targets, "scout collaborators / reach out
  to / entry point / access node" language, prescriptive targeting of
  specific institutions.
- Validity: `assertReportComplete` throws if Executive Summary is < 600
  body chars.

### Industry Engagement (deterministic block, added 2026-09-14)

- Location: `renderIndustryEngagementSection` in
  `src/lib/reports/synthesize.ts`. Not an LLM section — pure formatting
  over trial-quality pack data.
- Content: three-line breakdown of the sample's trial pipeline —
  industry-lead / academic-with-industry-collaborator /
  academic-or-NIH-only, with counts and percentages. Names industry
  lead sponsors and industry collaborators when the sample surfaces
  them. Notes when coverage is thin (older trials predate CT.gov's
  sponsor classification).
- Method disclosure inline: cites the exact CT.gov API path
  (`sponsorCollaboratorsModule.leadSponsor.class` and
  `collaborators[].class`) so a reader can trace the number back to
  source.

### Terminated Trials Callout (deterministic block, added 2026-09-14)

- Location: `renderTerminatedTrialsCallout` in synthesize.ts.
- Fires when any surfaced trial carries `why_stopped` populated. Lists
  representative reasons (accrual, funding, sponsor decision, safety)
  without naming specific trials.
- Purpose: gives the "N terminated/suspended/withdrawn" number in the
  compact status form real substance without cherry-picking.

### What Surprised Us

- Located at `src/lib/reports/surprising.ts` and rendered at
  `/reports/[id]/surprising`.
- **Detection is algorithmic**, not LLM. Five anomaly classes evaluated
  against the project/org/researcher aggregates:
  1. Translation-gap orgs (≥ $3M NIH funding but 0 patents + 0 trials).
  2. Isolated top-funded PIs (single very large grant, no linked outputs).
  3. Pub-heavy vs clinically-thin subsets.
  4. Broader-NIH gap categories (a category where broader NIH activity
     exceeds the topic sample by ≥ 100×).
  5. Recency skew (portfolio funding leans very recent or very old).
- Top-4 findings by strength score, diversified so no more than 2 come
  from any one class.
- Claude Sonnet 4.6 is called only to narrate the algorithmically
  detected candidates — it does not invent findings.
- Returns an empty list if no candidates cross threshold.

### Field Maturity

- Located at `src/lib/reports/synthesize.ts` (~lines 1454–1710) and
  rendered at `/reports/[id]/field-maturity`.
- Estimates a TRL (Technology Readiness Level) range with confidence
  tags and a historical benchmark.
- Inputs (all deterministic counts): publication total + preprint ratio;
  trial `byPhase` and `byStatus`; patents total + recentCount (last 2
  years); funding by year and by category.
- Model: Claude Sonnet 4.6.
- Small-N guards baked into the prompt: `< 10 pubs` cannot support
  preprint-ratio inference; `< 5 patents` cannot support recency-based
  claims; `< 3 trials` cannot support phase-distribution inference.
- Every claim must carry a `Confidence: High/Medium/Low` tag and an
  `Evidence:` line with concrete counts.
- Output fields: `trlEstimate`, `maturityNarrative`,
  `benchmarkComparison`, `evidenceSummary` (per-signal confidence),
  `strategicImplications` (persona-appropriate), `overallAssessment`
  (nascent / emerging / maturing / established).
- Validity: `assertReportComplete` requires the section, ≥ 800 body chars,
  a TRL citation, and a Strategic Implications sub-section.

### Funding Landscape

- Rendered at `/reports/[id]/funding`.
- Data-driven: uses `fundingStats.byYear`, `byCategory`, `byOrg`
  (deterministic aggregates from Phase 3).
- LLM (Claude Sonnet 4.6) only writes the narrative around the counts —
  the numbers themselves are hardcoded from the aggregates. The prompt
  explicitly forbids the LLM from deciding counts.
- Charts: funding by year, category distribution, top orgs by funding.

### Competitive Topology

- Located at `src/lib/reports/synthesize.ts` (~lines 1713–1910) and
  rendered at `/reports/[id]/competitive-topology`.
- Groups the surfaced work into 3–5 methodological/technical clusters
  with key players per cluster, maturity level, commercial readiness, and
  strategic implications.
- Inputs: top-30 projects by funding (with title, org, abstract, match
  tier), top-15 patents, top-10 trials, top-10 orgs by funding.
- Model: Claude Sonnet 4.6, `max_tokens 3500`.
- Enforced constraints: `keyPlayers` must all appear in the surfaced
  project list; commercial players not in the NIH sample must be tagged
  `(commercial, not in NIH sample)`; strategic implications must not
  name institutions (adjacency rule — recommendations render right
  under the clusters, so implicit references still count as a violation).
- Graceful degradation if the LLM truncates mid-JSON: best-effort salvage
  of the completed cluster objects.

### White Space

**The central positioning claim. Documented precisely below.**

Located at `src/lib/reports/white-space.ts` and rendered at
`/reports/[id]/whitespace`.

Derived in five steps, most of them **deterministic against the DB, not
LLM**:

1. **Infer a topic-adaptive taxonomy.** Claude Sonnet 4.6 reads the topic
   plus 25 sample project titles (and up to 30 abstracts) and proposes
   up to 5 dimensions × 12 categories. Each category has a name,
   description, and a list of match keywords. A self-check loop verifies
   the taxonomy covers the topic's core tokens (e.g., "cell-free" for
   "cell-free antibody engineering"); if any core token is missing, the
   taxonomy is regenerated once with explicit feedback.
2. **Deterministic sample counting.** For each dimension × category,
   count matches by keyword-matching the sample projects' titles +
   abstracts. Multi-word / hyphenated keywords use substring match;
   single tokens require word boundaries. Minimum keyword length is 3
   characters.
3. **Unclassified expansion.** If a dimension has too many unclassified
   projects, ask Claude to look at those specifically and propose
   additional categories; re-count the sample.
4. **Broader-NIH cross-reference.** For each category keyword set, run a
   count query against the **full projects table**, filtered by a
   topic-scope keyword set (which Claude also proposes in step 1 — e.g.,
   "cancer research", "drug discovery") to keep the denominator sane.
   These queries are chunked to 500 per batch. A denominator count of
   all projects matching the topic-scope filter is also computed.
5. **Opportunity ranking + LLM narrative.** Categories where the sample
   share is < 8% AND the broader-NIH count is > 5× the sample count
   become candidate "white-space opportunities". Claude Sonnet 4.6 then
   writes the overview, per-dimension narrative, per-opportunity
   narrative, and strategic implications — instructed to reference the
   deterministic counts and not invent them.

Outputs on the report: `overview`, `dimensions[]` (each with
`categories[]` carrying `sampleCount` and `broaderNihCount`),
`topOpportunities[]`, `scopeNote`, `topicRelevance`,
`strategicImplications`.

Important properties:

- The taxonomy is generated per topic; there is no fixed global
  ontology. Two runs of the same topic can propose different dimension
  names.
- The "broader NIH" denominator is scope-filtered but still keyword-based
  — it's a directional signal, not a strict comparable.
- Categories are marked as opportunities only when both a sample-share
  test AND a broader-NIH multiplier test pass.

### Market Context

- Located at `src/lib/reports/agents/market.ts` and rendered inline in
  the Executive Summary and at `/reports/[id]/market`.
- **Live web search** via Claude Sonnet 4.6 with the `web_search` tool.
  Does NOT use the granted.bio index.
- Retry: if the first pass returns no sources / no key players / no
  recent developments / < 100 chars competitive landscape, the call is
  retried once with an explicit "YOU MUST use web_search" directive.
- After 2 attempts, if still thin, the whole synthesis throws (Inngest
  retries at the phase level).
- Output: `overview`, `keyPlayers[]`, `recentDevelopments[]`,
  `competitiveLandscape`, `marketSize` (nullable), `sources[]` (title +
  URL).
- Validity: `assertReportComplete` requires at least 2 of 3 structured
  sub-sections and at least one live URL source.

## LLM models used

| Purpose | Model |
| --- | --- |
| Topic interpretation (3 candidates) | Claude Haiku 4.5 |
| Interpretation critique | Claude Sonnet 4.6 |
| Executive Summary | Claude Sonnet 4.6 |
| Section insights (funding, trials, patents, pubs) | Claude Sonnet 4.6 |
| Field Maturity | Claude Sonnet 4.6 |
| Competitive Topology | Claude Sonnet 4.6 |
| IP Landscape | Claude Sonnet 4.6 |
| Signals Analysis | Claude Sonnet 4.6 |
| Curated Publications | Claude Sonnet 4.6 |
| Market Context (with `web_search`) | Claude Sonnet 4.6 |
| White Space taxonomy inference | Claude Sonnet 4.6 |
| White Space narrative | Claude Sonnet 4.6 |
| Surprising narrative | Claude Sonnet 4.6 |
| Next Steps | Claude Sonnet 4.6 |
| Lint retry (fix section-level violations) | Claude Sonnet 4.6 |
| Audit-agent semantic review (optional) | Claude Opus 4.8 |
| Relevance rerank (trials, patents) | Claude Sonnet 4.6 |
| Semantic-search embeddings | OpenAI `text-embedding-3-small` |

Environment flags controlling optional passes:

- `LINT_RETRY_ENABLED` — enables a Sonnet retry pass after regex lint
  violations. Default enabled.
- `AUDIT_AGENT_ENABLED` — enables the Opus semantic review pass.
  Currently **ON** in production (as of 2026-09-20). Adds ~$0.83 per
  report and catches semantic violations regex can't (Dimension 8
  patent-shape claims, Dimension 3 "clear gap" absolutes, Dimension 5
  "collaboration target" nouns, etc.).

## Post-synthesis gates

Before writing the report, four gates run:

1. **Regex lint** (`src/lib/reports/lint-report.ts`). Deterministic rules
   for AI-tell phrases, unsupported absolutes ("clear gap", "structural
   underfunding"), sample-total figures attached to category names
   without subset attribution, collapsed trial-status phrasings.
2. **Lint retry #1** (Sonnet, ≤ 240s budget). If any critical violations
   remain, one section-scoped retry pass attempts to fix them.
3. **Opus audit-agent** (when `AUDIT_AGENT_ENABLED=true` — currently ON).
   Full-markdown semantic review by Opus 4.8; applies corrections
   inline. Documented dimensions include Dimension 8 (patent-shape
   claims), Dimension 3 ("clear gap" absolutes), Dimension 5
   ("collaboration target" noun forms), Dimension 2 (named clinical
   program symmetry). ~$0.83 per report.
4. **Lint retry #2** (Sonnet). Post-audit re-lint; if audit-agent
   introduced a NEW critical violation, one more section-scoped retry.
5. **Completeness gate** (`assertReportComplete`). Throws on:
   - Executive Summary missing or < 600 body chars.
   - Field Maturity missing, < 800 body chars, no TRL cited, no Strategic
     Implications sub-section.
   - Market Context missing, < 2/3 structured sub-sections, or no live URL
     sources.
   - Research Positioning or Investment Signals section (depending on
     persona) missing or < 400 body chars.
   - **NIH Funding Landscape / NIH Funding Analysis** (persona-dependent
     heading) missing or < 400 body chars, or missing the Funding
     Summary table.
   - Clinical section missing (renders empty-state notice if no trials).
   - Competitive Topology missing.
   - Key Research Projects with < 3 projects rendered.
   - White Space Analysis missing or < 500 body chars.

If any gate throws, Inngest retries the whole synthesis (default 2
retries). If retries exhaust, the report row's status flips to `failed`
and the user gets a retry credit automatically.

**Historical incident (2026-09-18).** `generateSectionInsights` was
using raw text→JSON regex parsing on Sonnet's output. On broad topics
Sonnet's output failed the regex, `insights.funding` returned empty
string, `renderFundingLandscape` emitted only the Funding Summary table
(~60 chars body), completeness gate threw, Inngest retried the whole
synthesis three times before giving up (~45 min, 2-3× LLM cost).
Migrated all JSON-emitting synthesis callsites to Anthropic tool_use
(`generateStructured` in `src/lib/reports/llm-json.ts`) — the SDK
validates the JSON shape at the API layer, no regex, no fallback path.
See commit `cf2fa55`.

## Refresh vs retry

Both flows regenerate an analysis but with different semantics.

| | Refresh | Retry |
| --- | --- | --- |
| Trigger | User clicks "Refresh" on a completed report | User reports feedback via "Refine" |
| Interpretation | Reuses original semanticQuery/keywordQuery | Claude proposes 3 NEW interpretations from the feedback |
| Freshness | Same interpretation vs current NIH data | Same or newer NIH data + revised interpretation |
| Entitlement | Refresh credit, bound to the original report (one per purchase) | Retry credit (one per report; auto-granted on failure or self-serve within 14 days) |
| Effect on original | Original preserved | Original preserved |

Neither operation modifies the original report row; both create new
`user_reports` rows.
