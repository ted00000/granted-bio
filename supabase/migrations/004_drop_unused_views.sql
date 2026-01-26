-- Drop unused materialized views to save database space
-- These were from an earlier design but are not used in the application

DROP MATERIALIZED VIEW IF EXISTS biotools_high_confidence;
DROP MATERIALIZED VIEW IF EXISTS projects_enriched;

-- Note: The projects table and all actual data remain intact
-- This only removes the cached/duplicated views
