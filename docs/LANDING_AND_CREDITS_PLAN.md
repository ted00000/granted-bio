# Landing Page & Credit System Redesign — Implementation Plan

**Status:** Planning doc, ready for implementation.

This document consolidates the redesign of the granted.bio marketing
surface, the introduction of a credit-based purchasing model, and the
AI-assisted retry flow. It is the single source of truth for what to
build and in what order.

---

## 1. Strategic frame

Three commitments drive every decision below:

1. **Reports are the lead artifact.** Free account is the trust-building
   step that earns the $199 purchase. They are not competing products —
   they are sequential.
2. **Persona priority: Researcher → Investor → BD.** Researcher is the
   largest TAM and most natural fit for self-serve. Investor is highest
   willingness-to-pay. BD is enterprise / different motion.
3. **The pricing pitch is "insights you couldn't produce yourself, for a
   price that removes the decision."** Not "cheaper than X." Not
   substitutable. Anchor on the unique cross-source synthesis.

---

## 2. The funnel

```
Marketing site (logged out)
    ↓
[See Sample Report]  OR  [Browse the Data Free]
    ↓                          ↓
Sample page                Free account signup
(/sample/liquid-biopsy)        ↓
    ↓                      Search a topic
Soft signup gate on            ↓
link clicks                "Found N projects on [topic].
    ↓                       Generate the intelligence report — $199."
Create free account            ↓
    ↓                          ↓
                          ┌────┴────┐
                  Stripe checkout ($199)
                          ↓
                  Credits granted:
                    • 1 generation credit
                    • 1 refresh entitlement (unbound)
                          ↓
                  Generate report
                  (consumes generation credit;
                   binds refresh entitlement
                   to this report + interpretation)
                          ↓
                  3 months in-platform access
                          ↓
                  Refresh available within 12 months
```

---

## 3. Header (universal across all pages)

### Logged-out state

**Desktop:**
```
[logo] granted.bio    Sample Report  Pricing  Sign In  [Get Started Free →]
```

**Mobile:**
```
[logo]                                                                  [☰]
```
Drawer expands to: Sample Report / Pricing / Sign In / Get Started Free

### Logged-in state

**Desktop:**
```
[logo] granted.bio    Reports  Search  [N credits]  [👤 profile menu]
```

- `[N credits]` is a badge showing unconsumed generation credits. Tapping
  routes to /generate. Hidden when N=0.
- `[👤 profile menu]` dropdown contains: Account Settings / Billing /
  Sign Out.

### Fixes baked in

- Logo gets fixed dimensions (32×32 on mobile, 40×40 on desktop). Does
  not flex inside the profile-area container — that's the current
  distortion source.
- Account link removed from logged-out state (was redundant with Sign
  In).
- Search link removed from logged-out state (was broken — reloaded
  current view).
- Reports promoted via `Sample Report` and `Get Started Free` CTAs.
- **Same header on /reports** — no loss of conversion path mid-funnel.

---

## 4. Landing page structure (top to bottom)

### §1 Hero

> **A complete intelligence report on any life-sciences research topic —
> synthesizing NIH funding, clinical trials, patents, and publications
> into insights no single source can produce.**
>
> $199, generated in minutes.
>
> [**See a Sample Report**]    [Browse the Data Free]

Below the CTAs: *Data sources: NIH RePORTER · ClinicalTrials.gov · USPTO · PubMed*

### §2 What you actually get

3-column showcase using screenshots from the liquid biopsy report:

| Executive Summary | Funding Landscape | IP Landscape |
|---|---|---|
| Strategic narrative on field direction and white spaces | $102.1M across 125 projects, year-over-year trajectory, top categories | Concentration, dominant holders, FTO assessment |

Below the strip:
> *Every claim in the report links to the underlying project, trial,
> patent, or publication. Drill into any reference, see the original
> abstract, follow the data — for 3 months from purchase.*

### §3 Who it's for (persona order)

