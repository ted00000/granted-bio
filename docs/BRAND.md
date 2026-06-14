# granted.bio brand

A single source of truth for visual identity, voice, and product
positioning. Read this before writing any copy, building any new
surface, or designing any artifact that carries the granted.bio name.

When this doc and the codebase disagree, the codebase wins for
existing tokens (colors, component patterns) and this doc wins for
new copy or new surfaces. Update this doc when those conflicts get
resolved.

---

## 1. Identity

**What we are.** granted.bio synthesizes publicly available
life-sciences research data — NIH-funded grants, clinical trials,
patents, publications — into cross-linked intelligence reports on any
topic.

**The artifact we sell.** A complete intelligence report on a
research topic, generated in about two minutes, with three months of
in-platform drill-down access to every linked record. $199 per
report.

**The free tier we offer.** A free account that lets visitors search
the underlying data so they can validate their topic has signal
before they buy. 15 searches per month (with a deliberate soft moment
at 10 — see §8).

**Who we serve, in priority order.** Researchers first, investors
second, BD third. Always in that order. See §7.

---

## 2. Voice and tone

**Decisive.** We make calls. We don't hedge. When we have a
recommendation, we lead with it.

**Concrete.** We name what's in the report (Executive Summary, Field
Maturity, Competitive Topology, etc.), name the data sources (NIH
RePORTER, ClinicalTrials.gov, USPTO, PubMed), name the unit cost
($199), and name the time (two minutes, three months, twelve months).
Abstract claims get replaced with specific ones.

**Honest about scope.** The data is NIH-linked. We don't pretend it's
exhaustive. The report's own "What This Report Does Not Cover"
preamble is the model.

**No false urgency.** No countdown timers, no "limited time," no
artificial scarcity. The pricing card stays the same regardless of
when you visit.

**Warm where warm matters.** "We gave you 5 more, on us" — yes. The
contact form thank-you state — yes. Marketing-CTA hype — no.

### Sentence-level rules

- Lead with the value, not the feature. "Cross-linking NIH funding,
  clinical trials, patents, and publications to reveal patterns,
  momentum, and opportunity gaps" — not "Our platform aggregates four
  databases."
- Active verbs over passive constructions. "Reports generate in two
  minutes" not "Reports are generated."
- Em-dashes are fine for parenthetical clauses (we use them
  consistently). Avoid semicolons in marketing copy.
- No exclamation points outside of the contact-form success state.

---

## 3. Visual identity

### Colors

| Role | Token | Hex | When to use |
|---|---|---|---|
| Brand accent | coral | `#E07A5F` | Primary CTAs, brand mark, links, highlights, active nav state |
| Brand accent hover | darker coral | `#C96A4F` | Hover state for primary buttons and links |
| Brand accent muted | `#E07A5F`/`10` opacity | — | Soft backgrounds for brand-tinted cards, badge fills |
| Brand accent tint | `#FDF2EF` | `#FDF2EF` | Icon container backgrounds |
| Page background | bone | `#FAFAF9` | All marketing pages, dashboard backgrounds |
| Surface | white | `#FFFFFF` | Cards, modals, pricing surfaces |
| Body text | gray-700 | Tailwind `text-gray-700` | Body copy |
| Heading text | gray-900 | Tailwind `text-gray-900` | Headings, emphasized inline text |
| Muted text | gray-500 / 600 | Tailwind | Subheads, captions |
| Border | gray-100 / 200 | Tailwind | Card borders, dividers |
| Success | emerald-500 | Tailwind | Checkmarks, completed states |
| Warning | amber-500 / 600 | Tailwind | "Running low" nudges, soft warnings |
| Error | rose-500 / 600 | Tailwind | Form errors, hard limits |

### Type

- **Sans-serif system font stack** (Tailwind default). No custom font
  files — speed and consistency matter more than a bespoke typeface
  at this stage.
- Scale uses Tailwind defaults:
  - Hero H1: `text-4xl md:text-5xl font-semibold tracking-tight`
  - Section H2: `text-2xl md:text-3xl font-semibold`
  - Subsection H3: `text-lg font-semibold`
  - Body: `text-base` (or `text-sm` in cards)
  - Caption: `text-xs` or `text-[10px] uppercase tracking-wider` for
    category labels on cards

### Logo

The granted.bio logo is the leaf icon + "granted" wordmark in dark
gray + ".bio" in coral. Don't recolor it. Don't stretch it. Don't
add effects. Used at:
- `h-7 sm:h-10` in marketing nav
- `height={40}` in legal-page headers
- Larger on the sample page

The leaf icon alone (no wordmark) is reserved for favicon and
extreme size constraints. Don't decorate marketing surfaces with the
icon alone.

