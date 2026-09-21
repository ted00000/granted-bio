# Pre-Oct 1, 2026 fiscal-year window snapshot

**Purpose.** Hard gate on the post-Oct 1 reconciliation. On Oct 1, three
movements happen simultaneously — the window floor advances from 2023 to
2024 (dropping FY2023 rows), the ~20K+ NIH RePORTER load lands, and any
FY2027 rows currently invisible become visible. Without a
pre-collision snapshot, any post-Oct 1 count discrepancy is
unattributable.

**Captured.** 2026-09-20, against a frozen `projects` table (RePORTER
refresh paused through end of month per Ted). Numbers match the
chief-of-staff review's SQL exactly.

## Snapshot

| Metric | Value |
| --- | --- |
| `is_bio_related = TRUE` at floor 2024 (old rule) | **196,801** |
| `is_bio_related = TRUE` at floor 2023 (new rule, in effect after Ship 1) | **199,171** |
| Delta Ship 1 admits | **+2,370 (+1.20%)** |
| FY2023 rows currently in-window, dropping on Oct 1 | **2,370** |
| FY2027 rows currently invisible, appearing on Oct 1 if any exist | **0** |

## FY distribution (2026-09-20)

| Fiscal year | Row count | Status post-Ship-1 |
| --- | --- | --- |
| FY2027 | 0 | currently invisible; appears on Oct 1 if any exist |
| FY2026 | 55,357 | in window |
| FY2025 | 71,371 | in window |
| FY2024 | 70,073 | in window |
| FY2023 | 2,370 | in window; drops on Oct 1 |
| FY2022 | 511 | outside window |
| FY2021 | 113 | outside window |
| FY2020 | 41 | outside window |

## Post-Oct 1 reconciliation formula

```
expected_post_roll_count = pre_snapshot_windowed
                        − fy2023_rows_dropping
                        + fy2027_rows_appearing
                        + inbound_load_rows_in_window
                        = 199,171 − 2,370 + fy2027_actual + load_actual
                        = 196,801 + fy2027_actual + load_actual
```

Anything unaccounted for after that arithmetic is a bug — either in
the window module, the ETL's FY tagging, or the reconciliation itself.

## Watch items

- **FY2027 tagging on the inbound load.** Awards made by Sep 30 are
  FY2026. Bulk of the ~20K+ load should tag FY2026, taking that year
  from 55,357 to ~75K (in line with FY2025's 71,371, which confirms
  the current FY2026 gap is ingest lag, not a real decline). If a
  meaningful share tags FY2027, stop and check the ETL's fiscal-year
  derivation before accepting the load. Two possible causes: (a) NIH
  began issuing FY2027 awards early — plausible, low volume; or (b)
  the ETL's FY derivation is off-by-one, same class as the Oct-Dec
  boundary in the window module.
- **The FY2023 self-reversal is the argument, not friction.** Ship 1
  admits FY2023's 2,370 rows on merge; Oct 1 drops them back out ten
  days later. That is the rule behaving as designed. Do NOT
  special-case FY2023, do NOT pin the floor by hand, do NOT preserve
  the rows. Pinning reintroduces exactly the drift Ship 1 exists to
  eliminate.

## Verification script

The counts above are reproducible with:

```python
from supabase import create_client
sb = create_client(URL, SERVICE_KEY)

def count(min_fy=None):
    q = sb.from_('projects').select('id', count='exact', head=True).eq('is_bio_related', True)
    if min_fy is not None:
        q = q.gte('fiscal_year', min_fy)
    return q.execute().count
```

The FY-boundary math is asserted by `scripts/verify-fiscal-year.ts`
(non-negotiable pre-ship gate).

## Documentation

The doc rewrite in `brain/wiki/` and `docs/DATA_PIPELINE_PLAN.md` for
the new "three complete FYs + FY in progress" framing lands in Ship 3,
AFTER Ship 2 is verified. See Ship sequence in commit message.
