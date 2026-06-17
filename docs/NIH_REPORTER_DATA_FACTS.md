# NIH RePORTER Data Facts — Pulled 16JUN2026

Source: <https://report.nih.gov/faqs>

Captures the facts from the NIH RePORTER FAQ that affect how granted.bio
should ingest, refresh, and disclose its data. Re-pull and re-date when
revising — the upstream FAQ can change without notice.

---

## Update cadence

- **Weekly refresh.** "In general, the RePORTER database of research
  projects is updated weekly."
- **Late Sunday → Monday morning.** "RePORTER data is refreshed each
  week (usually late Sunday nights) newly added projects generally
  available on Monday mornings."
- **7–10 day visibility lag from budget start.** "Generally, grants,
  along with their official abstract), will appear in RePORTER 7–10
  days after their Budget Start Date."
- **Inclusion condition.** "To be included in the weekly refresh the
  Budget Start Date of the funded award must have passed."
- **Backwards mutability.** "RePORTER provides the most up-to-date
  information possible on funded projects, so the data are not frozen
  and changes in the administrative details of prior awards can occur."
  Real-time for recent awards; rare for awards >2 fiscal years old.
- **Intramural lag.** Intramural projects update **annually**, "at the
  close of each fiscal year."

**Operational implication:** schedule the granted.bio refresh job to
run **Monday morning ET** to pick up Sunday-night updates. Refresh
should re-pull at least the trailing 8 weeks to absorb backwards edits
(PI moves, no-cost extensions, amount revisions) on recent awards. No
need to constantly resync >2 FY old awards.

---

## Data scope

- **Agencies:** NIH, CDC, AHRQ, HRSA, ACF, FDA, VA. Coverage varies by
  agency and fiscal year (per FAQ's detailed coverage table).
- **Costs:** "Costs are only available for projects funded by NIH, CDC,
  FDA, and ACF." Non-funded agencies show no cost data.
- **Cost units:** "Costs shown in RePORTER are the total costs (direct
  + indirect costs) awarded in a single fiscal year." Not life-of-project
  totals (except multi-year funded grants).
- **Multi-project grants:** "The costs of the subprojects in
  multi-project grants are italicized in RePORTER...to avoid
  double-counting, the italicized subproject costs should be excluded
  when calculating the amount of total funding."
- **R&D contracts:** included, but "for fiscal years prior to 2008, the
  data for R&D contracts may be incomplete."
- **CRISP-term discontinuity at 2008.** "Term searches that span fiscal
  years before and after 2008 will not be comparable."

**Operational implications:**
- The aggregation in `lib/reports/synthesize.ts` should keep treating
  italicized subproject costs as line items rolled into the parent,
  not as separate funded projects (confirms our current dedupe via
  core project number).
- Pre-2008 R&D contracts should carry a quiet caveat or be excluded
  from any historical trend chart we publish. Currently not an issue
  since report sample windows are FY2024+.
- Don't surface CRISP-vs-modern term searches as comparable in any
  trend visualization.

---

## Known linkage caveats that affect our report

These are the upstream-data caveats we should keep disclosed in report
methodology language so buyers know the boundaries:

- **Publications can mislink or go missing.** "Some publications will
  be inadvertently linked to the wrong grant or missing altogether...
  Variations in the format used to cite NIH funding will lead to
  either an inability to make an association or erroneous matches."
- **PubMed-only coverage.** "RePORTER lists only publications found in
  PubMed or PubMed Central. There are publications resulting from
  funded research that appear in journals that are not part of the
  PubMed collection."
- **Patent data is incomplete.** "The patents in RePORTER come from
  the iEdison database. Not all recipients of NIH funding are
  compliant with the iEdison reporting requirements, particularly
  after their NIH support has ended."
- **Patents are issued-only.** Per the ExPORTER FAQ: "Only issued
  patents are listed; patent applications in-progress are excluded."
  Worth surfacing in any FTO-adjacent framing — buyers running an
  FTO analysis need to know pending applications aren't here.
- **Temporal association ambiguity.** "Publications are associated
  with projects, but cannot be identified with any particular year of
  the project or fiscal year of funding."

**Operational implication:** our existing "What This Report Does Not
Cover" + "Patent Activity" / "Key Publications" methodology notes
already disclose most of these. Worth a periodic audit to confirm we
haven't drifted into over-claiming. Specifically:
- Don't show a "patents per fiscal year" chart — temporal attribution
  is upstream-unreliable.
- Keep the publication count framed as "linked publications," never
  "publications by this project."

---

## Programmatic access

### RePORTER API (live)

- Endpoint: `https://api.reporter.nih.gov/?urls.primaryName=V2.0`
- **Covers:** Projects, Abstracts (as a field on each project record),
  Publications (with PMID linkage keyed on Core Project Number).
- **Does NOT cover:** Patents, Clinical Studies (neither documented in
  the V2 spec as of 16JUN2026).
- Live, refreshed weekly per upstream's Sunday-night cadence.