### Component patterns

These are the patterns that recur across the product. Match them
when building new surfaces.

- **Card.** `bg-white rounded-2xl border border-gray-200 shadow-sm
  p-6`. Sometimes coral border (`border-2 border-[#E07A5F]`) for the
  featured option in a comparison.
- **Primary CTA button.** `bg-[#E07A5F] text-white rounded-lg
  font-medium hover:bg-[#C96A4F]`. Always pairs with an
  `ArrowRight` icon at the end.
- **Secondary CTA.** `border border-gray-200 bg-white text-gray-900
  rounded-lg`. No arrow, or a `Sparkles` icon for sample-related
  actions.
- **Pill / tag.** Small rounded rectangles with subtle backgrounds
  (`bg-blue-50 text-blue-700`, etc.) for categories, status, persona
  labels.
- **Modal.** `fixed inset-0 z-50` overlay with `bg-gray-900/50`
  backdrop, `bg-white rounded-2xl shadow-xl max-w-md w-full` content.
  Click-outside cancels. See `UpgradePrompt` and the refresh confirm.
- **Category label inside a card.** `text-[10px] uppercase
  tracking-wider text-[#E07A5F] font-semibold` (or `text-gray-500`
  for neutral cards). Used on the §2 sample preview cards and the
  time-ROI cards.

### Imagery / illustration

We don't use stock photography. We don't use illustrations of
researchers / lab coats / DNA helices. The product is the artifact;
the visual showcase is the report itself (the §2 preview cards
mimic actual report sections using real numbers from the public
sample).

---

## 4. Product positioning

**Headline.** *A complete intelligence report on any life-sciences
research topic.*

**Subhead.** *Cross-linking NIH funding, clinical trials, patents,
and publications to reveal patterns, momentum, and opportunity gaps
— for grant positioning, investment diligence, and partnership
scouting.*

**Differentiator.** Not "cheaper than market research." Not "AI-
powered search." The differentiator is **cross-source synthesis**:
no single database does this, and doing it by hand takes ~25 hours
of analyst time even with AI assistance.

**Time framing.** *Weeks of cross-source work, done in two minutes.*
The contrast lands harder than any price comparison. Always pair
time-saved with what the artifact is, not what competitors charge.

**Trust framing.** *Every claim links to the underlying project,
trial, patent, or publication.* Auditability is the answer to "is
the AI hallucinating?" Lean on it.

---

## 5. Locked phrases

These exact (or near-exact) phrases recur across surfaces. Don't
rewrite them surface-by-surface — pick from this list.

### Pricing
- **"$199 per report"** — always with the dollar sign attached, never
  "the report costs $199" or "$199 USD."
- **"One free refresh within 12 months"** — singular "refresh,"
  explicit 12-month window.
- **"Refine & regenerate, free, if not satisfied"** — the retry
  credit. Don't call it a "guarantee."
- **"Priced to use, not to ration"** — the affordability frame on
  /pricing.
- **"At analyst rates, the report pays for itself the first time you
  skip the manual workflow."** — the closing line on the time-ROI
  section.

### Time
- **"Generated in two minutes"** or **"in two minutes"** — not "~120
  seconds" or "in minutes."
- **"3 months of in-platform drill-down access"** or **"three months
  of in-platform exploration"** — the access window.
- **"~25 hours of analyst time, even with AI assistance"** — the
  manual-workflow comparison.

### Data sources
- **"NIH RePORTER, ClinicalTrials.gov, USPTO, PubMed"** — always all
  four, always in that order, always with the proper capitalization.
- **"NIH-linked"** when describing scope. Not "NIH-funded only" (that
  sounds limiting); not "public data" alone (that loses specificity).

### The reveal moments
- **"5 more searches, on us"** — the soft-pitch modal at search 10.
- **"We gave you 5 more, on us. Skip the searching: generate the
  report."** — the body of the soft pitch.

### Report sections (in order)
1. Executive Summary
2. Field Maturity
3. Competitive Topology
4. Funding Landscape
5. Market Context
6. Clinical Validation
7. IP Landscape
8. Key Publications

Capitalized title case. Use this list whenever enumerating what's in
a report.

---

## 6. Anti-patterns — never say

**Pricing comparisons.** Never lead with "cheaper than [competitor]."
No "98% cheaper than market research." No price-vs-PitchBook tables.
The differentiator is unique synthesis, not cost. (Memory:
`feedback_pricing_framing.md`.)

**Capability putdowns.** Never frame the pitch as what the reader
can't do. Killed: "Insights you couldn't produce yourself." Killed:
"None of these will tell you what's emerging." Frame it as what the
report delivers, not what the reader lacks.

