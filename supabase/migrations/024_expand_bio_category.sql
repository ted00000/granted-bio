-- Expand bio_category enum to include more research categories
-- This reduces the "other" bucket from ~37% to ~10-15%

-- Add new category values to the enum
ALTER TYPE bio_category ADD VALUE IF NOT EXISTS 'basic_research';
ALTER TYPE bio_category ADD VALUE IF NOT EXISTS 'clinical';
ALTER TYPE bio_category ADD VALUE IF NOT EXISTS 'public_health';
ALTER TYPE bio_category ADD VALUE IF NOT EXISTS 'training';
ALTER TYPE bio_category ADD VALUE IF NOT EXISTS 'infrastructure';

-- Note: After running this migration, run the reclassification script
-- to assign the 48K "other" projects to appropriate new categories.

COMMENT ON TYPE bio_category IS 'Project categories: biotools, therapeutics, diagnostics, medical_device, digital_health, basic_research, clinical, public_health, training, infrastructure, other';
