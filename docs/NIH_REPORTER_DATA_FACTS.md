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

- **API.** `https://api.reporter.nih.gov/?urls.primaryName=V2.0` —
  what granted.bio currently uses for project + publication ingest.
- **ExPORTER (bulk).** Annual extracts available at the ExPORTER page.
  Updated at fiscal-year close with finalized R&D contracts and
  intramural data; the three prior fiscal years are also re-released
  at that time. Useful for backfill but not real-time.
- **Spending categories lag.** "The previous fiscal year's Project
  file will be updated with the addition of data for NIH Spending
  Categories field approximately 3 weeks after the completion and
  release of the RCDC Categorical Spending information."

**Operational implication:** the API is the right primary source. The
annual bulk ExPORTER files are the right *secondary* source — pull
once per fiscal year close (~Oct) to reconcile finalized intramural +
contract data against the API record. Sets up a cheap consistency
check that catches drift before customers do.
