-- ==========================================
-- SECURITY PATCH: Add Missing RLS Policies
-- ==========================================
-- Date: 2026-02-02
-- Purpose: Fix security vulnerabilities by adding RLS to tables exposed to PostgREST
-- 
-- CRITICAL: This migration addresses the following security issues:
-- 1. class_occurrences - Missing RLS
-- 2. occurrence_reports - Missing RLS  
-- 3. report_versions - Missing RLS
-- 4. progress_letter constraint - Too restrictive (A-H instead of A-Z range support)

BEGIN;

-- ==========================================
-- 1. Enable RLS on class_occurrences
-- ==========================================

ALTER TABLE class_occurrences ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if any
DROP POLICY IF EXISTS "Users can manage their own class occurrences" ON class_occurrences;

-- Create policy: Users can manage occurrences for their own class sessions
CREATE POLICY "Users can manage their own class occurrences" 
  ON class_occurrences FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM class_sessions cs 
      WHERE cs.id = class_occurrences.class_session_id 
      AND cs.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM class_sessions cs 
      WHERE cs.id = class_occurrences.class_session_id 
      AND cs.user_id = auth.uid()
    )
  );

-- ==========================================
-- 2. Enable RLS on occurrence_reports
-- ==========================================

ALTER TABLE occurrence_reports ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if any
DROP POLICY IF EXISTS "Users can manage their own occurrence reports" ON occurrence_reports;

-- Create policy: Users can manage reports for their own enrollments
CREATE POLICY "Users can manage their own occurrence reports" 
  ON occurrence_reports FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM enrollments e 
      WHERE e.id = occurrence_reports.enrollment_id 
      AND e.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM enrollments e 
      WHERE e.id = occurrence_reports.enrollment_id 
      AND e.user_id = auth.uid()
    )
  );

-- ==========================================
-- 3. Enable RLS on report_versions
-- ==========================================

ALTER TABLE report_versions ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if any
DROP POLICY IF EXISTS "Users can manage their own report versions" ON report_versions;

-- Create policy: Users can view versions for their own reports
CREATE POLICY "Users can manage their own report versions" 
  ON report_versions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM occurrence_reports orep
      JOIN enrollments e ON e.id = orep.enrollment_id
      WHERE orep.id = report_versions.occurrence_report_id 
      AND e.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM occurrence_reports orep
      JOIN enrollments e ON e.id = orep.enrollment_id
      WHERE orep.id = report_versions.occurrence_report_id 
      AND e.user_id = auth.uid()
    )
  );

-- ==========================================
-- 4. Fix progress_letter constraint
-- ==========================================

-- Drop old constraint (A-H only)
ALTER TABLE occurrence_reports DROP CONSTRAINT IF EXISTS occurrence_reports_progress_letter_check;

-- Add new constraint supporting:
-- - Single letter: A, B, C... Z
-- - Range: A-Z, A-B, etc.
ALTER TABLE occurrence_reports ADD CONSTRAINT occurrence_reports_progress_letter_check 
  CHECK (progress_letter ~ '^[A-Z](-[A-Z])?$');

-- Update indexes if needed
CREATE INDEX IF NOT EXISTS idx_occurrence_reports_progress ON occurrence_reports(progress_letter);

COMMIT;

-- Verification queries (run manually to verify):
-- SELECT tablename, policyname, permissive, roles, cmd, qual 
-- FROM pg_policies 
-- WHERE schemaname = 'public' 
-- AND tablename IN ('class_occurrences', 'occurrence_reports', 'report_versions');