**Available date filters on the Projects criteria object:**
`project_start_date`, `project_end_date`, `award_notice_date`,
`date_added` ("Dates are available from 1/1/2011"). Each takes
`from_date` and `to_date`.

**No `last_modified_date` filter exists.** This is the operational
gotcha. The API lets us fetch what's NEW since a given date (via
`award_notice_date` or `date_added`) but does not let us efficiently
fetch what was MODIFIED. Since the FAQ explicitly states that
administrative changes to existing awards happen in real time, this
means the API alone cannot keep modifications current — we have to
lean on ExPORTER's "three prior FYs" retroactive updates to absorb
those.

**Rate limits:**
- "It is recommended that users post no more than one URL request per
  second"
- "Limit large jobs to either weekends or weekdays between 9:00 PM
  and 5:00 AM EST"
- "Failure to comply with this policy may require administrators to
  block your IP address."

**Pagination:**
- Default page size: 50; **max 500**
- **Max offset: 14,999** for Projects, 9,999 for Publications →
  effectively a 15,000-record hard cap per query. Larger result sets
  require chunking by a date or other field.

### ExPORTER bulk

Confirmed file types and URL paths:

| File | URL pattern | Documented cadence |
|------|-------------|--------------------|
| Projects | `/exporter/projects/download/<fy>` | "End of each fiscal year" + retroactive updates to 3 prior FYs |
| Abstracts | `/exporter/abstracts/download/<fy>` | Same as Projects (separated from Projects "due to file size considerations") |
| Publications | `/exporter/publications/download/<fy>` | "Publication and Publication Link files are updated" at FY close |
| Link tables (project ↔ publication, etc.) | `/exporter/linktables/download/<fy>` | At FY close |
| **Patents** | `/exporter/patents/download` (no FY) | **Not documented in FAQ.** Observed 6/15/2026 refresh on the live site — cadence appears irregular |
| **Clinical Studies** | `/exporter/clinicalstudies/download` (no FY) | **Not documented in FAQ.** Observed 6/15/2026 refresh on the live site — cadence appears irregular |

- **Spending categories field lag.** "The previous fiscal year's
  Project file will be updated with the addition of data for NIH
  Spending Categories field approximately 3 weeks after the
  completion and release of the RCDC Categorical Spending
  information."
- **CRISP Legacy.** Separate downloads cover FY 1970 onward (CRISP
  terms; not comparable to modern project concepts per the
  pre-/post-2008 discontinuity).

### Caveat on documented vs. observed ExPORTER cadence

The FAQ states Projects/Abstracts/Publications refresh at fiscal-year
close. NIH FY ends Sep 30, so by that schedule the current files
should date from Oct/Nov 2025. Observed file dates on the live site
as of 16JUN2026 are **3/9/2026** for those three — which doesn't
match the documented cadence. Either there are undocumented interim
releases, or the file date reflects a "last touched" timestamp
distinct from the FY-close cycle. **Practical conclusion:** do not
trust the calendar to know when ExPORTER updates. Poll the URL's
`Last-Modified` HTTP header on a schedule and react when it changes.

### Operational strategy (under construction)

Both ExPORTER and the API are mandatory infrastructure — they do
different jobs and neither subsumes the other.

- **ExPORTER bulk** carries: backwards-edits to existing awards
  (modifications are NOT exposed via API), patents (no API), clinical
  studies (no API). Updates on an irregular cadence that the FAQ
  doesn't fully document — poll `Last-Modified` HTTP headers daily,
  re-ingest when they advance.
- **RePORTER API** carries: new awards filtered on `award_notice_date`
  or `date_added`, weekly. Closes the lag-time gap between ExPORTER
  refreshes for projects/abstracts/publications.

The catch-up plan we're scoping:

1. Audit DB high-water mark per entity vs. row counts in the
   currently-published ExPORTER files (3/9 for projects/abstracts/
   publications; 6/15 for patents/clinical_studies as of 16JUN2026).
2. Re-download all 5 ExPORTER files at their current versions and
   ingest — gets us to parity with ExPORTER (closes the 3-month
   patent/trial gap; confirms we captured every row from the 3/9
   project/abstract/pub snapshot).
3. **For Projects/Abstracts/Publications:** API catch-up from 3/9 →
   today, filtered on `award_notice_date >= 2026-03-09` (or
   `date_added`, whichever is more reliable per testing). Chunk by
   month if any single query approaches the 15,000-record cap.
   Schedule to run overnight ET to respect rate-limit guidance.
4. **Ongoing weekly cron** for Projects/Abstracts/Publications via
   the API, Monday morning ET. Filter on `award_notice_date >=
   last_run`. Run at 1 req/sec.
5. **Daily ExPORTER `Last-Modified` poll** for all 5 file types. When
   any advances, download + re-ingest. This catches the project/
   abstract/publication modification cycle that the API can't expose,
   and is the only path for patent + clinical_studies updates.
6. Continue using ClinicalTrials.gov API + USPTO/Google Patents
   links for runtime enrichment of trial / patent records — already
   wired, not part of the bulk-refresh plan.
