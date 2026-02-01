-- Migration: Add lesson tracking and completion status to occurrence reports
-- Created: 2026-02-02
-- Description: Adds lesson_id and is_completed columns to track which lesson was taught
--              and whether it was completed, enabling automatic progress tracking

BEGIN;

-- Add lesson tracking columns
ALTER TABLE occurrence_reports 
ADD COLUMN lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
ADD COLUMN is_completed BOOLEAN DEFAULT TRUE;

-- Add detailed report fields
ALTER TABLE occurrence_reports
ADD COLUMN progress_letter VARCHAR(1) CHECK (progress_letter ~ '^[A-H]$'),
ADD COLUMN attendance_status VARCHAR(20) DEFAULT 'present' CHECK (attendance_status IN ('present', 'absent')),
ADD COLUMN absence_reason VARCHAR(100),
ADD COLUMN class_participation TEXT,
ADD COLUMN classroom_behavior TEXT,
ADD COLUMN contact_notes TEXT,
ADD COLUMN class_notes TEXT;

-- Create indexes for faster queries
CREATE INDEX idx_occurrence_reports_lesson_id ON occurrence_reports(lesson_id);
CREATE INDEX idx_occurrence_reports_enrollment_lesson ON occurrence_reports(enrollment_id, lesson_id);
CREATE INDEX idx_occurrence_reports_attendance ON occurrence_reports(attendance_status);

-- Add comments for clarity
COMMENT ON COLUMN occurrence_reports.lesson_id IS 'Which lesson was taught in this occurrence';
COMMENT ON COLUMN occurrence_reports.is_completed IS 'Whether the lesson was completed';
COMMENT ON COLUMN occurrence_reports.progress_letter IS 'Progress indicator (A-H) when lesson is incomplete';
COMMENT ON COLUMN occurrence_reports.attendance_status IS 'Whether student attended the class';
COMMENT ON COLUMN occurrence_reports.absence_reason IS 'Reason for absence if not attended';
COMMENT ON COLUMN occurrence_reports.class_participation IS 'Student participation level/notes';
COMMENT ON COLUMN occurrence_reports.classroom_behavior IS 'Student behavior/discipline notes';
COMMENT ON COLUMN occurrence_reports.contact_notes IS 'Notes for parent communication';
COMMENT ON COLUMN occurrence_reports.class_notes IS 'Teacher observation notes (not learning report)';

COMMIT;

-- Rollback script (if needed):
-- BEGIN;
-- DROP INDEX IF EXISTS idx_occurrence_reports_enrollment_lesson;
-- DROP INDEX IF EXISTS idx_occurrence_reports_lesson_id;
-- ALTER TABLE occurrence_reports DROP COLUMN IF EXISTS is_completed;
-- ALTER TABLE occurrence_reports DROP COLUMN IF EXISTS lesson_id;
-- COMMIT;
