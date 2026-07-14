# Parking Lot — 14JUL2026

Consolidated nice-to-haves accumulated during the multi-month pre-launch
build. Pulled from `LANDING_AND_CREDITS_PLAN.md`, `PLATFORM_PLANNING.md`,
code comments, commit history, and session memory. Re-date the header
when revising so we can tell what's drifted.

---

## Product growth

- **Bulk pricing SKUs** (Phase 5 in `LANDING_AND_CREDITS_PLAN.md`) —
  5-pack / 10-pack with toggle UI, volume discount math; "TBD when
  volume justifies it."
- **Enterprise / BD motion** — separate from the BD persona; contact-sales
  flow for large-volume contracts.
- **Alerts** — email on new NIH-RePORTER matches for a saved topic.
- **Saved searches** — persistent topic subscriptions.
- **API access for enterprise** customers.
- **CRM integration**.
- **BD lens / persona** — explicitly deferred from launch (see
  `project_persona_priority.md` memory). Reintroduce if/when the motion
  shapes up. Requires audit of pricing FAQ, lens picker, and persona
  cards before re-enabling.

## UX polish

- **Real multi-level breadcrumbs** — back button shipped as the
  launch-day simpler fix. Real breadcrumbs would render the full
  `Search › Org › Project › Patent` trail. Requires sessionStorage
  trail tracking + reset on top-level routes + handling of refresh /
  deep-link cases.
- **AuthContext cache hydration** — write last-known auth state to
  localStorage so detail pages render the authed UI instantly on cold
  load instead of waiting on `getUser + fetchProfile`. We already
  pulled `fetchUsage` out of the critical path on 2026-06-16; this
  is the remaining headroom.
- **Sample page soft-gate drill-down** — code comment in
  `src/app/sample/liquid-biopsy/page.tsx:11` says "will ship in a
  follow-up." Internal report links currently route through the full
  auth flow; the wireframe promised an in-place preview gate.
- **Unified component library** — parking-lot item from
  `PLATFORM_PLANNING.md` §9.9. Trigger: next major UI refactor.
  Standardize buttons, cards, modals into a single primitive set.
- **More public sample reports** — add 2–3 more in different fields
  (therapeutics, brain organoids, biotools) so visitors see breadth,
  not just liquid biopsy. Each new sample needs a `SAMPLE_REPORT_ID`
  constant + a route under `/sample/`.

## Operational / process

- **Refresh-smart timing** — what counts as "material new data" worth
  nudging a refresh? Plan suggests: new projects with similarity ≥
  0.50 OR newly-linked Phase 3+ trial. Needs concrete threshold spec
  before any nudge ships. From `LANDING_AND_CREDITS_PLAN.md` Open
  Questions §14.
- **PDF re-issuance on refresh** — keep original as `v1.pdf`, generate
  new one. Needs storage + versioning spec. From plan §14.
- **Refund escalation policy** — users who want money back instead of a
  retry. Plan suggests 7-day full refund window, manual processing
  via `hello@granted.bio`. Needs Terms language + ops runbook.
- **Credit purchase confirmation page** — after Stripe success,
  suggested `/welcome` page showing "1 report ready" with topic-picker
  route instead of bouncing straight to `/reports`. From plan §14.

## Admin tooling

- **`/admin/feedback` iteration** — basic table shipped 2026-06-16. Add
  category filtering, date range, CSV export once a few weeks of data
  has accumulated.
- **Recovery-cron observability** — surface stuck-purchase recoveries
  in admin (`/admin/recovery` or merged into existing dashboards)
  instead of only Vercel function logs.

## Report content — founder-persona grade (A-) feedback

An external Sonnet playing the role of a life-sciences-tools founder
graded the r51/3D Spatial Multiomics report an A- at $199. Notes below
are the improvement callouts, ranked by impact.

- **Commercial Opportunity Map (new section) — highest-leverage add.**
  Matrix table: Opportunity × Attractiveness × Competition × NIH
  Momentum × Commercial Readiness, one row per methodological cluster.
  Founder said "would likely become the most-read page." Signals we
  already compute (funding shares from `byCategory`, patent counts,
  trial counts by cluster, competitiveTopology maturity labels,
  keyPlayers from market context) — the missing piece is a scoring
  synthesis + a compact interpretive paragraph per row. Investor
  persona first; could adapt for researcher/BD later.

