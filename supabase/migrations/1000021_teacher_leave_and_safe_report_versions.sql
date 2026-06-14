-- ==========================================
-- Teacher Leave Holidays + Safe Report Version Snapshots
-- ==========================================

ALTER TABLE public.holidays
ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'closure';

ALTER TABLE public.holidays
ADD COLUMN IF NOT EXISTS teacher_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

ALTER TABLE public.holidays
DROP CONSTRAINT IF EXISTS holidays_kind_check;

ALTER TABLE public.holidays
ADD CONSTRAINT holidays_kind_check CHECK (kind IN ('closure', 'teacher_leave'));

CREATE OR REPLACE FUNCTION public.create_report_version_snapshot() RETURNS TRIGGER
SET search_path = public AS $$
BEGIN
    IF (
        OLD.content IS DISTINCT FROM NEW.content
    )
    OR (
        OLD.attendance_status IS DISTINCT FROM NEW.attendance_status
    )
    OR (
        OLD.absence_reason IS DISTINCT FROM NEW.absence_reason
    )
    OR (
        OLD.is_completed IS DISTINCT FROM NEW.is_completed
    )
    OR (
        OLD.progress_letter IS DISTINCT FROM NEW.progress_letter
    )
    OR (
        OLD.class_participation IS DISTINCT FROM NEW.class_participation
    )
    OR (
        OLD.classroom_behavior IS DISTINCT FROM NEW.classroom_behavior
    )
    OR (
        OLD.contact_notes IS DISTINCT FROM NEW.contact_notes
    )
    OR (
        OLD.class_notes IS DISTINCT FROM NEW.class_notes
    )
    OR (
        OLD.lesson_id IS DISTINCT FROM NEW.lesson_id
    )
    OR (
        OLD.external_link IS DISTINCT FROM NEW.external_link
    ) THEN
        BEGIN
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
                to_jsonb(OLD.*)
            );
        EXCEPTION WHEN unique_violation THEN
            NULL;
        END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_create_report_version_snapshot ON public.occurrence_reports;
CREATE TRIGGER trigger_create_report_version_snapshot BEFORE
UPDATE ON public.occurrence_reports FOR EACH ROW EXECUTE FUNCTION public.create_report_version_snapshot();