**"Pro Search."** That tier was removed from marketing 2026-06-11.
Don't reintroduce it without an explicit product decision. The code
that supports a recurring subscription is commented out but
preserved; don't surface it in copy.

**"Premium" badges on Reports.** Reports are paid à la carte. They're
not gated behind a premium tier. The Sidebar Premium badge was
removed for this reason.

**Stock language.** "Revolutionary," "cutting-edge," "next-generation,"
"AI-powered," "unleash," "supercharge." Specific is better than
superlative.

**False urgency.** No "limited time," no "today only," no expiring
discounts. Credits expire 12 months from purchase; that's the only
time-bound mechanic and it's structural, not promotional.

**"Members" / "subscribers."** Users are users. Customers are
customers. We don't sell a membership.

**Negative framings.** Never lead with "no," "none of these," or
"you don't have." Lead with the positive reveal.

---

## 7. Persona priority

The locked order is **Researcher → Investor → BD**. This applies to:
- Persona cards on the home page (Researchers card always leftmost)
- The use-case triplet in the hero subhead ("grant positioning,
  investment diligence, and partnership scouting")
- The Intelligence Reports pill on /pricing ("Researcher, investor,
  or BD lens")
- The lens selector inside the report-generation flow
- Any future surface that enumerates the three personas

### Per-persona positioning

**Researcher (lead).** Grant positioning, gap analysis, collaborator
identification. The artifact helps them position their work in the
field. Voice: peer, not vendor.

**Investor.** Investment diligence, technical risk assessment, pre-
private signal. The artifact helps them get the underlying science
before a pitch deck shows up. Voice: analytical, hedged where the
data warrants.

**BD.** Partnership scouting, licensing-target identification, early
visibility into PIs and institutions producing the technology they
need. Voice: pragmatic; BD has its own CTA ("Talk to us about
enterprise pricing") routing to `/contact` because the BD motion is
enterprise, not self-serve.

---

## 8. Free tier and the soft-pitch moment

The free tier is *15 searches per month*, but the UI displays *X/10*
until the user actually crosses 10. At search 10, the soft modal
fires with the *"5 more searches, on us"* framing — only then does
the displayed cap reveal as 15. The framing depends on the surprise;
don't preempt it elsewhere.

After the soft pitch fires, the displayed cap is honest about the
full 15. The hard wall at 15 routes through the same modal but with
the reset-date messaging. Both modes always offer the report as the
real next step.

This pattern — *deliver the gift before naming the cap* — is a
general voice principle, not just a search-limit detail. When we can
make a value moment land with goodwill instead of a limit indicator,
we should.

---

## 9. Tone in transactional surfaces

**Receipts.** Hosted by Stripe; we don't author them, but the
configured support email is `admin@granted.bio`. Don't put a
support phone on receipts.

**Magic-link emails.** Sent through Supabase Auth via Resend SMTP.
We don't yet brand them; the default is fine for now.

**Contact form notifications.** Go to `hello@granted.bio` via
Resend. The from-address is `contact-form@granted.bio`.

**Other emails.** None yet. When we build them (report-ready,
refresh-nudge, etc.), they go through Resend with a `no-reply@
granted.bio` sender — never through the conversational inboxes
(`hello@`, `admin@`, `ted.nunes@`).

---

## 10. Email and contact addresses

| Address | Purpose | Surface |
|---|---|---|
| `hello@granted.bio` | Public BD inbound, marketing | Footer mailto links, contact-form destination |
| `admin@granted.bio` | Account / legal / billing inbound | Stripe receipts, Privacy + Terms contact |
| `ted.nunes@granted.bio` | Founder's personal inbox | Internal only |
| `contact-form@granted.bio` | Transactional sender (Resend) | From-address on contact-form email |
| `no-reply@granted.bio` | Future transactional sender | Reserved; not yet active |

The conversational inboxes (hello, admin, ted.nunes) live on Zoho
Mail Free. Transactional sending goes through Resend.

---

## 11. Out-of-scope today

Things that might look like brand decisions but haven't been made
yet:

- **Branded transactional emails.** Report-ready, payment receipts,
  refresh nudges. Currently default Stripe / no app-level sends.
- **Mobile native app.** Not on roadmap; the web app is responsive.
- **Dark mode.** Not built. Don't half-build it.
- **Internationalization.** US-only for now. Copy is American
  English. Pricing is USD.
- **Community / forum / blog.** None planned.

When any of these ship, the brand doc gets updated and the new
patterns become rules.

---

*Brand decisions get made in conversation and lived in the codebase.
This doc catches them up. Update it when a new pattern lands;
challenge it when it gets in the way of a better decision.*
