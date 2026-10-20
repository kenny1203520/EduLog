-- Version snapshots of reports whose learning report was cleared.
--
-- apply_occurrence_report_lifecycle stores an emptied report body as NULL
-- (NULLIF(content, '')), but report_versions.content is NOT NULL. The next
-- save that changed the report then failed inside
-- create_report_version_snapshot, so a teacher who cleared the field could
-- never save that report again. The snapshot now records NULL as ''; the full
-- row is still kept in `snapshot`.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_report_version_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
    IF (
        OLD.content IS DISTINCT FROM NEW.content OR
        OLD.content_document IS DISTINCT FROM NEW.content_document OR
        OLD.contact_notes IS DISTINCT FROM NEW.contact_notes OR
        OLD.contact_notes_document IS DISTINCT FROM NEW.contact_notes_document OR
        OLD.class_notes IS DISTINCT FROM NEW.class_notes OR
        OLD.class_notes_document IS DISTINCT FROM NEW.class_notes_document OR
        OLD.attendance_status IS DISTINCT FROM NEW.attendance_status OR
        OLD.absence_reason IS DISTINCT FROM NEW.absence_reason OR
        OLD.is_completed IS DISTINCT FROM NEW.is_completed OR
        OLD.progress_letter IS DISTINCT FROM NEW.progress_letter OR
        OLD.class_participation IS DISTINCT FROM NEW.class_participation OR
        OLD.classroom_behavior IS DISTINCT FROM NEW.classroom_behavior OR
        OLD.lesson_id IS DISTINCT FROM NEW.lesson_id OR
        OLD.external_link IS DISTINCT FROM NEW.external_link
    ) THEN
        BEGIN
            INSERT INTO public.report_versions (
                occurrence_report_id, version, content, edited_by, snapshot
            ) VALUES (
                OLD.id, OLD.version, COALESCE(OLD.content, ''), OLD.last_edited_by, to_jsonb(OLD.*)
            );
        EXCEPTION WHEN unique_violation THEN
            NULL;
        END;
    END IF;
    RETURN NEW;
END;
$function$;

COMMIT;
