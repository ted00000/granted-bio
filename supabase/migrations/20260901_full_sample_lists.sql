-- Persist the full analyzed sample for projects, organizations, and
-- researchers so the Data pages can offer paginated "show all"
-- drill-in on top of the existing top-N summary.
--
-- Before this migration, `report.projects` held the top 20 by
-- funding, `report.top_organizations` held the top 15, and
-- `report.top_researchers` held the top 15. The full aggregation
-- was computed at generation time then discarded. That's fine for
-- the narrative + summary tiles (which only reference the top-N),
-- but blocks any drill-in beyond that curated slice.
--
-- Contrast with clinical_trials / patents / publications — those
-- three columns already store the full linked list, which is why
-- the Trials / Patents / Publications pages can render every row
-- and their sidebar counts already match reality.
--
-- No backfill: old reports get NULL in the new columns and their
-- Data pages continue to show only the top-N (unchanged behavior).
-- New reports populate the full lists and expose the "show all N"
-- pagination affordance in the UI.
--
-- Storage cost: a typical report has 100–500 projects at ~1–2KB
-- each = 200KB–1MB per row. Postgres TOASTs JSONB columns so
-- large-row overhead is bounded; report throughput is ~2000/year
-- at aggressive growth, so total added storage is trivial.

ALTER TABLE user_reports
  ADD COLUMN IF NOT EXISTS all_projects JSONB,
  ADD COLUMN IF NOT EXISTS all_organizations JSONB,
  ADD COLUMN IF NOT EXISTS all_researchers JSONB;