**🔬 Researchers** (lead card)
> Position your work in the funding landscape. See what's accelerating,
> who's converging, where the white space is. A competitive map of your
> field that takes hours instead of weeks.
>
> *Used for: grant positioning, identifying collaborators, gap analysis.*

**💼 Investors**
> Pre-private signal on what's becoming a market. NIH funding precedes
> commercial activity by 3–7 years. Get a defensible view of the
> underlying science before a pitch deck shows up.
>
> *Used for: thesis development, technical diligence, identifying
> overlooked platforms.*

**🤝 Business Development**
> Identify partnership and licensing targets earlier. Surface PIs and
> institutions producing the technology you need before they're on
> everyone else's list.
>
> [Talk to us about enterprise pricing →]

### §4 How it works

1. **Choose your topic** — type a research area in your own words.
2. **Pick an interpretation** — we propose three scopes (Narrow / Standard / Broad). You decide.
3. **We synthesize** — projects, trials, patents, publications cross-linked and analyzed. About 2 minutes.
4. **You explore** — the report renders as a navigable document. Every reference is live for 3 months.

### §5 Pricing card

```
$199 per report

✓ Complete intelligence report (PDF + web)
✓ Full access to every linked project, trial, patent, publication
✓ 3 months of in-platform exploration from generation date
✓ One free refresh within 12 months — re-synthesize with current data
✓ Not what you expected? We'll help you refine and regenerate, free.

[Buy a Report →]
```

Below the card: *Need 5+ reports? [Talk to us about volume.]*

### §6 Free account positioning

> **Not ready to commit? Browse the data first.**
>
> A free account lets you search every project, trial, patent, and
> publication in our database. Verify your topic has signal before
> you buy the report.
>
> [Create a Free Account]

### §7 FAQ

- What's in a report? — link to sample
- What data sources? — RePORTER / CT.gov / USPTO / PubMed
- How accurate is the synthesis? — link to methodology audit doc
- What does "3 months access" include? — drill-down across every linked record
- What does the free refresh do? — re-synthesize the same report with current NIH data within 12 months
- Can I share the PDF? — yes; in-platform navigation is tied to your account
- Not happy with my report? — refine and regenerate free, one retry per report
- Do credits expire? — yes, 12 months from purchase

---

## 5. Sample page (`/sample/liquid-biopsy`)

