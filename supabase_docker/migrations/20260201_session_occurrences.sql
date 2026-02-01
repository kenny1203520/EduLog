-- Migration: Session-Based Reporting System
-- Creates tables for class occurrences and occurrence-based reports

-- Table: class_occurrences
-- Represents individual class sessions that occur on specific dates
CREATE TABLE IF NOT EXISTS class_occurrences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    occurrence_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    
    -- Times from class_session, can be overridden for this specific occurrence
    original_start_time TIME,
    original_end_time TIME,
    
    -- Actual times if different (makeup classes, delays, etc.)
    actual_start_time TIME,
    actual_end_time TIME,
    
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One occurrence per session per date
    UNIQUE(class_session_id, occurrence_date)
);

-- Indexes for performance
CREATE INDEX idx_class_occurrences_session ON class_occurrences(class_session_id);
CREATE INDEX idx_class_occurrences_date ON class_occurrences(occurrence_date);
CREATE INDEX idx_class_occurrences_status ON class_occurrences(status);

-- Table: occurrence_reports
-- Reports for each student per class occurrence
CREATE TABLE IF NOT EXISTS occurrence_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    class_occurrence_id UUID NOT NULL REFERENCES class_occurrences(id) ON DELETE CASCADE,
    
    content TEXT DEFAULT '',
    version INTEGER DEFAULT 1,
    
    -- Track who last edited
    last_edited_by UUID REFERENCES auth.users(id),
    last_edited_at TIMESTAMPTZ DEFAULT NOW(),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One report per enrollment per occurrence
    UNIQUE(enrollment_id, class_occurrence_id)
);

CREATE INDEX idx_occurrence_reports_enrollment ON occurrence_reports(enrollment_id);
CREATE INDEX idx_occurrence_reports_occurrence ON occurrence_reports(class_occurrence_id);
CREATE INDEX idx_occurrence_reports_version ON occurrence_reports(version);

-- Table: report_versions
-- Version history for conflict resolution
CREATE TABLE IF NOT EXISTS report_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    occurrence_report_id UUID NOT NULL REFERENCES occurrence_reports(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    edited_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(occurrence_report_id, version)
);

CREATE INDEX idx_report_versions_report ON report_versions(occurrence_report_id);

-- Trigger: Auto-update updated_at for class_occurrences
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

-- Trigger: Auto-update updated_at for occurrence_reports
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

-- Comment documentation
COMMENT ON TABLE class_occurrences IS 'Individual class sessions occurring on specific dates';
COMMENT ON TABLE occurrence_reports IS 'Student reports for each class occurrence';
COMMENT ON TABLE report_versions IS 'Version history for reports to support conflict resolution';

COMMENT ON COLUMN class_occurrences.status IS 'scheduled: not yet happened, completed: finished, cancelled: did not occur, rescheduled: moved to different date';
COMMENT ON COLUMN occurrence_reports.version IS 'Incremented on each save for optimistic locking';
