-- ==========================================
-- Add Missing Fields and Critical Constraints
-- ==========================================
-- Date: 2026-02-02
-- Targets: enrollments, class_occurrences, occurrence_reports

-- 1. Add is_conducted to class_occurrences (Missing in DB)
ALTER TABLE class_occurrences 
ADD COLUMN IF NOT EXISTS is_conducted BOOLEAN DEFAULT TRUE;

-- 2. Add Critical UNIQUE constraints (Missing in DB, required for application logic)
-- These prevent duplicate occurrences and duplicate reports
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_occurrences_session_date_unique') THEN
        ALTER TABLE class_occurrences ADD CONSTRAINT class_occurrences_session_date_unique UNIQUE (class_session_id, occurrence_date);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'occurrence_reports_enrollment_occurrence_unique') THEN
        ALTER TABLE occurrence_reports ADD CONSTRAINT occurrence_reports_enrollment_occurrence_unique UNIQUE (enrollment_id, class_occurrence_id);
    END IF;
END $$;

-- 3. Cleanup / Verification of existing fields
-- The following fields already exist in the provided schema, so we just add comments to ensure documentation
COMMENT ON COLUMN enrollments.external_link IS 'Link to the main course/company report folder';
COMMENT ON COLUMN occurrence_reports.external_link IS 'Link to the specific individual report view';
COMMENT ON COLUMN class_occurrences.is_conducted IS 'Whether the class session was actually held on this date';
COMMENT ON COLUMN occurrence_reports.class_participation IS 'Numeric rating (0-5)';
COMMENT ON COLUMN occurrence_reports.classroom_behavior IS 'Numeric rating (0-5)';