A dedicated SEO-indexable page rendering a full sample report (liquid
biopsy is the natural pick — it's polished).

- All internal links (project / trial / patent / publication) work.
- Logged-out users clicking a link see the actual platform page with a
  soft-gate overlay: *"Create a free account to keep exploring this
  project."*
- They see what's behind the gate before being asked.
- The page has the marketing header (Sample / Pricing / Sign In / Get
  Started Free) — same conversion surface as the home page.

---

## 6. BD form (short, focused)

Triggered from the "Talk to us about enterprise pricing" CTA. Fields:

- Name (required)
- Work email (required)
- Company (required)
- Role
- **Topic of interest** (required) — this is what lets BD outreach be
  specific
- Headcount (optional dropdown)
- Free text: "What are you trying to learn / accomplish?"

Routes to a Slack channel or Linear ticket (decision: which infra?).
Auto-replies with: "Thanks — we'll send you a sample report tailored to
[topic] within 1 business day."

---

## 7. Reports page consistency

When *anyone* lands on `/reports`:

- **Logged-out:** marketing header + body with sample link + pricing
  card + CTA. Title: *"Generate a complete intelligence report on any
  topic."*
- **Logged-in with 0 credits:** logged-in header + their report history
  + pricing card to buy another.
- **Logged-in with credits available:** logged-in header + their report
  history + prominent "Generate New Report" CTA at top.

The key fix: never lose the conversion path. Today /reports drops the
logged-out marketing surface entirely.

---

## 8. In-search conversion CTA

On `/search` results pages, above the results list, for logged-in
free-account users (not for paid users who already have credits):

> **Found 127 projects on [topic].** None of these will tell you what's
> emerging, who's converging, or where the gaps are.
>
> *Generate the intelligence report — $199.*
>
> [Generate Report]

Sticky on mobile scroll.

This is the highest-intent moment in the funnel — the user has just
self-validated the data exists for their topic.

---

## 9. Credit model

### Two distinct units

| Unit | Source | Scope | Header? |
|---|---|---|---|
| **Generation credit** | Purchase, bulk, admin grant | Any topic, any interpretation | Yes — `[N credits]` badge |
| **Refresh entitlement** | Auto-granted alongside each generation credit | Bound to a specific report + interpretation at generation time | No — surfaces as "Refresh" button on the report itself |
| **Retry credit** | Auto on technical failure / self-serve dissatisfaction / admin grant | Bound to a specific original report; assisted via the retry assistant flow | No — surfaces as "Not what you expected?" link on the report |

### Marketing presentation

The user does not see "credits" in the pricing card. They see:
*"$199 per report, one free refresh within 12 months."* The credit
plumbing is internal architecture.

The header badge for logged-in users says e.g. *"1 report ready"*, not
"1 credit."

### Pricing card → credit grant mapping

Stripe price SKU determines what gets granted on payment:

```
sku_single_report   → 1 generation_credit + 1 refresh_entitlement
sku_5_pack          → 5 generation_credit + 5 refresh_entitlement
sku_10_pack         → 10 generation_credit + 10 refresh_entitlement
sku_enterprise      → custom (admin-defined)
```

Bulk SKUs ship later, but the DB model supports them now.

### Expiration

All credits expire **12 months from purchase**. Generation and refresh
share the same expiry. Retry credits inherit the original report's
expiry (no extension via retry).

---

## 10. Retry assistant — the AI-guided refinement flow

When a user clicks "Not what you expected? Refine and regenerate (free)"
on a report page, they enter the assisted retry flow.

### Step 1: Feedback capture

Modal/page asks "What didn't work?":

- ◯ The projects weren't quite what I was looking for
- ◯ Too narrow — missed adjacent areas
- ◯ Too broad — too much off-topic material
- ◯ Missed a specific aspect
- ◯ Wrong field entirely

Plus free-text: *"Tell us more (optional)"*

User must provide a category to proceed. This is the soft quality gate —
users who can't articulate the problem probably want a refund (different
escalation path).

### Step 2: Claude analyzes

A new function `retryAssistantInterpretation(originalInterpretation,
topProjects, userFeedback)`:

- **Inputs:** original topic + interpretation (semantic phrase, label),
  top 10 project titles from the failed report, user's feedback
  category + free text.
- **Output:** 3 refined interpretation candidates, each with a
  one-sentence rationale.
- **Model:** `claude-sonnet-4-6`.
- **Cost:** ~$0.02 per retry. Negligible.

### Step 3: Refined interpretation picker

User sees the same picker UI as the original generation flow, but the
three options are AI-recommended based on their complaint:

```
Based on what you told us, here are three ways to re-run this:

Option A: "[refined semantic phrase]"
  Why this might work: "Narrows toward your area of interest by..."

Option B: "[different phrase]"
  Why: "Broadens to include adjacent X..."

Option C: "[third phrase]"
  Why: "Reframes from your specific angle..."

  [Pick one →]
```

### Step 4: Generation runs

Standard generation flow, consuming the retry credit (not a generation
credit). Result is a new report linked to the original via
`original_report_id`.

### Retry policy

| Trigger | Auto-grant? | Cap |
|---|---|---|
| Technical failure (report ends in `status: failed`) | Yes, automatic | One retry per failure |
| Self-serve "not what I expected" within 14 days | Yes, on feedback submission | One retry per original generation |
| Admin grant | Yes | At admin discretion |
| Retry of a retry | **No** | Hard cap |

---

## 11. Database sketch

### Migration: `add_report_credits.sql`

