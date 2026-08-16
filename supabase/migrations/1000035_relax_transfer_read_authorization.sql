-- Repairs read authorization for single-lesson transfer lookups.
--
-- 1000033 and 1000034 gated their read-only functions behind a check whose
-- teacher-assignment test lived *inside* an EXISTS rooted at
-- single_lesson_transfers. An enrollment with no transfer rows therefore made
-- the EXISTS empty, NOT EXISTS true, and every caller who did not personally
-- create the enrollment hit SINGLE_LESSON_TRANSFER_FORBIDDEN -- including the
-- assigned teacher. In StudentReportsView that exception aborts the whole
-- occurrence load, so the report list renders empty while the incomplete-report
-- banner (which reads reports directly) still shows entries.
--
-- These two functions expose nothing beyond what the occurrence_reports,
-- enrollments and class_occurrences RLS policies already grant to every
-- authenticated user ("Enable all access for authenticated users", 1000003),
-- so the gate is dropped rather than rewritten. Authentication is still
-- required, and the mutating transfer RPCs (1000030/1000032) keep their
-- class_session_teachers assignment checks unchanged.

CREATE OR REPLACE FUNCTION public.get_effective_single_lesson_transfer_targets(
    p_enrollment_id uuid
) RETURNS TABLE (
    transfer_id uuid,
    source_occurrence_id uuid,
    target_occurrence_id uuid,
    is_effective_target boolean,
    target_report_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.enrollments AS enrollment
        WHERE enrollment.id = p_enrollment_id
    ) THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;

    RETURN QUERY
    WITH active_transfers AS (
        SELECT transfer.id, transfer.source_occurrence_id, transfer.target_occurrence_id
        FROM public.single_lesson_transfers AS transfer
        WHERE transfer.enrollment_id = p_enrollment_id
          AND transfer.cancelled_at IS NULL
    )
    SELECT
        transfer.id,
        transfer.source_occurrence_id,
        transfer.target_occurrence_id,
        onward.source_occurrence_id IS NULL,
        report.id
    FROM active_transfers AS transfer
    LEFT JOIN active_transfers AS onward
      ON onward.source_occurrence_id = transfer.target_occurrence_id
    LEFT JOIN public.occurrence_reports AS report
      ON report.enrollment_id = p_enrollment_id
     AND report.class_occurrence_id = transfer.target_occurrence_id
    ;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_single_lesson_transfer_history(
    p_enrollment_id uuid
) RETURNS TABLE (
    id uuid,
    created_at timestamptz,
    cancelled_at timestamptz,
    course_display_name text,
    source_occurrence_date date,
    source_start_time time,
    source_end_time time,
    source_session_name text,
    source_classroom_name text,
    target_occurrence_date date,
    target_start_time time,
    target_end_time time,
    target_session_name text,
    target_classroom_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.enrollments AS enrollment
        WHERE enrollment.id = p_enrollment_id
    ) THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;

    RETURN QUERY
    SELECT
        transfer.id,
        transfer.created_at,
        transfer.cancelled_at,
        COALESCE(course.display_name, course.subject),
        source_occurrence.occurrence_date,
        COALESCE(source_occurrence.actual_start_time, source_occurrence.original_start_time, source_session.start_time),
        COALESCE(source_occurrence.actual_end_time, source_occurrence.original_end_time, source_session.end_time),
        source_session.name,
        source_classroom.name,
        target_occurrence.occurrence_date,
        COALESCE(target_occurrence.actual_start_time, target_occurrence.original_start_time, target_session.start_time),
        COALESCE(target_occurrence.actual_end_time, target_occurrence.original_end_time, target_session.end_time),
        target_session.name,
        target_classroom.name
    FROM public.single_lesson_transfers AS transfer
    JOIN public.enrollments AS enrollment ON enrollment.id = transfer.enrollment_id
    JOIN public.courses AS course ON course.id = enrollment.course_id
    JOIN public.class_occurrences AS source_occurrence ON source_occurrence.id = transfer.source_occurrence_id
    JOIN public.class_sessions AS source_session ON source_session.id = source_occurrence.class_session_id
    LEFT JOIN public.classrooms AS source_classroom ON source_classroom.id = source_session.classroom_id
    JOIN public.class_occurrences AS target_occurrence ON target_occurrence.id = transfer.target_occurrence_id
    JOIN public.class_sessions AS target_session ON target_session.id = target_occurrence.class_session_id
    LEFT JOIN public.classrooms AS target_classroom ON target_classroom.id = target_session.classroom_id
    WHERE transfer.enrollment_id = p_enrollment_id
    ORDER BY transfer.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_single_lesson_transfer_targets(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_single_lesson_transfer_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_single_lesson_transfer_targets(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_single_lesson_transfer_history(uuid) TO authenticated, service_role;
