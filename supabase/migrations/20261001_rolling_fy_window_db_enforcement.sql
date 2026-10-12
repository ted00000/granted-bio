-- Rolling 4-year NIH fiscal-year window — DB-side source of truth.
--
-- Companion to src/lib/reports/fiscal-year.ts (TypeScript) and
-- etl/fiscal_year.py (Python). All three implementations must stay
-- functionally identical: NIH FY runs Oct 1 → Sep 30, named by the
-- ending calendar year. Rolling retention = 3 complete FYs + FY in
-- progress = 4 total; floor = currentFY - 3.
--
-- Why DB-side enforcement matters: before this migration, the
-- `search_projects_filtered` RPC treated `filter_fiscal_years IS NULL`
-- as "no fiscal-year filter at all." Any caller that passed NULL —
-- deliberately or by accident — got unrestricted historical data,
-- bypassing the product's retention window. The two chat-tool
-- callers in src/lib/chat/tools.ts pass NULL when the user hasn't
-- specified a filter, which silently gave them pre-window rows.
--
-- Post-migration behavior: NULL defaults to the current rolling
-- window via COALESCE. The DB becomes the enforcement point — any
-- future caller gets correct behavior without needing to know the
-- window arithmetic. Callers that genuinely want unrestricted scope
-- (e.g. historical diagnostic scripts) must pass an explicit array;
-- there's no implicit way to bypass the window anymore.

-- ============================================================
-- Shared helpers
-- ============================================================

CREATE OR REPLACE FUNCTION get_current_nih_fiscal_year() RETURNS INT AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'UTC')) >= 10
      THEN EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'UTC'))::INT + 1
    ELSE EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'UTC'))::INT
  END;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_min_fiscal_year() RETURNS INT AS $$
  SELECT get_current_nih_fiscal_year() - 3;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_windowed_fiscal_years() RETURNS INT[] AS $$
  SELECT ARRAY(
    SELECT generate_series(get_min_fiscal_year(), get_current_nih_fiscal_year())
  );
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION get_current_nih_fiscal_year IS
  'NIH fiscal year as of now (UTC). FY{Y} = Oct 1 of (Y-1) → Sep 30 of Y.';
COMMENT ON FUNCTION get_min_fiscal_year IS
  'Rolling retention floor: currentFY - 3 (4-year window).';
COMMENT ON FUNCTION get_windowed_fiscal_years IS
  'Rolling retention window as INT[]: [floor, ..., currentFY].';

-- ============================================================
-- Update search_projects_filtered to apply the window by default
-- ============================================================
--
-- Signature unchanged — callers continue to call the function the
-- same way. Only the behavior when filter_fiscal_years IS NULL
-- changes: now defaults to the rolling window instead of returning
-- unrestricted rows.
--
-- The ARRAY[]::INT[] (empty array) sentinel is the explicit "no
-- filter" escape hatch for diagnostic scripts that need historical
-- data. User-facing surfaces should never pass that.

DROP FUNCTION IF EXISTS search_projects_filtered(
  VECTOR(1536), FLOAT, INT, INT,
  INT[], TEXT[], TEXT[], TEXT[], NUMERIC, NUMERIC,
  TEXT[], TEXT[], TEXT[], NUMERIC
);

CREATE OR REPLACE FUNCTION search_projects_filtered(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 50,
  min_biotools_confidence INT DEFAULT 0,
  filter_fiscal_years INT[] DEFAULT NULL,
  filter_categories TEXT[] DEFAULT NULL,
  filter_org_types TEXT[] DEFAULT NULL,
  filter_states TEXT[] DEFAULT NULL,
  filter_min_funding NUMERIC DEFAULT NULL,
  filter_max_funding NUMERIC DEFAULT NULL,
  filter_admin_ics TEXT[] DEFAULT NULL,
  filter_foa_numbers TEXT[] DEFAULT NULL,
  filter_spending_categories TEXT[] DEFAULT NULL,
  filter_min_direct_cost NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  application_id VARCHAR(20),
  project_number VARCHAR(50),
  title TEXT,
  phr TEXT,
  org_name VARCHAR(500),
  org_type VARCHAR(50),
  org_city VARCHAR(100),
  org_state VARCHAR(10),
  total_cost NUMERIC,
  fiscal_year INT,
  funding_mechanism VARCHAR(100),
  primary_category bio_category,
  biotools_confidence DOUBLE PRECISION,
  biotools_reasoning TEXT,
  pi_names TEXT,
  is_supplement BOOLEAN,
  supplement_number VARCHAR(10),
  contact_pi_name TEXT,
  admin_ic VARCHAR(20),
  foa_number VARCHAR(50),
  direct_cost_amt NUMERIC,
  indirect_cost_amt NUMERIC,
  study_section VARCHAR(300),
  spending_categories TEXT[],
  similarity FLOAT
) AS $$
DECLARE
  -- Apply the window default. NULL → current rolling window.
  -- Empty array ARRAY[]::INT[] → explicit "no filter" escape hatch
  -- for diagnostic / historical queries.
  effective_fiscal_years INT[] := COALESCE(
    filter_fiscal_years,
    get_windowed_fiscal_years()
  );
BEGIN
  SET LOCAL hnsw.ef_search = 200;
  RETURN QUERY
  SELECT
    p.id, p.application_id, p.project_number, p.title, p.phr,
    p.org_name, p.org_type, p.org_city, p.org_state, p.total_cost,
    p.fiscal_year, p.funding_mechanism, p.primary_category,
    p.biotools_confidence, p.biotools_reasoning, p.pi_names,
    p.is_supplement, p.supplement_number,
    p.contact_pi_name, p.admin_ic, p.foa_number,
    p.direct_cost_amt, p.indirect_cost_amt,
    p.study_section, p.spending_categories,
    (1 - (p.abstract_embedding <=> query_embedding))::FLOAT as similarity
  FROM projects p
  WHERE p.abstract_embedding IS NOT NULL
    AND p.is_bio_related = true
    AND (1 - (p.abstract_embedding <=> query_embedding)) > match_threshold
    AND (min_biotools_confidence = 0
         OR p.biotools_confidence >= min_biotools_confidence)
    -- Fiscal-year window — defaults to current rolling window if NULL,
    -- bypasses only if an empty array was explicitly passed.
    AND (cardinality(effective_fiscal_years) = 0
         OR p.fiscal_year = ANY(effective_fiscal_years))
    AND (filter_categories IS NULL
         OR p.primary_category::TEXT = ANY(filter_categories))
    AND (filter_org_types IS NULL OR p.org_type = ANY(filter_org_types))
    AND (filter_states IS NULL OR p.org_state = ANY(filter_states))
    AND (filter_min_funding IS NULL OR p.total_cost >= filter_min_funding)
    AND (filter_max_funding IS NULL OR p.total_cost <= filter_max_funding)
    AND (filter_admin_ics IS NULL OR p.admin_ic = ANY(filter_admin_ics))
    AND (filter_foa_numbers IS NULL
         OR p.foa_number = ANY(filter_foa_numbers))
    AND (filter_spending_categories IS NULL
         OR p.spending_categories @> filter_spending_categories)
    AND (filter_min_direct_cost IS NULL
         OR p.direct_cost_amt >= filter_min_direct_cost)
  ORDER BY p.abstract_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_projects_filtered IS
  'Semantic search over projects with the rolling fiscal-year window applied by default. Pass filter_fiscal_years=NULL (or omit) to get the window; pass ARRAY[]::INT[] to opt out explicitly.';
