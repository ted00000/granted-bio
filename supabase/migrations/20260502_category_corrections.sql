-- Category corrections table
-- Stores admin reviews of borderline category classifications.
-- Acts as both the audit trail and the "reviewed" tracker — a row here means the
-- project has been seen by a human and either confirmed (corrected_category =
-- original_category) or reassigned.

CREATE TABLE category_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to project
  application_id VARCHAR(20) REFERENCES projects(application_id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- Snapshot of model's prediction at review time
  original_category bio_category NOT NULL,
  original_confidence FLOAT,

  -- Reviewer's decision
  corrected_category bio_category NOT NULL,
  reason_code VARCHAR(50),  -- 'activity_code_misleading' | 'abstract_describes_development' | 'narrow_scope' | 'other' | NULL
  notes TEXT,

  -- Audit
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_category_corrections_application_id ON category_corrections(application_id);
CREATE INDEX idx_category_corrections_reviewed_at ON category_corrections(reviewed_at DESC);
CREATE INDEX idx_category_corrections_original_category ON category_corrections(original_category);
CREATE INDEX idx_category_corrections_corrected_category ON category_corrections(corrected_category);

-- RLS: admin-only access
ALTER TABLE category_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read category corrections"
  ON category_corrections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert category corrections"
  ON category_corrections FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update category corrections"
  ON category_corrections FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  );
