-- Makes active single-lesson transfer targets discoverable even before a report
-- exists, and provides a guarded repair path for a missing target report.

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
DECLARE
    v_enrollment_owner uuid;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;

    SELECT enrollment.user_id INTO v_enrollment_owner
    FROM public.enrollments AS enrollment
    WHERE enrollment.id = p_enrollment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;

    IF COALESCE(auth.role(), '') <> 'service_role'
       AND v_enrollment_owner <> auth.uid()
       AND NOT EXISTS (
           SELECT 1
           FROM public.single_lesson_transfers AS transfer
           JOIN public.class_occurrences AS source_occurrence ON source_occurrence.id = transfer.source_occurrence_id
           JOIN public.class_occurrences AS target_occurrence ON target_occurrence.id = transfer.target_occurrence_id
           LEFT JOIN public.class_session_teachers AS assignment ON (
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

CREATE OR REPLACE FUNCTION public.repair_single_lesson_transfer_report(
    p_enrollment_id uuid,
    p_target_occurrence_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enrollment_owner uuid;
    v_occurrence_date date;
    v_session_id uuid;
    v_classroom_id uuid;
    v_is_suspended boolean;
    v_is_holiday boolean;
    v_report_id uuid;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;

    SELECT enrollment.user_id INTO v_enrollment_owner
    FROM public.enrollments AS enrollment
    WHERE enrollment.id = p_enrollment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;

    IF COALESCE(auth.role(), '') <> 'service_role'
       AND v_enrollment_owner <> auth.uid()
       AND NOT EXISTS (
           SELECT 1
           FROM public.single_lesson_transfers AS transfer
           JOIN public.class_occurrences AS source_occurrence ON source_occurrence.id = transfer.source_occurrence_id
           JOIN public.class_occurrences AS target_occurrence ON target_occurrence.id = transfer.target_occurrence_id
           LEFT JOIN public.class_session_teachers AS assignment ON (
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

    IF NOT EXISTS (
        SELECT 1
        FROM public.single_lesson_transfers AS transfer
        WHERE transfer.enrollment_id = p_enrollment_id
          AND transfer.target_occurrence_id = p_target_occurrence_id
          AND transfer.cancelled_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.single_lesson_transfers AS onward
              WHERE onward.enrollment_id = transfer.enrollment_id
                AND onward.source_occurrence_id = transfer.target_occurrence_id
                AND onward.cancelled_at IS NULL
          )
    ) THEN RAISE EXCEPTION 'TARGET_OCCURRENCE_NOT_EFFECTIVE'; END IF;

    IF EXISTS (
        SELECT 1 FROM public.occurrence_reports AS report
        WHERE report.enrollment_id = p_enrollment_id
          AND report.class_occurrence_id = p_target_occurrence_id
    ) THEN RAISE EXCEPTION 'REPORT_ALREADY_EXISTS'; END IF;

    SELECT occurrence.occurrence_date, occurrence.class_session_id, session.classroom_id
    INTO v_occurrence_date, v_session_id, v_classroom_id
    FROM public.class_occurrences AS occurrence
    JOIN public.class_sessions AS session ON session.id = occurrence.class_session_id
    WHERE occurrence.id = p_target_occurrence_id;
    IF v_occurrence_date IS NULL THEN RAISE EXCEPTION 'TRANSFER_OCCURRENCE_NOT_FOUND'; END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.student_suspensions AS suspension
        WHERE suspension.enrollment_id = p_enrollment_id
          AND suspension.start_date <= v_occurrence_date
          AND (suspension.end_date IS NULL OR suspension.end_date >= v_occurrence_date)
    ) INTO v_is_suspended;

    SELECT EXISTS (
        SELECT 1 FROM public.holidays AS holiday
        WHERE holiday.kind = 'closure'
          AND holiday.start_date <= v_occurrence_date
          AND holiday.end_date >= v_occurrence_date
          AND ((COALESCE(holiday.classroom_ids, '{}'::uuid[]) = '{}'::uuid[]
                AND COALESCE(holiday.class_session_ids, '{}'::uuid[]) = '{}'::uuid[])
               OR v_classroom_id = ANY(COALESCE(holiday.classroom_ids, '{}'::uuid[]))
               OR v_session_id = ANY(COALESCE(holiday.class_session_ids, '{}'::uuid[])))
    ) INTO v_is_holiday;

    INSERT INTO public.occurrence_reports (
        enrollment_id, class_occurrence_id, content, version, attendance_status, absence_reason, is_completed,
        last_edited_by, last_edited_at
    ) VALUES (
        p_enrollment_id, p_target_occurrence_id, '', 1,
        CASE WHEN v_is_suspended OR v_is_holiday THEN 'absent' ELSE 'pending' END,
        CASE WHEN v_is_suspended THEN 'suspension' WHEN v_is_holiday THEN 'holiday' ELSE NULL END,
        false, auth.uid(), now()
    ) RETURNING id INTO v_report_id;

    RETURN v_report_id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'REPORT_ALREADY_EXISTS';
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_single_lesson_transfer_targets(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_single_lesson_transfer_report(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_single_lesson_transfer_targets(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.repair_single_lesson_transfer_report(uuid, uuid) TO authenticated, service_role;
