-- Versioned TipTap JSON documents with legacy plain-text projections.
-- Existing text columns remain searchable/exportable and are updated atomically by the application.

ALTER TABLE public.occurrence_reports
    ADD COLUMN IF NOT EXISTS content_document jsonb,
    ADD COLUMN IF NOT EXISTS contact_notes_document jsonb,
    ADD COLUMN IF NOT EXISTS class_notes_document jsonb;

ALTER TABLE public.report_templates
    ADD COLUMN IF NOT EXISTS content_document jsonb,
    ADD COLUMN IF NOT EXISTS contact_notes_document jsonb,
    ADD COLUMN IF NOT EXISTS class_notes_document jsonb;

ALTER TABLE public.copy_templates
    ADD COLUMN IF NOT EXISTS template_document jsonb;

ALTER TABLE public.courses
    ADD COLUMN IF NOT EXISTS description_document jsonb;

ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS notes_document jsonb;

ALTER TABLE public.teachers
    ADD COLUMN IF NOT EXISTS bio_document jsonb;

ALTER TABLE public.user_preferences
    ADD COLUMN IF NOT EXISTS editor_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.occurrence_reports
    DROP CONSTRAINT IF EXISTS occurrence_reports_rich_text_documents_check,
    ADD CONSTRAINT occurrence_reports_rich_text_documents_check CHECK (
        (content_document IS NULL OR jsonb_typeof(content_document) = 'object') AND
        (contact_notes_document IS NULL OR jsonb_typeof(contact_notes_document) = 'object') AND
        (class_notes_document IS NULL OR jsonb_typeof(class_notes_document) = 'object')
    );

ALTER TABLE public.report_templates
    DROP CONSTRAINT IF EXISTS report_templates_rich_text_documents_check,
    ADD CONSTRAINT report_templates_rich_text_documents_check CHECK (
        (content_document IS NULL OR jsonb_typeof(content_document) = 'object') AND
        (contact_notes_document IS NULL OR jsonb_typeof(contact_notes_document) = 'object') AND
        (class_notes_document IS NULL OR jsonb_typeof(class_notes_document) = 'object')
    );

ALTER TABLE public.copy_templates
    DROP CONSTRAINT IF EXISTS copy_templates_rich_text_document_check,
    ADD CONSTRAINT copy_templates_rich_text_document_check CHECK (
        template_document IS NULL OR jsonb_typeof(template_document) = 'object'
    );

ALTER TABLE public.courses
    DROP CONSTRAINT IF EXISTS courses_description_document_check,
    ADD CONSTRAINT courses_description_document_check CHECK (
        description_document IS NULL OR jsonb_typeof(description_document) = 'object'
    );

ALTER TABLE public.students
    DROP CONSTRAINT IF EXISTS students_notes_document_check,
    ADD CONSTRAINT students_notes_document_check CHECK (
        notes_document IS NULL OR jsonb_typeof(notes_document) = 'object'
    );

ALTER TABLE public.teachers
    DROP CONSTRAINT IF EXISTS teachers_bio_document_check,
    ADD CONSTRAINT teachers_bio_document_check CHECK (
        bio_document IS NULL OR jsonb_typeof(bio_document) = 'object'
    );

ALTER TABLE public.user_preferences
    DROP CONSTRAINT IF EXISTS user_preferences_editor_settings_check,
    ADD CONSTRAINT user_preferences_editor_settings_check CHECK (
        jsonb_typeof(editor_settings) = 'object'
    );

COMMENT ON COLUMN public.occurrence_reports.content_document IS
'Versioned RichTextDocumentV1 JSON. content remains its plain-text projection.';

CREATE OR REPLACE FUNCTION public.create_report_version_snapshot() RETURNS TRIGGER
SET search_path = public AS $$
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
                OLD.id, OLD.version, OLD.content, OLD.last_edited_by, to_jsonb(OLD.*)
            );
        EXCEPTION WHEN unique_violation THEN
            NULL;
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_create_report_version_snapshot ON public.occurrence_reports;
CREATE TRIGGER trigger_create_report_version_snapshot BEFORE UPDATE ON public.occurrence_reports
FOR EACH ROW EXECUTE FUNCTION public.create_report_version_snapshot();