```sql
-- Credits ledger: one row per credit grant, marked consumed when used.
CREATE TABLE report_credits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id),
  credit_type           TEXT NOT NULL CHECK (credit_type IN ('generation', 'refresh', 'retry')),
  source                TEXT NOT NULL CHECK (source IN ('purchase', 'bulk_purchase', 'admin_grant', 'failure_auto_grant', 'self_serve_retry', 'promo')),
  granted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at           TIMESTAMPTZ,
  consumed_for_report_id UUID REFERENCES user_reports(id),

  -- For refresh credits: bound to a specific report once the parent
  -- generation credit is consumed. NULL until binding.
  bound_to_report_id    UUID REFERENCES user_reports(id),

  -- For retry credits: the original report that triggered the retry.
  original_report_id    UUID REFERENCES user_reports(id),

  -- Stripe linkage for purchase audit trail.
  stripe_session_id     TEXT,
  stripe_price_id       TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_credits_user_unused
  ON report_credits (user_id)
  WHERE consumed_at IS NULL AND expires_at > NOW();

CREATE INDEX idx_report_credits_stripe_session
  ON report_credits (stripe_session_id);

-- Retry feedback: separate table to keep the credit ledger clean and to
-- preserve a learning signal for future product improvement.
CREATE TABLE retry_feedback (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retry_credit_id       UUID NOT NULL REFERENCES report_credits(id),
  original_report_id    UUID NOT NULL REFERENCES user_reports(id),
  feedback_category     TEXT NOT NULL,
  feedback_text         TEXT,
  claude_proposed_interpretations JSONB NOT NULL,
  chosen_interpretation JSONB,
  resulting_report_id   UUID REFERENCES user_reports(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Helper view

```sql
CREATE VIEW user_available_credits AS
SELECT
  user_id,
  COUNT(*) FILTER (WHERE credit_type = 'generation' AND consumed_at IS NULL AND expires_at > NOW()) AS generation_credits,
  COUNT(*) FILTER (WHERE credit_type = 'retry' AND consumed_at IS NULL AND expires_at > NOW()) AS retry_credits
FROM report_credits
GROUP BY user_id;
```

The header credit badge reads from this view.

---

## 12. Backend flow changes

### Stripe webhook (`/api/stripe/webhook`)

**Before:** webhook calls `generateTopicReport` directly on payment
success. Tightly coupled.

**After:** webhook records the payment and grants credits based on the
purchased SKU. Generation happens later via `/api/reports`.

```typescript
// On checkout.session.completed:
const sku = session.line_items[0].price.id
const credits = CREDIT_GRANT_MAP[sku] // { generation: 1, refresh: 1 }
const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

for (let i = 0; i < credits.generation; i++) {
  await insertCredit({ userId, type: 'generation', source: 'purchase', expiresAt, stripeSessionId })
}
for (let i = 0; i < credits.refresh; i++) {
  await insertCredit({ userId, type: 'refresh', source: 'purchase', expiresAt, stripeSessionId })
}
```

### Report generation (`/api/reports` POST)

```typescript
// Before generating:
const credit = await consumeCredit(userId, 'generation')
if (!credit) throw new Error('No generation credit available')

const reportId = await generateTopicReport(userId, topic, ...)

// After successful generation, mark credit consumed and bind a refresh:
await markCreditConsumed(credit.id, reportId)
await bindUnboundRefreshCredit(userId, reportId, interpretation)
```

### Refresh handler (new endpoint `/api/reports/:id/refresh`)

```typescript
const refreshCredit = await findRefreshCreditForReport(reportId, userId)
if (!refreshCredit) return 403

const originalReport = await getReport(reportId)
const newReportId = await generateTopicReport(
  userId,
  originalReport.topic,
  originalReport.persona,
  originalReport.interpretation, // locked to original
)

await markCreditConsumed(refreshCredit.id, newReportId)
```

### Retry handler (new endpoint `/api/reports/:id/retry`)

```typescript
// Step 1: feedback submission
const feedback = req.body
const retryCredit = await grantRetryCredit(userId, reportId)

// Step 2: Claude proposes alternatives
const proposals = await retryAssistantInterpretation(
  originalReport.interpretation,
  topProjectTitles,
  feedback,
)

// Step 3: persist feedback record (resulting_report_id NULL for now)
await insertRetryFeedback({ retryCredit, originalReport, feedback, proposals })

