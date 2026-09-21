/**
 * FY-boundary verification. Non-negotiable pre-ship gate on any change to
 * getCurrentNihFiscalYear / getMinFiscalYear.
 *
 * The FY-boundary arithmetic (Oct-Dec = FY N+1) is the silent-failure axis:
 * a wrong month check rolls the window three months late every year and
 * nothing visibly breaks. These cases pin the exact moments where the answer
 * changes.
 *
 * Run: npx tsx scripts/verify-fiscal-year.ts
 * Exit 0 = all boundaries correct. Non-zero = STOP, do not merge.
 */

import {
  getCurrentNihFiscalYear,
  getMinFiscalYear,
  getWindowedFiscalYears,
  RETENTION_WINDOW_YEARS,
} from '../src/lib/reports/fiscal-year'

let failures = 0

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`  ${mark}  ${label}  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)
  if (!ok) failures++
}

console.log('=== Constants ===')
check('RETENTION_WINDOW_YEARS = 4', RETENTION_WINDOW_YEARS, 4)

console.log('\n=== currentFY / minFY at the Oct 1 boundary ===')
// The one case that matters. If getUTCMonth() ever comes back local instead
// of UTC, this pair silently starts giving the wrong answer for 22-4 hours
// depending on server region.
check(
  'Sep 30 23:59:59 UTC 2026 → currentFY = 2026',
  getCurrentNihFiscalYear(new Date('2026-09-30T23:59:59.999Z')),
  2026,
)
check(
  'Oct  1 00:00:00 UTC 2026 → currentFY = 2027',
  getCurrentNihFiscalYear(new Date('2026-10-01T00:00:00.000Z')),
  2027,
)
check(
  'Sep 30 23:59:59 UTC 2026 → minFY = 2023',
  getMinFiscalYear(new Date('2026-09-30T23:59:59.999Z')),
  2023,
)
check(
  'Oct  1 00:00:00 UTC 2026 → minFY = 2024',
  getMinFiscalYear(new Date('2026-10-01T00:00:00.000Z')),
  2024,
)

console.log('\n=== Dec / Jan sanity — calendar year rolls, FY does not ===')
// Common confused case: Jan 1 does NOT roll the FY. FY rolls only on Oct 1.
check(
  'Dec 31 23:59:59 UTC 2026 → currentFY = 2027',
  getCurrentNihFiscalYear(new Date('2026-12-31T23:59:59.999Z')),
  2027,
)
check(
  'Jan  1 00:00:00 UTC 2027 → currentFY = 2027 (unchanged from Dec)',
  getCurrentNihFiscalYear(new Date('2027-01-01T00:00:00.000Z')),
  2027,
)

console.log('\n=== A December case — Ted asked for one ===')
// Concrete: mid-Dec 2026 sits in FY2027. Floor is 2024.
check(
  'Dec 15 12:00:00 UTC 2026 → currentFY = 2027, minFY = 2024',
  {
    currentFY: getCurrentNihFiscalYear(new Date('2026-12-15T12:00:00.000Z')),
    minFY: getMinFiscalYear(new Date('2026-12-15T12:00:00.000Z')),
  },
  { currentFY: 2027, minFY: 2024 },
)

console.log('\n=== Feb 29 leap year sanity ===')
// Feb 29 exists in 2024 and 2028. Confirm the math doesn't blow up.
check(
  'Feb 29 UTC 2024 → currentFY = 2024',
  getCurrentNihFiscalYear(new Date('2024-02-29T12:00:00.000Z')),
  2024,
)

console.log('\n=== getWindowedFiscalYears — 4-year window array ===')
check(
  'Sep 20 2026 → [2023, 2024, 2025, 2026]',
  getWindowedFiscalYears(new Date('2026-09-20T12:00:00.000Z')),
  [2023, 2024, 2025, 2026],
)
check(
  'Oct  1 2026 → [2024, 2025, 2026, 2027] (FY2023 drops, FY2027 opens)',
  getWindowedFiscalYears(new Date('2026-10-01T00:00:00.000Z')),
  [2024, 2025, 2026, 2027],
)
check(
  'Oct  1 2027 → [2025, 2026, 2027, 2028] (FY2024 drops)',
  getWindowedFiscalYears(new Date('2027-10-01T00:00:00.000Z')),
  [2025, 2026, 2027, 2028],
)

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S) — STOP, do not merge`}`)
process.exit(failures === 0 ? 0 : 1)
