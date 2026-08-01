-- Persist single-lesson transfers so report creation can distinguish a genuinely
-- missing report from a student who was intentionally moved to another occurrence.

CREATE TABLE IF NOT EXISTS public.single_lesson_transfers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
    source_occurrence_id uuid NOT NULL REFERENCES public.class_occurrences(id) ON DELETE RESTRICT,
    target_occurrence_id uuid NOT NULL REFERENCES public.class_occurrences(id) ON DELETE RESTRICT,
    created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz,
    CONSTRAINT single_lesson_transfers_distinct_occurrences_check
        CHECK (source_occurrence_id <> target_occurrence_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS single_lesson_transfers_active_source_unique
    ON public.single_lesson_transfers (enrollment_id, source_occurrence_id)
    WHERE cancelled_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS single_lesson_transfers_active_target_unique
    ON public.single_lesson_transfers (enrollment_id, target_occurrence_id)
    WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS single_lesson_transfers_source_occurrence_idx
    ON public.single_lesson_transfers (source_occurrence_id)
    WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS single_lesson_transfers_target_occurrence_idx
    ON public.single_lesson_transfers (target_occurrence_id)
    WHERE cancelled_at IS NULL;

ALTER TABLE public.single_lesson_transfers ENABLE ROW LEVEL SECURITY;

-- Direct table access is intentionally withheld. Authenticated clients use the
-- scoped functions below; service-role maintenance retains direct access.
REVOKE ALL ON public.single_lesson_transfers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.single_lesson_transfers TO service_role;

CREATE OR REPLACE FUNCTION public.get_effective_occurrence_enrollment_ids(
    p_occurrence_id uuid
) RETURNS TABLE (enrollment_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;

    RETURN QUERY
    WITH occurrence_context AS (
        SELECT occurrence.class_session_id, occurrence.occurrence_date
        FROM public.class_occurrences AS occurrence
        WHERE occurrence.id = p_occurrence_id
    ), eligible_enrollments AS (
        SELECT enrollment.id
        FROM public.enrollments AS enrollment
        JOIN occurrence_context AS occurrence
          ON occurrence.class_session_id = enrollment.class_session_id
        WHERE enrollment.status = 'regular'
          AND enrollment.start_date <= occurrence.occurrence_date
    ), transferred_out AS (
        SELECT transfer.enrollment_id
        FROM public.single_lesson_transfers AS transfer
        WHERE transfer.source_occurrence_id = p_occurrence_id
          AND transfer.cancelled_at IS NULL
    ), transferred_in AS (
        SELECT enrollment.id
        FROM public.single_lesson_transfers AS transfer
        JOIN public.enrollments AS enrollment
          ON enrollment.id = transfer.enrollment_id
        JOIN occurrence_context AS occurrence ON true
        WHERE transfer.target_occurrence_id = p_occurrence_id
          AND transfer.cancelled_at IS NULL
          AND enrollment.status = 'regular'
          AND enrollment.start_date <= occurrence.occurrence_date
    )
    SELECT eligible.id
    FROM eligible_enrollments AS eligible
    WHERE NOT EXISTS (
        SELECT 1
        FROM transferred_out AS outgoing
        WHERE outgoing.enrollment_id = eligible.id
    )
    UNION
    SELECT incoming.id
    FROM transferred_in AS incoming;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_single_lesson(
    p_enrollment_id uuid,
    p_source_occurrence_id uuid,
    p_target_occurrence_id uuid,
    p_report_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_transfer_id uuid;
    v_report public.occurrence_reports%ROWTYPE;
    v_enrollment_owner uuid;
    v_enrollment_session_id uuid;
    v_enrollment_course_id uuid;
    v_source_session_id uuid;
    v_source_date date;
    v_target_session_id uuid;
    v_target_date date;
    v_can_manage_source boolean;
    v_can_manage_target boolean;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;
    IF p_source_occurrence_id = p_target_occurrence_id THEN
        RAISE EXCEPTION 'SOURCE_AND_TARGET_OCCURRENCES_MATCH';
    END IF;

    SELECT enrollment.user_id, enrollment.class_session_id, enrollment.course_id
    INTO v_enrollment_owner, v_enrollment_session_id, v_enrollment_course_id
    FROM public.enrollments AS enrollment
    WHERE enrollment.id = p_enrollment_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND';
    END IF;

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
        SELECT 1
        FROM public.class_sessions AS session
        WHERE session.id = v_target_session_id
          AND v_enrollment_course_id = ANY(COALESCE(session.course_ids, '{}'::uuid[]))
    ) THEN
        RAISE EXCEPTION 'TARGET_SESSION_COURSE_MISMATCH';
    END IF;

    IF COALESCE(auth.role(), '') <> 'service_role' AND v_enrollment_owner <> auth.uid() THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.class_session_teachers AS assignment
            JOIN public.teachers AS teacher ON teacher.id = assignment.teacher_id
            WHERE teacher.user_id = auth.uid()
              AND assignment.class_session_id = v_source_session_id
              AND assignment.effective_from <= v_source_date
              AND (assignment.effective_to IS NULL OR assignment.effective_to >= v_source_date)
        ) INTO v_can_manage_source;
        SELECT EXISTS (
            SELECT 1
            FROM public.class_session_teachers AS assignment
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

    IF EXISTS (
        SELECT 1
        FROM public.occurrence_reports AS report
        WHERE report.enrollment_id = p_enrollment_id
          AND report.class_occurrence_id = p_target_occurrence_id
          AND (p_report_id IS NULL OR report.id <> p_report_id)
    ) THEN
        RAISE EXCEPTION 'TARGET_REPORT_ALREADY_EXISTS';
    END IF;

    IF p_report_id IS NOT NULL THEN
        SELECT report.* INTO v_report
        FROM public.occurrence_reports AS report
        WHERE report.id = p_report_id
        FOR UPDATE;
        IF NOT FOUND
           OR v_report.enrollment_id <> p_enrollment_id
           OR v_report.class_occurrence_id <> p_source_occurrence_id THEN
            RAISE EXCEPTION 'ORIGINAL_REPORT_NOT_FOUND';
        END IF;
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

    IF p_report_id IS NOT NULL THEN
        UPDATE public.occurrence_reports
        SET class_occurrence_id = p_target_occurrence_id,
            version = COALESCE(version, 1) + 1
        WHERE id = p_report_id;
    END IF;

    RETURN v_transfer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_single_lesson_transfer(
    p_transfer_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_transfer public.single_lesson_transfers%ROWTYPE;
    v_target_report public.occurrence_reports%ROWTYPE;
    v_enrollment_owner uuid;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;

    SELECT transfer.* INTO v_transfer
    FROM public.single_lesson_transfers AS transfer
    WHERE transfer.id = p_transfer_id AND transfer.cancelled_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SINGLE_LESSON_TRANSFER_NOT_FOUND';
    END IF;

    SELECT enrollment.user_id INTO v_enrollment_owner
    FROM public.enrollments AS enrollment
    WHERE enrollment.id = v_transfer.enrollment_id;
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND v_enrollment_owner <> auth.uid()
       AND v_transfer.created_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'SINGLE_LESSON_TRANSFER_FORBIDDEN';
    END IF;

    SELECT report.* INTO v_target_report
    FROM public.occurrence_reports AS report
    WHERE report.enrollment_id = v_transfer.enrollment_id
      AND report.class_occurrence_id = v_transfer.target_occurrence_id
    FOR UPDATE;

    IF EXISTS (
        SELECT 1 FROM public.occurrence_reports AS report
        WHERE report.enrollment_id = v_transfer.enrollment_id
          AND report.class_occurrence_id = v_transfer.source_occurrence_id
    ) THEN
        RAISE EXCEPTION 'SOURCE_REPORT_ALREADY_EXISTS';
    END IF;

    IF v_target_report.id IS NOT NULL THEN
        UPDATE public.occurrence_reports
        SET class_occurrence_id = v_transfer.source_occurrence_id,
            version = COALESCE(version, 1) + 1
        WHERE id = v_target_report.id;
    END IF;

    UPDATE public.single_lesson_transfers
    SET cancelled_at = now()
    WHERE id = p_transfer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_occurrence_enrollment_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_single_lesson(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_single_lesson_transfer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_occurrence_enrollment_ids(uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_single_lesson(uuid, uuid, uuid, uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_single_lesson_transfer(uuid)
    TO authenticated, service_role;
