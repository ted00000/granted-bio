"""
NIH fiscal-year helpers — Python mirror of src/lib/reports/fiscal-year.ts.

NIH FY runs Oct 1 → Sep 30. FY{Y} = Oct 1 of (Y-1) → Sep 30 of Y.

Rolling retention window: three complete fiscal years plus the fiscal
year in progress = four years total. Floor = currentFY - 3.

Steady state: three mature FYs + one filling. The window advances at
the NIH FY boundary (Oct 1) — FY{floor} drops out only after the new
FY has opened, so a mature year is never removed mid-quarter.

Do NOT introduce a duplicate literal (`MIN_FISCAL_YEAR = 2024`,
`FISCAL_YEARS = [2024, 2025, 2026]`, etc.) anywhere else. The whole
point of this module is that the floor is computed, not typed. Any
site that needs the window imports from here.

Must stay functionally identical to src/lib/reports/fiscal-year.ts.
Boundary tests in etl/test_fiscal_year.py mirror the TS tests.
"""

from datetime import datetime, timezone
from typing import List, Optional

RETENTION_WINDOW_YEARS = 4


def get_current_nih_fiscal_year(d: Optional[datetime] = None) -> int:
    """Current NIH fiscal year as of `d` (defaults to now, UTC).

    NIH FY{Y} runs Oct 1 of (Y-1) through Sep 30 of Y. So any date in
    Oct/Nov/Dec belongs to FY of the FOLLOWING calendar year; any date
    in Jan-Sep belongs to FY of the SAME calendar year.
    """
    if d is None:
        d = datetime.now(timezone.utc)
    # UTC month is 1-12; TS version uses 0-indexed (month >= 9). Here
    # we use 1-indexed (month >= 10) for the same semantic.
    month = d.astimezone(timezone.utc).month
    year = d.astimezone(timezone.utc).year
    return year + 1 if month >= 10 else year


def get_min_fiscal_year(d: Optional[datetime] = None) -> int:
    """Rolling floor: currentFY - (RETENTION_WINDOW_YEARS - 1).

    Do not type a literal. The Oct-boundary arithmetic is the
    silent-failure axis — if this is off by one, the window rolls
    three months late every year and nothing visibly breaks.
    """
    return get_current_nih_fiscal_year(d) - (RETENTION_WINDOW_YEARS - 1)


def get_windowed_fiscal_years(d: Optional[datetime] = None) -> List[int]:
    """List [floor, floor+1, ..., currentFY] for the current window.

    Use this when calling RePORTER's `fiscal_years` filter or any
    other API/DB call that takes a year list rather than a floor.
    """
    current = get_current_nih_fiscal_year(d)
    floor = get_min_fiscal_year(d)
    return list(range(floor, current + 1))
