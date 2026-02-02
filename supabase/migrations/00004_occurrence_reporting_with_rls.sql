-- ==========================================
-- Occurrence-Based Reporting System
-- ==========================================
-- Tables: Class Occurrences, Occurrence Reports, Report Versions
-- Date: 2026-02-02
-- Dependencies: 00001, 00002, 00003
-- FIXES: Adds missing RLS policies for security compliance

-- ==========================================
-- 1. Class Occurrences
-- ==========================================

CREATE TABLE IF NOT EXISTS class_occurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
  
  -- Times from class_session, can be overridden
  original_start_time TIME,
  original_end_time TIME,
  actual_start_time TIME,
  actual_end_time TIME,
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(class_session_id, occurrence_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_class_occurrences_session ON class_occurrences(class_session_id);
CREATE INDEX IF NOT EXISTS idx_class_occurrences_date ON class_occurrences(occurrence_date);
CREATE INDEX IF NOT EXISTS idx_class_occurrences_status ON class_occurrences(status);

-- RLS (SECURITY FIX)
ALTER TABLE class_occurrences ENABLE ROW LEVEL SECURITY;

-- Allow users to manage occurrences for their own class sessions
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

-- Trigger
CREATE OR REPLACE FUNCTION update_class_occurrences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_class_occurrences_updated_at
  BEFORE UPDATE ON class_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION update_class_occurrences_updated_at();

-- ==========================================
-- 2. Occurrence Reports
-- ==========================================

CREATE TABLE IF NOT EXISTS occurrence_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  class_occurrence_id UUID NOT NULL REFERENCES class_occurrences(id) ON DELETE CASCADE,
  lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  
  -- Content and versioning
  content TEXT DEFAULT '',
  version INTEGER DEFAULT 1,
  
  -- Completion tracking
  is_completed BOOLEAN DEFAULT TRUE,
  progress_letter VARCHAR(3) CHECK (progress_letter ~ '^[A-Z](-[A-Z])?$'),
  
  -- Attendance
  attendance_status VARCHAR(20) DEFAULT 'present' CHECK (attendance_status IN ('present', 'absent')),
  absence_reason VARCHAR(100),
  
  -- Detailed fields
  class_participation TEXT,
  classroom_behavior TEXT,
  contact_notes TEXT,
  class_notes TEXT,
  
  -- Metadata
  last_edited_by UUID REFERENCES auth.users(id),
  last_edited_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(enrollment_id, class_occurrence_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_occurrence_reports_enrollment ON occurrence_reports(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_occurrence_reports_occurrence ON occurrence_reports(class_occurrence_id);
CREATE INDEX IF NOT EXISTS idx_occurrence_reports_version ON occurrence_reports(version);
CREATE INDEX IF NOT EXISTS idx_occurrence_reports_lesson_id ON occurrence_reports(lesson_id);
CREATE INDEX IF NOT EXISTS idx_occurrence_reports_enrollment_lesson ON occurrence_reports(enrollment_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_occurrence_reports_attendance ON occurrence_reports(attendance_status);
CREATE INDEX IF NOT EXISTS idx_occurrence_reports_progress ON occurrence_reports(progress_letter);

-- RLS (SECURITY FIX)
ALTER TABLE occurrence_reports ENABLE ROW LEVEL SECURITY;

-- Allow users to manage reports for their own enrollments
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

-- Trigger
CREATE OR REPLACE FUNCTION update_occurrence_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_occurrence_reports_updated_at
  BEFORE UPDATE ON occurrence_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_occurrence_reports_updated_at();

-- ==========================================
-- 3. Report Versions (Version History)
-- ==========================================

CREATE TABLE IF NOT EXISTS report_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  occurrence_report_id UUID NOT NULL REFERENCES occurrence_reports(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  edited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(occurrence_report_id, version)
);

-- Index
CREATE INDEX IF NOT EXISTS idx_report_versions_report ON report_versions(occurrence_report_id);

-- RLS (SECURITY FIX)
ALTER TABLE report_versions ENABLE ROW LEVEL SECURITY;

-- Allow users to view versions for their own reports
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

-- Trigger: Create version snapshot on report update
CREATE OR REPLACE FUNCTION create_report_version_snapshot()
RETURNS TRIGGER AS $$
BEGIN
    -- Save old version before update
    IF OLD.content IS DISTINCT FROM NEW.content THEN
        INSERT INTO report_versions (occurrence_report_id, version, content, edited_by)
        VALUES (OLD.id, OLD.version, OLD.content, OLD.last_edited_by);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_report_version_snapshot
  BEFORE UPDATE ON occurrence_reports
  FOR EACH ROW
  EXECUTE FUNCTION create_report_version_snapshot();

-- Comments for documentation
COMMENT ON TABLE class_occurrences IS 'Individual class sessions occurring on specific dates';
COMMENT ON TABLE occurrence_reports IS 'Student reports for each class occurrence';
COMMENT ON TABLE report_versions IS 'Version history for reports to support conflict resolution';

COMMENT ON COLUMN class_occurrences.status IS 'scheduled: not yet happened, completed: finished, cancelled: did not occur, rescheduled: moved to different date';
COMMENT ON COLUMN occurrence_reports.version IS 'Incremented on each save for optimistic locking';
COMMENT ON COLUMN occurrence_reports.progress_letter IS 'Progress indicator (A-Z single or range like A-Z) when lesson is incomplete';
COMMENT ON COLUMN occurrence_reports.is_completed IS 'Whether the lesson was completed';
COMMENT ON COLUMN occurrence_reports.attendance_status IS 'Whether student attended the class';
COMMENT ON COLUMN occurrence_reports.absence_reason IS 'Reason for absence if not attended';
COMMENT ON COLUMN occurrence_reports.class_participation IS 'Student participation level/notes';
COMMENT ON COLUMN occurrence_reports.classroom_behavior IS 'Student behavior/discipline notes';
COMMENT ON COLUMN occurrence_reports.contact_notes IS 'Notes for parent communication';
COMMENT ON COLUMN occurrence_reports.class_notes IS 'Teacher observation notes (not learning report)';
