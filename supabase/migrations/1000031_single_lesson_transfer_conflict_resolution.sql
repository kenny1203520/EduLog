-- Resolve a single-lesson transfer when both occurrences already contain a report.
-- The target report remains canonical; the source state is archived before removal.

CREATE TABLE IF NOT EXISTS public.single_lesson_transfer_report_archives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id uuid NOT NULL REFERENCES public.single_lesson_transfers(id) ON DELETE CASCADE,
    source_report_id uuid NOT NULL,
    source_report jsonb NOT NULL,
    source_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
    archived_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.single_lesson_transfer_report_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.single_lesson_transfer_report_archives FROM anon, authenticated;
GRANT SELECT, INSERT ON public.single_lesson_transfer_report_archives TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_single_lesson_transfer_conflict(
    p_enrollment_id uuid,
    p_source_occurrence_id uuid,
    p_target_occurrence_id uuid,
    p_source_report_id uuid,
    p_source_version integer,
    p_target_report_id uuid,
    p_target_version integer,
    p_field_sources jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_transfer_id uuid;
    v_source_report public.occurrence_reports%ROWTYPE;
    v_target_report public.occurrence_reports%ROWTYPE;
    v_enrollment_owner uuid;
    v_enrollment_session_id uuid;
    v_enrollment_course_id uuid;
    v_source_session_id uuid;
    v_source_date date;
    v_target_session_id uuid;
    v_target_date date;
    v_can_manage_source boolean;
    v_can_manage_target boolean;
    v_source_versions jsonb := '[]'::jsonb;
    v_allowed_fields constant text[] := ARRAY[
        'lesson_id', 'is_completed', 'progress_letter', 'attendance',
        'class_participation', 'classroom_behavior', 'contact_notes',
        'class_notes', 'content', 'external_link'
    ];
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;
    IF p_source_occurrence_id = p_target_occurrence_id THEN
        RAISE EXCEPTION 'SOURCE_AND_TARGET_OCCURRENCES_MATCH';
    END IF;
    IF p_target_report_id IS NULL OR p_target_version IS NULL THEN
        RAISE EXCEPTION 'TRANSFER_CONFLICT_STALE';
    END IF;
    IF p_field_sources IS NULL
       OR jsonb_typeof(p_field_sources) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_field_sources)) <> cardinality(v_allowed_fields)
       OR EXISTS (
            SELECT 1
            FROM jsonb_each_text(p_field_sources) AS choice(field_name, source_name)
            WHERE NOT (choice.field_name = ANY(v_allowed_fields))
               OR choice.source_name NOT IN ('source', 'target')
       )
       OR EXISTS (
            SELECT 1 FROM unnest(v_allowed_fields) AS allowed(field_name)
            WHERE NOT p_field_sources ? allowed.field_name
       ) THEN
        RAISE EXCEPTION 'INVALID_TRANSFER_FIELD_SELECTIONS';
    END IF;
    IF p_source_report_id IS NULL AND EXISTS (
        SELECT 1 FROM jsonb_each_text(p_field_sources) AS choice(field_name, source_name)
        WHERE choice.source_name = 'source'
    ) THEN
        RAISE EXCEPTION 'INVALID_TRANSFER_FIELD_SELECTIONS';
    END IF;

    SELECT enrollment.user_id, enrollment.class_session_id, enrollment.course_id
    INTO v_enrollment_owner, v_enrollment_session_id, v_enrollment_course_id
    FROM public.enrollments AS enrollment
    WHERE enrollment.id = p_enrollment_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;

    SELECT occurrence.class_session_id, occurrence.occurrence_date
    INTO v_source_session_id, v_source_date
    FROM public.class_occurrences AS occurrence
    WHERE occurrence.id = p_source_occurrence_id;
    SELECT occurrence.class_session_id, occurrence.occurrence_date
    INTO v_target_session_id, v_target_date
    FROM public.class_occurrences AS occurrence
    WHERE occurrence.id = p_target_occurrence_id;
    IF v_source_session_id IS NULL OR v_target_session_id IS NULL THEN
        RAISE EXCEPTION 'TRANSFER_OCCURRENCE_NOT_FOUND';
    END IF;
    IF v_source_session_id <> v_enrollment_session_id THEN
        RAISE EXCEPTION 'ORIGINAL_OCCURRENCE_NOT_IN_ENROLLMENT_SESSION';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.class_sessions AS session
        WHERE session.id = v_target_session_id
          AND v_enrollment_course_id = ANY(COALESCE(session.course_ids, '{}'::uuid[]))
    ) THEN
        RAISE EXCEPTION 'TARGET_SESSION_COURSE_MISMATCH';
    END IF;

    IF COALESCE(auth.role(), '') <> 'service_role' AND v_enrollment_owner <> auth.uid() THEN
        SELECT EXISTS (
            SELECT 1 FROM public.class_session_teachers AS assignment
            JOIN public.teachers AS teacher ON teacher.id = assignment.teacher_id
            WHERE teacher.user_id = auth.uid()
              AND assignment.class_session_id = v_source_session_id
              AND assignment.effective_from <= v_source_date
              AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_source_date)
        ) INTO v_can_manage_source;
        SELECT EXISTS (
            SELECT 1 FROM public.class_session_teachers AS assignment
            JOIN public.teachers AS teacher ON teacher.id = assignment.teacher_id
            WHERE teacher.user_id = auth.uid()
              AND assignment.class_session_id = v_target_session_id
              AND assignment.effective_from <= v_target_date
              AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_target_date)
        ) INTO v_can_manage_target;
        IF NOT v_can_manage_source OR NOT v_can_manage_target THEN
            RAISE EXCEPTION 'SINGLE_LESSON_TRANSFER_FORBIDDEN';
        END IF;
    END IF;

    SELECT report.* INTO v_target_report
    FROM public.occurrence_reports AS report
    WHERE report.id = p_target_report_id
    FOR UPDATE;
    IF NOT FOUND
       OR v_target_report.enrollment_id <> p_enrollment_id
       OR v_target_report.class_occurrence_id <> p_target_occurrence_id
       OR COALESCE(v_target_report.version, 1) <> p_target_version THEN
        RAISE EXCEPTION 'TRANSFER_CONFLICT_STALE';
    END IF;

    IF p_source_report_id IS NOT NULL THEN
        SELECT report.* INTO v_source_report
        FROM public.occurrence_reports AS report
        WHERE report.id = p_source_report_id
        FOR UPDATE;
        IF NOT FOUND
           OR p_source_version IS NULL
           OR v_source_report.enrollment_id <> p_enrollment_id
           OR v_source_report.class_occurrence_id <> p_source_occurrence_id
           OR COALESCE(v_source_report.version, 1) <> p_source_version THEN
            RAISE EXCEPTION 'TRANSFER_CONFLICT_STALE';
        END IF;
    ELSIF EXISTS (
        SELECT 1 FROM public.occurrence_reports AS report
        WHERE report.enrollment_id = p_enrollment_id
          AND report.class_occurrence_id = p_source_occurrence_id
    ) THEN
        RAISE EXCEPTION 'TRANSFER_CONFLICT_STALE';
    END IF;

    BEGIN
        INSERT INTO public.single_lesson_transfers (
            enrollment_id, source_occurrence_id, target_occurrence_id, created_by
        ) VALUES (
            p_enrollment_id, p_source_occurrence_id, p_target_occurrence_id, auth.uid()
        ) RETURNING id INTO v_transfer_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'SINGLE_LESSON_TRANSFER_ALREADY_EXISTS';
    END;

    IF p_source_report_id IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(version_row.*) ORDER BY version_row.version), '[]'::jsonb)
        INTO v_source_versions
        FROM public.report_versions AS version_row
        WHERE version_row.occurrence_report_id = p_source_report_id;

        INSERT INTO public.single_lesson_transfer_report_archives (
            transfer_id, source_report_id, source_report, source_versions
        ) VALUES (
            v_transfer_id, p_source_report_id, to_jsonb(v_source_report.*), v_source_versions
        );

        UPDATE public.occurrence_reports AS target
        SET lesson_id = CASE WHEN p_field_sources->>'lesson_id' = 'source' THEN v_source_report.lesson_id ELSE target.lesson_id END,
            is_completed = CASE WHEN p_field_sources->>'is_completed' = 'source' THEN v_source_report.is_completed ELSE target.is_completed END,
            progress_letter = CASE WHEN p_field_sources->>'progress_letter' = 'source' THEN v_source_report.progress_letter ELSE target.progress_letter END,
            attendance_status = CASE WHEN p_field_sources->>'attendance' = 'source' THEN v_source_report.attendance_status ELSE target.attendance_status END,
            absence_reason = CASE WHEN p_field_sources->>'attendance' = 'source' THEN v_source_report.absence_reason ELSE target.absence_reason END,
            class_participation = CASE WHEN p_field_sources->>'class_participation' = 'source' THEN v_source_report.class_participation ELSE target.class_participation END,
            classroom_behavior = CASE WHEN p_field_sources->>'classroom_behavior' = 'source' THEN v_source_report.classroom_behavior ELSE target.classroom_behavior END,
            contact_notes = CASE WHEN p_field_sources->>'contact_notes' = 'source' THEN v_source_report.contact_notes ELSE target.contact_notes END,
            contact_notes_document = CASE WHEN p_field_sources->>'contact_notes' = 'source' THEN v_source_report.contact_notes_document ELSE target.contact_notes_document END,
            class_notes = CASE WHEN p_field_sources->>'class_notes' = 'source' THEN v_source_report.class_notes ELSE target.class_notes END,
            class_notes_document = CASE WHEN p_field_sources->>'class_notes' = 'source' THEN v_source_report.class_notes_document ELSE target.class_notes_document END,
            content = CASE WHEN p_field_sources->>'content' = 'source' THEN v_source_report.content ELSE target.content END,
            content_document = CASE WHEN p_field_sources->>'content' = 'source' THEN v_source_report.content_document ELSE target.content_document END,
            external_link = CASE WHEN p_field_sources->>'external_link' = 'source' THEN v_source_report.external_link ELSE target.external_link END,
            last_edited_by = auth.uid(),
            last_edited_at = now(),
            version = COALESCE(target.version, 1) + 1
        WHERE target.id = p_target_report_id;

        DELETE FROM public.report_versions WHERE occurrence_report_id = p_source_report_id;
        DELETE FROM public.occurrence_reports WHERE id = p_source_report_id;
    END IF;

    RETURN jsonb_build_object(
        'transfer_id', v_transfer_id,
        'report_id', p_target_report_id,
        'version', CASE WHEN p_source_report_id IS NULL
            THEN v_target_report.version
            ELSE COALESCE(v_target_report.version, 1) + 1 END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_single_lesson_transfer_conflict(
    uuid, uuid, uuid, uuid, integer, uuid, integer, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_single_lesson_transfer_conflict(
    uuid, uuid, uuid, uuid, integer, uuid, integer, jsonb
) TO authenticated, service_role;
