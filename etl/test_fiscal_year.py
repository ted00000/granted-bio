#!/usr/bin/env python3
"""Boundary tests for etl/fiscal_year.py — Python mirror of
scripts/verify-fiscal-year.ts. Must stay in sync with the TS version;
any new case added there needs a matching case here.

The FY-boundary arithmetic (Oct-Dec = FY N+1) is the silent-failure
axis: a wrong month check rolls the window three months late every
year and nothing visibly breaks. These cases pin the exact moments
where the answer changes.

Run with: python3 etl/test_fiscal_year.py
Exit 0 = all pass. Non-zero = STOP, do not run the ETL.
"""

import sys
from datetime import datetime, timezone

from fiscal_year import (
    RETENTION_WINDOW_YEARS,
    get_current_nih_fiscal_year,
    get_min_fiscal_year,
    get_windowed_fiscal_years,
)


def utc(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace('Z', '+00:00'))


failures = 0


def check(label: str, actual, expected) -> None:
    global failures
    ok = actual == expected
    mark = 'PASS' if ok else 'FAIL'
    print(f'  {mark}  {label}  actual={actual!r} expected={expected!r}')
    if not ok:
        failures += 1


print('=== Constants ===')
check('RETENTION_WINDOW_YEARS = 4', RETENTION_WINDOW_YEARS, 4)

print('\n=== currentFY / minFY at the Oct 1 boundary ===')
check(
    'Sep 30 23:59:59 UTC 2026 → currentFY = 2026',
    get_current_nih_fiscal_year(utc('2026-09-30T23:59:59.999Z')),
    2026,
)
check(
    'Oct  1 00:00:00 UTC 2026 → currentFY = 2027',
    get_current_nih_fiscal_year(utc('2026-10-01T00:00:00.000Z')),
    2027,
)
check(
    'Sep 30 23:59:59 UTC 2026 → minFY = 2023',
    get_min_fiscal_year(utc('2026-09-30T23:59:59.999Z')),
    2023,
)
check(
    'Oct  1 00:00:00 UTC 2026 → minFY = 2024',
    get_min_fiscal_year(utc('2026-10-01T00:00:00.000Z')),
    2024,
)

print('\n=== Dec / Jan sanity — calendar year rolls, FY does not ===')
check(
    'Dec 31 23:59:59 UTC 2026 → currentFY = 2027',
    get_current_nih_fiscal_year(utc('2026-12-31T23:59:59.999Z')),
    2027,
)
check(
    'Jan  1 00:00:00 UTC 2027 → currentFY = 2027 (unchanged from Dec)',
    get_current_nih_fiscal_year(utc('2027-01-01T00:00:00.000Z')),
    2027,
)

print('\n=== Mid-December sanity ===')
check(
    'Dec 15 12:00:00 UTC 2026 → currentFY=2027, minFY=2024',
    (
        get_current_nih_fiscal_year(utc('2026-12-15T12:00:00.000Z')),
        get_min_fiscal_year(utc('2026-12-15T12:00:00.000Z')),
    ),
    (2027, 2024),
)

print('\n=== Feb 29 leap year sanity ===')
check(
    'Feb 29 UTC 2024 → currentFY = 2024',
    get_current_nih_fiscal_year(utc('2024-02-29T12:00:00.000Z')),
    2024,
)

print('\n=== get_windowed_fiscal_years — 4-year window list ===')
check(
    'Sep 20 2026 → [2023, 2024, 2025, 2026]',
    get_windowed_fiscal_years(utc('2026-09-20T12:00:00.000Z')),
    [2023, 2024, 2025, 2026],
)
check(
    'Oct  1 2026 → [2024, 2025, 2026, 2027] (FY2023 drops, FY2027 opens)',
    get_windowed_fiscal_years(utc('2026-10-01T00:00:00.000Z')),
    [2024, 2025, 2026, 2027],
)
check(
    'Oct  1 2027 → [2025, 2026, 2027, 2028] (FY2024 drops)',
    get_windowed_fiscal_years(utc('2027-10-01T00:00:00.000Z')),
    [2025, 2026, 2027, 2028],
)

print(f"\n{'ALL PASS' if failures == 0 else f'{failures} FAILURE(S) — STOP, do not run the ETL'}")
sys.exit(0 if failures == 0 else 1)
