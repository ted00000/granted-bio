-- Add progress_stage column to track report generation progress
-- This enables showing granular progress to users while reports generate

ALTER TABLE user_reports
ADD COLUMN progress_stage VARCHAR(50) DEFAULT NULL;

-- Possible values:
-- 'searching_projects' - Phase 1a: Running projects agent
-- 'gathering_data' - Phase 1b: Running trials, patents, publications, market agents
-- 'aggregating' - Phase 2: Aggregating statistics
-- 'synthesizing' - Phase 3: AI synthesis and report generation
-- NULL when complete or failed

COMMENT ON COLUMN user_reports.progress_stage IS 'Current generation stage for progress indication';
