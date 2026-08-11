# UI-First Report Pivot — v1 Spec

**Date:** 2026-08-11
**Trigger:** CellFreeGroup review §6 ("granted.bio is a website, and a 53-page
PDF is a strange primary artifact for one. The natural output is a web report
with a sticky table of contents and expandable sections, where keyword lists
and caveats live behind a disclosure triangle, and the PDF is the export
rather than the product.")
**Sequence position:** #2 of 3 per `[[project_directional_2026-08-11]]`
(after trust fixes shipped `3446229`, before BD persona)
**Effort estimate:** 2-3 days for v1

---

## Problem the pivot solves

Every report today is 15-17k words / 53 pages of markdown. It renders as a
single scrollable page. Reference material (keyword lists, per-category
caveats, empty-taxonomy tables) is interleaved with reading material
(executive summary, surprising findings, strategic implications). Result:
**even the ideal reader — a domain expert who paid $199 — bounces
before finishing**, per Nathan's own admission ("my honest reaction was
that I was not going to read it all, and I am the ideal reader").

The PDF-first mental model made this feel unavoidable — a paper document
has to include everything on the page. A web app doesn't.

---

## What ships in v1

### Reading model: **sticky TOC + linear scroll + collapsible sections**

- **Left rail:** sticky table-of-contents that lists every `## ` section.
  Scroll-spy highlights the section currently in view. Click any entry to
  jump. Mobile: TOC lives behind a hamburger toggle (existing sidebar
  pattern reused).
- **Main column:** the report body scrolls linearly, top-to-bottom, same
  as today. What changes: sections are grouped into three visibility
  tiers, with the low-tier sections collapsed by default.

### Section visibility tiers

| Tier | Behavior | Sections |
|---|---|---|
| **1. Always expanded** | Rendered in full on page load | Executive Summary, What Surprised Us, Field Maturity, Competitive Topology, White Space Analysis, Next Steps |
| **2. Expandable (default collapsed)** | Section heading + one-line summary + `[Show details ▾]` chip. Click expands in place. | Detailed project cards, curated publications, patents table, org table, PI table, market context source list, methodology notes |
| **3. Behind disclosure** | Not rendered as its own section. Content lives in a `<details>` or `Info` tooltip next to the relevant claim. | Per-claim Confidence tags (become hover tooltips), keyword lists per taxonomy category, per-section "This analysis includes only..." disclaimers (become one methodology footnote linked from every section) |

Reader on first load sees ~10 pages of substantive analysis. The other
40 pages exist and are one click away.

### Confidence tag treatment (parking-lot item folded in)

Today: 36× inline `**Confidence: Medium** — Evidence: [...]` tags per report.
New: each substantive claim ends with a small `Confidence: M` chip (icon +
letter, ~1cm wide). Hovering or tapping the chip reveals the full evidence
paragraph in a tooltip. Underlying markdown model is unchanged so the lint
rules keep working; only the render changes.

### Empty-taxonomy collapse (parking-lot item folded in)

White Space tables that have >3 zero-project rows collapse those rows into
a single `N categories below the reporting threshold [Show all]` summary
row. Preserves the audit trail; kills 12+ pages of `0 | 0 | 0` in typical
reports.

### Disclaimer compression (parking-lot item folded in)

The per-section italic disclaimers ("*Note: This analysis includes only
NIH-funded projects...*") that appear ~8× per report get replaced by a
single sticky **"Methodology & Coverage"** page linked from a small
`ℹ Coverage & caveats` icon in the sidebar. Per-section notes shortened to
one line: `Scope note: NIH-only sample — see Methodology`.

### PDF becomes a secondary export

- Rename existing "Download PDF" button to `Export as PDF (for offline)`
  and de-emphasize visually (secondary style, not primary).
- PDF captures the fully-expanded state so nothing is hidden from a
  reader who chose the PDF form.
- Existing puppeteer print route stays as-is; only the UI framing changes.
- Marketing copy audit: swap "get a report" → "get an analysis" on
  landing page, samples page, `/reports` logged-out block. "Analysis"
  reads as a tool; "report" reads as a document.

---

## What is explicitly OUT of scope for v1

To ship in a week and prove the model, these are NOT in this pivot:

- Chart improvements (Recharts stays as-is)
- Section-level filtering / search within report
- Sharing / permalinks to specific findings
- Comments / annotations / user notes on reports
- Print stylesheet overhaul (existing works fine for the export path)
- Regenerating existing reports on the new template (schema unchanged,
  everything already-generated renders in the new view instantly)
- Persona differentiation (BD persona is the next work item, per sequence)

If any of these surface as blockers during Nathan's re-review of the new
UI, they become the next priority. Otherwise they wait.

---

## Files that change

| File | Change | Est |
|---|---|---|
| `src/app/reports/[id]/page.tsx` | New two-column layout (sticky TOC + main). Extract report render into a new client component. | ~200 loc |
| `src/app/reports/[id]/MarkdownRenderer.tsx` | Add scroll-spy hook + section-tier detection + collapsible section wrapper | ~150 loc |
| `src/app/reports/[id]/TableOfContents.tsx` | New: sticky nav with scroll-spy | ~120 loc |
| `src/app/reports/[id]/ConfidenceTag.tsx` | New: chip render + hover tooltip | ~50 loc |
| `src/lib/reports/synthesize.ts` | Emit a small metadata block per section indicating tier (so the renderer knows what's collapsible without regex-guessing) | ~40 loc |
| `src/app/samples/page.tsx` + `src/app/sample/*/page.tsx` | Same renderer swap so public samples get the new UI too | ~10 loc each |
| `src/app/page.tsx` + `src/app/reports/page.tsx` | Marketing copy: "report" → "analysis" | ~5 edits |
| `src/app/reports/[id]/print/*` | Add "fully expanded" default so PDF export captures everything | ~10 loc |

**Total: ~600-700 lines of new code + edits.** Web view already exists;
this is elevation + navigation + progressive disclosure, not from-scratch.

---

## Success check (how we know it worked)

After deploy, we send Nathan the URL of a freshly-generated report on a
new topic and ask him three questions:

1. Did you get through the analysis?
2. Which sections did you actually expand?
3. Would you pay $199 for this?

If he says (roughly) "yes / most of the tier-1 sections / yes with
caveats" → ship, iterate on smaller polish. If he still bounces →
diagnose whether the problem is layout, content quality, or persona
mismatch and prioritize accordingly.

---

## Two open decisions I need from you

**A. Order of building.** Two options:

- **A1** — build the whole thing in one push (~2-3 days), deploy once,
  send Nathan a link. Cleaner deliverable, one review cycle.
- **A2** — ship it in two commits: (1) sticky TOC + tier-based
  collapse (~1 day), (2) confidence chips + empty-taxonomy collapse +
  copy audit (~1-1.5 days). Faster feedback if the tiering is wrong.

Recommendation: **A1**. This is a coherent UI shift; splitting it
means Nathan or any other visitor sees a half-built experience mid-week.

**B. Marketing copy scope.**

- **B1** — swap "report" → "analysis" everywhere (landing, samples,
  reports page, CTAs, meta tags, PDF filename). Consistent but a
  bigger diff.
- **B2** — swap only in the direct product surfaces (samples index +
  sample pages + `/reports` block). Landing page stays with "report"
  language for now.

Recommendation: **B1**. Half-swapping reads as inconsistency, and if the
model shift is real then the language shift needs to catch up
everywhere.

---

## Non-goals I want to name explicitly

- This is not a redesign. The visual system, color palette, typography,
  and component style all stay. Only the reading model changes.
- This is not a re-scope of the underlying analysis. Everything the
  synthesis pipeline emits today still emits; the renderer just decides
  what to show by default vs. behind a disclosure.
- This is not a fix for the "manufactured relevance" or scope-collapse
  cases (those are the trust fixes, already shipped `3446229`).
