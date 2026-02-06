-- Fast keyword search function that does everything server-side
-- Returns aggregated counts by category and org_type plus sample results

CREATE OR REPLACE FUNCTION keyword_search(
  search_keyword TEXT,
  category_filter TEXT[] DEFAULT NULL,
  org_type_filter TEXT[] DEFAULT NULL,
  state_filter TEXT[] DEFAULT NULL,
  min_funding_filter NUMERIC DEFAULT NULL,
  result_limit INT DEFAULT 10
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  WITH matching_abstracts AS (
    -- Step 1: Find all abstracts containing the keyword
    SELECT application_id
    FROM abstracts
    WHERE abstract_text ILIKE '%' || search_keyword || '%'
  ),
  filtered_projects AS (
    -- Step 2: Get projects with optional filters
    SELECT
      p.application_id,
      p.project_number,
      p.title,
      p.org_name,
      p.org_state,
      p.org_type,
      p.primary_category,
      p.total_cost,
      p.pi_names
    FROM projects p
    INNER JOIN matching_abstracts ma ON p.application_id = ma.application_id
    WHERE
      (category_filter IS NULL OR p.primary_category::text = ANY(category_filter))
      AND (org_type_filter IS NULL OR p.org_type = ANY(org_type_filter))
      AND (state_filter IS NULL OR p.org_state = ANY(state_filter))
      AND (min_funding_filter IS NULL OR p.total_cost >= min_funding_filter)
  ),
  category_counts AS (
    -- Step 3: Aggregate by category
    SELECT
      COALESCE(primary_category, 'other') as category,
      COUNT(*) as count
    FROM filtered_projects
    GROUP BY COALESCE(primary_category, 'other')
  ),
  org_type_counts AS (
    -- Step 4: Aggregate by org_type
    SELECT
      COALESCE(org_type, 'other') as org_type,
      COUNT(*) as count
    FROM filtered_projects
    GROUP BY COALESCE(org_type, 'other')
  ),
  top_results AS (
    -- Step 5: Get top N results by funding
    SELECT *
    FROM filtered_projects
    ORDER BY total_cost DESC NULLS LAST
    LIMIT result_limit
  )
  SELECT json_build_object(
    'total_count', (SELECT COUNT(*) FROM filtered_projects),
    'by_category', (SELECT json_object_agg(category, count) FROM category_counts),
    'by_org_type', (SELECT json_object_agg(org_type, count) FROM org_type_counts),
    'sample_results', (
      SELECT json_agg(
        json_build_object(
          'application_id', application_id,
          'project_number', project_number,
          'title', title,
          'org_name', org_name,
          'org_state', org_state,
          'org_type', org_type,
          'primary_category', primary_category,
          'total_cost', total_cost,
          'pi_names', pi_names
        )
      )
      FROM top_results
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION keyword_search TO authenticated;
GRANT EXECUTE ON FUNCTION keyword_search TO anon;
GRANT EXECUTE ON FUNCTION keyword_search TO service_role;

-- Note: A GIN trigram index on abstract_text would speed up ILIKE searches
-- but takes too long to create. Run separately if needed:
-- CREATE INDEX CONCURRENTLY idx_abstracts_text_trgm ON abstracts USING gin (abstract_text gin_trgm_ops);