// Step 4: return proposals to UI for user selection
return { proposals }

// Then on user's choice (new endpoint or follow-up call):
// generate report with chosen interpretation, consume retry credit,
// update retry_feedback.chosen_interpretation and resulting_report_id.
```

---

## 13. Implementation phases

### Phase 1 — Header & landing polish (1–2 days)

**Goal:** stop the bleeding. Fix the broken header, replace the hero,
recover the /reports conversion surface.

- Fix logo sizing on mobile (fixed dimensions, no flex distortion)
- Remove Account link from logged-out header
- Remove or disable Search link from logged-out header
- Add Sample Report and Pricing links + Get Started Free CTA
- Replace hero copy with the locked version
- Make /reports use the marketing header for logged-out users
- Add inline conversion CTA on /search results

**No DB changes.** Pure frontend. Ships value immediately.

### Phase 2 — Credit system foundation (2–3 days)

**Goal:** decouple purchase from generation.

- Migration: `report_credits` table, `user_available_credits` view
- Refactor Stripe webhook to grant credits, not generate reports
- Refactor `/api/reports` POST to consume a credit before generating
- Header credit badge for logged-in users
- Update pricing card copy to reflect "$199 + 1 refresh within 12 months"

After this phase, the architectural foundation is in place and the
unit economics are cleaner.

### Phase 3 — Refresh entitlement & retry assistant (3–4 days)

**Goal:** ship the unique value-adds that justify the "we'll regenerate
free" promise on the pricing card.

- Refresh entitlement binding on first generation
- "Refresh report" button on report pages (with smart timing — "It's
  been 3 months since you generated this; new data is available")
- `retry_feedback` table
- "Not what you expected? Refine and regenerate" UX on report pages
- Feedback modal/page
- `retryAssistantInterpretation` Claude function
- Refined interpretation picker (reusing the existing picker component)
- Retry credit auto-grant on technical failure (`status: failed`)
- Wire feedback collection into ongoing product improvement loop

### Phase 4 — Persona, sample page, BD form (2–3 days)

**Goal:** complete the landing page. Higher-fidelity content.

- Persona cards section (Researcher / Investor / BD)
- `/sample/liquid-biopsy` dedicated page with soft-gate links
- BD form with topic of interest, routed to Slack/Linear/email
- "How it works" section
- FAQ section
- Sample report screenshots in §2 "What you actually get"

### Phase 5 — Bulk pricing & enterprise (later)

**Goal:** revenue scale.

- Bulk Stripe SKUs (5-pack, 10-pack)
- Pricing card with toggle for single vs bulk
- Volume discount math visible to user
- Enterprise contact-sales flow (separate from BD form — distinct
  motion for large-volume contracts)

---

## 14. Open questions for production

1. **BD form routing infrastructure:** Slack channel, Linear ticket, or
   email-to-shared-inbox? Pick before implementing the form.
2. **Refresh smart timing:** what counts as "material new data" worth
   nudging a refresh? Probably: new projects with similarity ≥ 0.50
   added since original generation, or any newly-linked Phase 3+ trial.
   Needs concrete threshold definition before §13 Phase 3 ships.
3. **PDF re-issuance on refresh:** does the refresh regenerate the PDF
   as well as the web view? Almost certainly yes — but storage and
   versioning need a spec. Suggest: PDF is regenerated, original kept as
   `v1.pdf` for download.
4. **Refund escalation path:** users who don't want a retry but want
   their money back — what's the policy? Suggest 7-day full refund
   window, manual processing via support email.
5. **Credit purchase confirmation page:** after Stripe success, where
   does the user land? Suggest a `/welcome` page that shows "1 report
   ready" and routes to the topic-picker.

---

## 15. Total estimated effort

- Phase 1: 1–2 days
- Phase 2: 2–3 days
- Phase 3: 3–4 days
- Phase 4: 2–3 days
- **Total Phases 1–4:** ~10 working days
- Phase 5: TBD when volume justifies it

Each phase is independently shippable and produces user-visible value.
Phase 1 alone resolves the friction described in the original problem
statement.
