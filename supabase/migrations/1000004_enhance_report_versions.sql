-- ==========================================
-- Enhance Report Versions with Full Snapshots
-- ==========================================
-- 1. Add snapshot column to report_versions
ALTER TABLE public.report_versions
ADD COLUMN IF NOT EXISTS snapshot JSONB;
-- 2. Update the snapshot trigger function to capture full record
-- This will trigger whenever content OR other relevant fields change
CREATE OR REPLACE FUNCTION public.create_report_version_snapshot() RETURNS TRIGGER
SET search_path = public AS $$ BEGIN -- Save old version if content OR any other relevant tracking field changed
    IF (
        OLD.content IS DISTINCT
        FROM NEW.content
    )
    OR (
        OLD.attendance_status IS DISTINCT
        FROM NEW.attendance_status
    )
    OR (
        OLD.is_completed IS DISTINCT
        FROM NEW.is_completed
    )
    OR (
        OLD.progress_letter IS DISTINCT
        FROM NEW.progress_letter
    )
    OR (
        OLD.class_participation IS DISTINCT
        FROM NEW.class_participation
    )
    OR (
        OLD.classroom_behavior IS DISTINCT
        FROM NEW.classroom_behavior
    )
    OR (
        OLD.contact_notes IS DISTINCT
        FROM NEW.contact_notes
    )
    OR (
        OLD.class_notes IS DISTINCT
        FROM NEW.class_notes
    )
    OR (
        OLD.lesson_id IS DISTINCT
        FROM NEW.lesson_id
    )
    OR (
        OLD.external_link IS DISTINCT
        FROM NEW.external_link
    ) THEN
INSERT INTO public.report_versions (
        occurrence_report_id,
        version,
        content,
        edited_by,
        snapshot
    )
VALUES (
        OLD.id,
        OLD.version,
        OLD.content,
        OLD.last_edited_by,
        to_jsonb(OLD.*) -- Capture everything!
    );
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- 3. Ensure the trigger is properly set (re-create for safety)
DROP TRIGGER IF EXISTS trigger_create_report_version_snapshot ON public.occurrence_reports;
CREATE TRIGGER trigger_create_report_version_snapshot BEFORE
UPDATE ON public.occurrence_reports FOR EACH ROW EXECUTE FUNCTION public.create_report_version_snapshot();