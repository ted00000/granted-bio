/**
 * NIH fiscal year helpers.
 * NIH FY runs Oct 1 - Sep 30. FY{Y} = Oct 1 of (Y-1) → Sep 30 of Y.
 */

export function getCurrentNihFiscalYear(date: Date = new Date()): number {
  const month = date.getUTCMonth() // 0-11
  const year = date.getUTCFullYear()
  // Oct (9), Nov (10), Dec (11) → next calendar year's FY
  return month >= 9 ? year + 1 : year
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
