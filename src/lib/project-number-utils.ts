/**
 * NIH project_number utilities shared across report, chat, and API surfaces.
 *
 * Why this lives here: the projects table stores project_number in MIXED
 * format — some rows in core form ("R01MH134973"), some in full form
 * ("5R01MH134973-02"). Linkage tables (clinical_studies, project_patents,
 * project_publications) always use core. Without a normalization layer,
 * any `.in('project_number', someList)` query against a linkage table
 * silently undercounts whenever a project is stored in full form.
 *
 * Verified 2026-06-29: this caused Key Organizations to show 0 trials /
 * 0 patents for UCLA, MGH, and any other org whose analyzed projects
 * happened to be full-form. Fixed at the report-gen layer (commit 55b3c2e)
 * and now centralized here so chat tools and org page API routes use the
 * same normalization.
 */

/**
 * Strip funding-type prefix and year suffix from a project_number to
 * get the core grant identifier.
 *
 * Examples:
 *   "5R44MH136894-02"   → "R44MH136894"
 *   "1R01HG011711-01A1" → "R01HG011711"
 *   "R01HG011711"       → "R01HG011711"  (already core)
 *   "ZIABC011090"       → "ZIABC011090"  (intramural, no prefix/suffix)
 */
export function getCoreProjectNumber(projectNumber: string | null | undefined): string {
  if (!projectNumber) return ''
  let core = projectNumber.trim().toUpperCase()
  // Strip leading funding-type digit (1, 2, 3, 4, 5, 6, 7, 8, 9)
  core = core.replace(/^[0-9]/, '')
  // Strip year suffix (-01, -02, etc.)
  core = core.replace(/-\d+$/, '')
  // Strip variant suffix (-S1, -A1, etc.)
  core = core.replace(/-[A-Z]\d+$/, '')
  return core
}

/**
 * Expand a list of project_numbers to include both the as-stored form
 * AND the core form for each. Use this on the right-hand side of any
 * `.in('project_number', ...)` query against the projects table or any
 * linkage table — it guarantees we match rows regardless of whether
 * they're stored core or full.
 *
 * Deduplicates and filters out empty strings.
 */
export function expandProjectNumberVariants(projectNumbers: (string | null | undefined)[]): string[] {
  const out = new Set<string>()
  for (const pn of projectNumbers) {
    if (!pn) continue
    const trimmed = pn.trim()
    if (!trimmed) continue
    out.add(trimmed)
    const core = getCoreProjectNumber(trimmed)
    if (core && core !== trimmed) out.add(core)
  }
  return Array.from(out)
}
