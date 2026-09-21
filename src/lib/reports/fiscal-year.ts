/**
 * NIH fiscal year helpers.
 * NIH FY runs Oct 1 - Sep 30. FY{Y} = Oct 1 of (Y-1) → Sep 30 of Y.
 */

/**
 * Rolling retention window: three complete fiscal years plus the fiscal year
 * in progress = four years total. Floor = currentFY - 3.
 *
 * Steady state: three mature FYs + one filling. The window advances at the
 * NIH FY boundary (Oct 1) — FY{floor} drops out only after the new FY has
 * opened, so a mature year is never removed mid-quarter.
 *
 * Superseded 2026-09-20: the previous "current FY + 2 prior" (3-year window)
 * would have dropped FY2024 the moment FY2027 opened with near-zero data.
 * Unacceptable — hence the 4-year framing.
 *
 * Do NOT introduce a duplicate literal (`MIN_FISCAL_YEAR = 2024`, floor = 2023,
 * etc.) anywhere else. The whole point of this module is that the floor is
 * computed, not typed. See docs/DATA_PIPELINE_PLAN.md.
 */
export const RETENTION_WINDOW_YEARS = 4

export function getCurrentNihFiscalYear(date: Date = new Date()): number {
  const month = date.getUTCMonth() // 0-11
  const year = date.getUTCFullYear()
  // Oct (9), Nov (10), Dec (11) → next calendar year's FY
  return month >= 9 ? year + 1 : year
}

/**
 * Rolling floor for the product surface. Callers use this — or the
 * `getWindowedFiscalYears()` array below — to window a query.
 *
 * Never type a literal. The FY-boundary arithmetic (Oct-Dec = FY N+1) is the
 * silent-failure axis: if this function is wrong, the window rolls three
 * months late every year and nothing visibly breaks. Boundary unit tests
 * live in ./fiscal-year.test.ts.
 */
export function getMinFiscalYear(date: Date = new Date()): number {
  return getCurrentNihFiscalYear(date) - (RETENTION_WINDOW_YEARS - 1)
}

/**
 * Fiscal years currently in the window, as an array [floor, floor+1, ...,
 * currentFY]. Convenient for `search_projects_filtered`'s `filter_fiscal_years
 * INT[]` parameter, and any other RPC that takes a year list rather than a
 * floor.
 */
export function getWindowedFiscalYears(date: Date = new Date()): number[] {
  const current = getCurrentNihFiscalYear(date)
  const floor = getMinFiscalYear(date)
  const years: number[] = []
  for (let y = floor; y <= current; y++) years.push(y)
  return years
}

/**
 * A fiscal year is considered partial if it has not yet ended at the given date.
 * In practice, the current NIH FY is always partial. Any FY whose Sep 30 end
 * date is in the future is partial.
 */
export function isPartialFiscalYear(fy: number, asOf: Date = new Date()): boolean {
  // End of FY{Y} is Sep 30 of year Y
  const fyEnd = Date.UTC(fy, 8, 30, 23, 59, 59) // Sep is month 8 (0-indexed)
  return asOf.getTime() < fyEnd
}

/**
 * Months elapsed in the given fiscal year as of the given date.
 * Returns 12 if the FY has fully ended; 0 if it hasn't started.
 */
export function monthsElapsedInFY(fy: number, asOf: Date = new Date()): number {
  const fyStart = Date.UTC(fy - 1, 9, 1) // Oct 1 of (Y-1)
  const fyEnd = Date.UTC(fy, 8, 30, 23, 59, 59)
  const now = asOf.getTime()
  if (now < fyStart) return 0
  if (now >= fyEnd) return 12
  const elapsedMs = now - fyStart
  return Math.min(12, Math.max(0, Math.floor(elapsedMs / (30.44 * 24 * 60 * 60 * 1000))))
}

/**
 * Human-readable label for the partial-FY footnote.
 * e.g. "Through May 2026; FY2026 ends Sep 30, 2026."
 */
export function formatPartialFYLabel(fy: number, asOf: Date = new Date()): string {
  const monthName = asOf.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  const year = asOf.getUTCFullYear()
  return `Through ${monthName} ${year}; FY${fy} ends Sep 30, ${fy}.`
}
