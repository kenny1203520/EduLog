-- Single-lesson transfers: authorize by RBAC as well as teacher assignment.
--
-- prepare_repeatable_single_lesson_transfer (used by transfer_single_lesson
-- and resolve_single_lesson_transfer_conflict) only allowed the enrollment
-- owner or a user assigned as teacher of both the source and target lesson on
-- their dates, so administrators passed the API's permission check and were
-- then refused with SINGLE_LESSON_TRANSFER_FORBIDDEN. A user who holds
-- teaching.enrollments.update in both class sessions is now allowed too; the
-- owner and assigned-teacher paths are unchanged.
--
-- It also closes a gap: the check was guarded by `owner <> auth.uid()`, which
-- is NULL for enrollments without an owner (user_id NULL, as the global-data
-- migration leaves them), so the whole check was skipped and any signed-in
-- user calling the RPC directly could transfer. The rest of the function is
-- identical to its 1000143 version.
--
-- repair_single_lesson_transfer_report had the same NULL-owner gap; it is
-- recreated from its 1000034 version with IS DISTINCT FROM, and also allows a
-- user with teaching.enrollments.update in the target lesson's class.

BEGIN;

CREATE OR REPLACE FUNCTION public.prepare_repeatable_single_lesson_transfer(
    p_enrollment_id uuid,
    p_source_occurrence_id uuid,
    p_target_occurrence_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enrollment_owner uuid;
    v_enrollment_session_id uuid;
    v_enrollment_course_id uuid;
    v_source_session_id uuid;
    v_source_date date;
    v_target_session_id uuid;
    v_target_date date;
    v_can_manage_source boolean;
    v_can_manage_target boolean;
    v_target_is_ancestor boolean;
    v_transfer_id uuid;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;
    IF p_source_occurrence_id = p_target_occurrence_id THEN
        RAISE EXCEPTION 'SOURCE_AND_TARGET_OCCURRENCES_MATCH';
    END IF;

    SELECT user_id, class_session_id, course_id
    INTO v_enrollment_owner, v_enrollment_session_id, v_enrollment_course_id
    FROM public.enrollments WHERE id = p_enrollment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;

    SELECT class_session_id, occurrence_date INTO v_source_session_id, v_source_date
    FROM public.class_occurrences WHERE id = p_source_occurrence_id;
    SELECT class_session_id, occurrence_date INTO v_target_session_id, v_target_date
    FROM public.class_occurrences WHERE id = p_target_occurrence_id;
    IF v_source_session_id IS NULL OR v_target_session_id IS NULL THEN
        RAISE EXCEPTION 'TRANSFER_OCCURRENCE_NOT_FOUND';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.class_sessions AS session
        WHERE session.id = v_target_session_id
          AND v_enrollment_course_id = ANY(COALESCE(session.course_ids, '{}'::uuid[]))
    ) THEN RAISE EXCEPTION 'TARGET_SESSION_COURSE_MISMATCH'; END IF;

    -- A manually recreated source report is authoritative.  It means an older
    -- active transfer chain no longer reflects where the report is actually
    -- held, so close that stale suffix before evaluating the new transfer.
    IF EXISTS (
        SELECT 1 FROM public.occurrence_reports AS report
        WHERE report.enrollment_id = p_enrollment_id
          AND report.class_occurrence_id = p_source_occurrence_id
    ) THEN
        WITH RECURSIVE stale_path AS (
            SELECT id, source_occurrence_id, target_occurrence_id
            FROM public.single_lesson_transfers
            WHERE enrollment_id = p_enrollment_id AND source_occurrence_id = p_source_occurrence_id
              AND cancelled_at IS NULL
            UNION ALL
            SELECT transfer.id, transfer.source_occurrence_id, transfer.target_occurrence_id
            FROM public.single_lesson_transfers AS transfer
            JOIN stale_path ON transfer.source_occurrence_id = stale_path.target_occurrence_id
            WHERE transfer.enrollment_id = p_enrollment_id AND transfer.cancelled_at IS NULL
        )
        UPDATE public.single_lesson_transfers
        SET cancelled_at = now()
        WHERE id IN (SELECT id FROM stale_path);
    END IF;

    -- The source must be the leaf of the student's effective transfer path, an
    -- occurrence of the class the student belonged to on that date, or an
    -- occurrence that holds the student's report.
    IF EXISTS (
        SELECT 1 FROM public.single_lesson_transfers
        WHERE enrollment_id = p_enrollment_id AND source_occurrence_id = p_source_occurrence_id
          AND cancelled_at IS NULL
    ) OR NOT (
        EXISTS (
            SELECT 1 FROM public.single_lesson_transfers
            WHERE enrollment_id = p_enrollment_id AND target_occurrence_id = p_source_occurrence_id
              AND cancelled_at IS NULL
        ) OR EXISTS (
            -- The class the student belonged to on that date (class history),
            -- not only their current class.
            SELECT 1 FROM public.enrollment_class_history AS history
            WHERE history.enrollment_id = p_enrollment_id
              AND history.class_session_id = v_source_session_id
              AND history.effective_from <= v_source_date
              AND (history.effective_to IS NULL OR history.effective_to >= v_source_date)
        ) OR EXISTS (
            -- A report held on the occurrence puts the student on its roster.
            SELECT 1 FROM public.occurrence_reports AS report
            WHERE report.enrollment_id = p_enrollment_id
              AND report.class_occurrence_id = p_source_occurrence_id
        )
    ) THEN
        RAISE EXCEPTION 'SOURCE_OCCURRENCE_NOT_EFFECTIVE';
    END IF;

    -- IS DISTINCT FROM: enrollments without an owner (user_id NULL, the norm
    -- after the global-data migration) must still be checked.
    IF COALESCE(auth.role(), '') <> 'service_role' AND v_enrollment_owner IS DISTINCT FROM auth.uid() THEN
        SELECT EXISTS (
            SELECT 1 FROM public.class_session_teachers AS assignment
            JOIN public.teachers AS teacher ON teacher.id = assignment.teacher_id
            WHERE teacher.user_id = auth.uid() AND assignment.class_session_id = v_source_session_id
              AND assignment.effective_from <= v_source_date
              AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_source_date)
        ) INTO v_can_manage_source;
        SELECT EXISTS (
            SELECT 1 FROM public.class_session_teachers AS assignment
            JOIN public.teachers AS teacher ON teacher.id = assignment.teacher_id
            WHERE teacher.user_id = auth.uid() AND assignment.class_session_id = v_target_session_id
              AND assignment.effective_from <= v_target_date
              AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_target_date)
        ) INTO v_can_manage_target;
        -- Assigned teachers of both lessons keep their access; anyone allowed to
        -- update enrollments in both classes (the API's own RBAC check) may
        -- also transfer, so administrators who are not teaching are not blocked.
        IF NOT (v_can_manage_source AND v_can_manage_target)
           AND NOT (
               public.has_api_permission(auth.uid(), 'teaching.enrollments.update', NULL, v_source_session_id)
               AND public.has_api_permission(auth.uid(), 'teaching.enrollments.update', NULL, v_target_session_id)
           ) THEN
            RAISE EXCEPTION 'SINGLE_LESSON_TRANSFER_FORBIDDEN';
        END IF;
    END IF;

    WITH RECURSIVE path AS (
        SELECT id, source_occurrence_id, target_occurrence_id
        FROM public.single_lesson_transfers
        WHERE enrollment_id = p_enrollment_id AND source_occurrence_id = p_target_occurrence_id
          AND cancelled_at IS NULL
        UNION ALL
        SELECT transfer.id, transfer.source_occurrence_id, transfer.target_occurrence_id
        FROM public.single_lesson_transfers AS transfer
        JOIN path ON transfer.source_occurrence_id = path.target_occurrence_id
        WHERE transfer.enrollment_id = p_enrollment_id AND transfer.cancelled_at IS NULL
    )
    SELECT EXISTS (SELECT 1 FROM path WHERE target_occurrence_id = p_source_occurrence_id)
    INTO v_target_is_ancestor;

    IF EXISTS (
        SELECT 1 FROM public.single_lesson_transfers
        WHERE enrollment_id = p_enrollment_id AND target_occurrence_id = p_target_occurrence_id
          AND cancelled_at IS NULL
    ) AND NOT v_target_is_ancestor THEN
        RAISE EXCEPTION 'TARGET_OCCURRENCE_ALREADY_EFFECTIVE';
    END IF;

    IF v_target_is_ancestor THEN
        WITH RECURSIVE path AS (
            SELECT id, source_occurrence_id, target_occurrence_id
            FROM public.single_lesson_transfers
            WHERE enrollment_id = p_enrollment_id AND source_occurrence_id = p_target_occurrence_id
              AND cancelled_at IS NULL
            UNION ALL
            SELECT transfer.id, transfer.source_occurrence_id, transfer.target_occurrence_id
            FROM public.single_lesson_transfers AS transfer
            JOIN path ON transfer.source_occurrence_id = path.target_occurrence_id
            WHERE transfer.enrollment_id = p_enrollment_id AND transfer.cancelled_at IS NULL
        )
        UPDATE public.single_lesson_transfers
        SET cancelled_at = now()
        WHERE id IN (SELECT id FROM path);
        -- Keep the return itself auditable without making the original-class
        -- occurrence an active transfer target.
        INSERT INTO public.single_lesson_transfers (
            enrollment_id, source_occurrence_id, target_occurrence_id, created_by, cancelled_at
        ) VALUES (
            p_enrollment_id, p_source_occurrence_id, p_target_occurrence_id, auth.uid(), now()
        ) RETURNING id INTO v_transfer_id;
        RETURN v_transfer_id;
    END IF;

    INSERT INTO public.single_lesson_transfers (
        enrollment_id, source_occurrence_id, target_occurrence_id, created_by
    ) VALUES (p_enrollment_id, p_source_occurrence_id, p_target_occurrence_id, auth.uid())
    RETURNING id INTO v_transfer_id;
    RETURN v_transfer_id;
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
       AND v_enrollment_owner IS DISTINCT FROM auth.uid()
       AND NOT COALESCE(public.has_api_permission(
           auth.uid(), 'teaching.enrollments.update', NULL,
           (SELECT occurrence.class_session_id FROM public.class_occurrences AS occurrence WHERE occurrence.id = p_target_occurrence_id)
       ), false)
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

NOTIFY pgrst, 'reload schema';
COMMIT;
