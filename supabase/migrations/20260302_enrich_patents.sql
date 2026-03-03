-- Enrich patents table with full USPTO PatentsView data
-- Enables internal patent detail pages and agent access for reports

-- Add enrichment columns
ALTER TABLE patents ADD COLUMN IF NOT EXISTS patent_abstract TEXT;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS patent_date DATE;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS patent_type VARCHAR(50);
ALTER TABLE patents ADD COLUMN IF NOT EXISTS assignees TEXT[];
ALTER TABLE patents ADD COLUMN IF NOT EXISTS inventors TEXT[];
ALTER TABLE patents ADD COLUMN IF NOT EXISTS cpc_codes TEXT[];
ALTER TABLE patents ADD COLUMN IF NOT EXISTS cited_by_count INT DEFAULT 0;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS api_last_updated TIMESTAMPTZ;

-- Add index for browsing by date
CREATE INDEX IF NOT EXISTS idx_patents_date ON patents(patent_date DESC NULLS LAST);

-- Add index for filtering by type
CREATE INDEX IF NOT EXISTS idx_patents_type ON patents(patent_type);

COMMENT ON COLUMN patents.patent_abstract IS 'Patent abstract from USPTO PatentsView API';
COMMENT ON COLUMN patents.patent_date IS 'Patent grant date';
COMMENT ON COLUMN patents.patent_type IS 'Patent type (utility, design, plant, reissue)';
COMMENT ON COLUMN patents.assignees IS 'Array of assignee organization names';
COMMENT ON COLUMN patents.inventors IS 'Array of inventor names (First Last format)';
COMMENT ON COLUMN patents.cpc_codes IS 'Array of CPC classification codes';
COMMENT ON COLUMN patents.cited_by_count IS 'Number of patents that cite this patent';
COMMENT ON COLUMN patents.api_last_updated IS 'Timestamp of last USPTO API fetch';
