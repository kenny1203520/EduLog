-- Read-only, permission-scoped audit history for one enrollment's single-lesson transfers.

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
DECLARE
    v_enrollment_owner uuid;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;

    SELECT user_id INTO v_enrollment_owner
    FROM public.enrollments
    WHERE id = p_enrollment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;

    IF COALESCE(auth.role(), '') <> 'service_role'
       AND v_enrollment_owner <> auth.uid()
       AND NOT EXISTS (
           SELECT 1
           FROM public.single_lesson_transfers AS transfer
           JOIN public.class_occurrences AS source_occurrence ON source_occurrence.id = transfer.source_occurrence_id
           JOIN public.class_occurrences AS target_occurrence ON target_occurrence.id = transfer.target_occurrence_id
           LEFT JOIN public.class_session_teachers AS assignment
             ON (
                 assignment.class_session_id = source_occurrence.class_session_id
                 AND assignment.effective_from <= source_occurrence.occurrence_date
                 AND (assignment.effective_to IS NULL OR assignment.effective_to >= source_occurrence.occurrence_date)
             ) OR (
                 assignment.class_session_id = target_occurrence.class_session_id
                 AND assignment.effective_from <= target_occurrence.occurrence_date
                 AND (assignment.effective_to IS NULL OR assignment.effective_to >= target_occurrence.occurrence_date)
             )
           LEFT JOIN public.teachers AS teacher ON teacher.id = assignment.teacher_id
           WHERE transfer.enrollment_id = p_enrollment_id
             AND (transfer.created_by = auth.uid() OR teacher.user_id = auth.uid())
       ) THEN
        RAISE EXCEPTION 'SINGLE_LESSON_TRANSFER_FORBIDDEN';
    END IF;

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

REVOKE ALL ON FUNCTION public.get_single_lesson_transfer_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_single_lesson_transfer_history(uuid) TO authenticated, service_role;
