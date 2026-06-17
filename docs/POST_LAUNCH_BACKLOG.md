# Parking Lot — 16JUN2026

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