- **Confidence tag noise (10-15% of report).** Every substantive claim
  currently gets its own `**Confidence: Medium** - Evidence: [...]` tag,
  which was defensible per-claim but reads as visual clutter across a
  50-page report. Fix: one section-level Confidence tag at the end of
  each section + a compact inline icon on individual claims that
  expands on hover/tap in the web view. The evidence detail migrates
  from inline paragraph to a tooltip/footnote. Retain the per-claim
  tag structure in the underlying data model so linter rules still
  fire, but change the render.

- **Empty-taxonomy tables (0/0/0/0 rows).** White Space Analysis emits
  rows for every classified dimension category, so dimensions with
  mostly-empty categories produce pages of "0 projects" rows followed
  by explainer text. Fix: collapse below-threshold categories into a
  single "N categories below the reporting threshold - see full data
  in [expanded view]" summary row per dimension. Preserve the raw
  counts in the underlying data model.

- **Disclaimer text compression.** "What This Report Does Not Cover" +
  per-section `*Note: This analysis includes only...*` italic callouts
  stack up across sections and read as several pages of caveats. Fix:
  consolidated single "Methodology & Coverage" page (linked from the
  top), per-section notes shortened to one line referencing the page.

- **Formulaic prose (audit before touching).** Founder flagged
  repeated "Within the analyzed sample...", "This suggests..." patterns
  as AI-tell. Half of these are the linter's fault - we ENFORCE
  "within the sample" scoping to prevent field-level absolute claims.
  Compressing 25% risks regressing against ban-catalog rules. Do NOT
  bulk-rewrite; instead audit each formulaic phrase's linter rationale
  and remove only the ones that aren't rule-driven.

## PDF rendering

- **Replace jsPDF with Puppeteer + HTML/CSS Paged Media.** Current PDF
  export in `src/app/reports/[id]/page.tsx` is a ~1200-line
  hand-coded jsPDF layout. Every wrapping edge case is a potential
  bug (r51 3D Spatial report had a Competitive Landscape paragraph
  running past the footer; commit `61a7208` fixed that class by
  switching paragraphs/bullets to line-by-line rendering, but the
  fundamental approach — imperative layout with manual page-break
  reservations — is fragile for anything new we add. Real fix:
  markdown → HTML (marked or remark) → styled with brand CSS →
  Chromium headless renders via `puppeteer-core` + `@sparticuz/chromium`
  inside a new Inngest step after synthesis. Real CSS Paged Media
  (`@page`, `page-break-inside: avoid`, widow/orphan control, running
  headers/footers), styling matches the web report exactly, PDF
  gets uploaded to Supabase Storage once and served via signed URL
  (client-side generation delay goes away). ~1-2 hrs implementation
  + testing. Trigger: any new PDF layout bug OR the first time we
  need a typographic feature jsPDF can't deliver (footnotes, running
  section headers, precise table pagination, etc.).

## Data pipeline

- **Backfill patent `issue_date` + `filing_date`** — 0 / 49,557 rows in
  the `patents` table have either column populated (verified 2026-07-13),
  so the report Date field was uniformly "Not on record" until it was
  dropped from the render in commit `4229792`. USPTO exposes both dates
  freely via PatentsView (`patents` endpoint) and the USPTO PatentSearch
  API — schema already has the columns, upstream loader just isn't
  writing them. Once backfilled, restore the Date line in
  `src/lib/reports/synthesize.ts` patent render (currently gated behind
  `if (p.patent_date)`) and the two prompt payloads at lines ~547 and
  ~1780.

## Tech debt / parking lot

- **React Query adoption** — parking-lot item from
  `PLATFORM_PLANNING.md` §9.9. Trigger: caching/deduplication pain.
  Would replace manual `fetch` calls, add auto-refetch.
- **Application-level Resend wiring** — per `project_resend_setup.md`
  memory, the Resend SDK is in `package.json` but nothing in `src/`
  imports it. Future transactional flows (contact-form notifications,
  "report ready" emails, receipts) need per-flow API keys configured
  before they can ship.

## Domain reputation (time-based, not a task)

- **Outlook / Microsoft 365 deliverability** improves as `granted.bio`
  accumulates successful delivery + engagement over the first 1–2 weeks
  post-launch. Tenant allow-lists are the workaround until then; no
  code change can compress the timeline. Revisit if M365 quarantine
  rate is still meaningful after ~30 days of organic sends.
