-- Make single-lesson transfer cancellation usable from the UI.
--
-- * Any user who may update the enrollment in both the source and target class
--   can cancel (same rule as can_access_single_lesson_transfer), not only the
--   creator or enrollment owner.
-- * Cancelling a transfer also cancels every onward link of its chain
--   (A -> B -> C cancelled at A moves the report from C back to A).
-- * A blank placeholder report on the source occurrence no longer blocks the
--   cancel; a source report with content raises SOURCE_REPORT_HAS_CONTENT.
-- * When the transfer was completed through the conflict tool, the archived
--   source report (and its versions) is restored to the source occurrence and
--   the target report stays where it was before the transfer.
-- * get_occurrence_lesson_transfers lists the active transfers into and out of
--   one occurrence so the class page can mark transferred students.

BEGIN;

CREATE OR REPLACE FUNCTION private.is_blank_occurrence_report(
    p_report public.occurrence_reports
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT NULLIF(btrim(COALESCE(p_report.content, '')), '') IS NULL
       AND NULLIF(btrim(COALESCE(p_report.class_notes, '')), '') IS NULL
       AND NULLIF(btrim(COALESCE(p_report.contact_notes, '')), '') IS NULL
       AND NULLIF(btrim(COALESCE(p_report.progress_letter, '')), '') IS NULL
       AND p_report.lesson_id IS NULL
       AND p_report.is_completed IS NOT TRUE
       AND COALESCE(p_report.attendance_status, 'pending') = 'pending'
       AND COALESCE(p_report.version, 1) <= 1;
$$;

REVOKE ALL ON FUNCTION private.is_blank_occurrence_report(public.occurrence_reports) FROM PUBLIC;

DROP FUNCTION IF EXISTS public.cancel_single_lesson_transfer(uuid);

CREATE FUNCTION public.cancel_single_lesson_transfer(
    p_transfer_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_transfer public.single_lesson_transfers%ROWTYPE;
    v_chain_ids uuid[];
    v_final_target_id uuid;
    v_source_report public.occurrence_reports%ROWTYPE;
    v_moving_report public.occurrence_reports%ROWTYPE;
    v_archive public.single_lesson_transfer_report_archives%ROWTYPE;
    v_restored_report_id uuid;
    v_target_report_retained boolean := false;
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

    IF NOT public.can_access_single_lesson_transfer(p_transfer_id, 'teaching.enrollments.update') THEN
        RAISE EXCEPTION 'SINGLE_LESSON_TRANSFER_FORBIDDEN';
    END IF;

    -- The cancelled transfer plus every active onward link that starts where
    -- the previous link landed.
    WITH RECURSIVE chain AS (
        SELECT v_transfer.id AS id, v_transfer.target_occurrence_id AS target_occurrence_id, 1 AS depth
        UNION ALL
        SELECT onward.id, onward.target_occurrence_id, chain.depth + 1
        FROM chain
        JOIN public.single_lesson_transfers AS onward
          ON onward.enrollment_id = v_transfer.enrollment_id
         AND onward.source_occurrence_id = chain.target_occurrence_id
         AND onward.cancelled_at IS NULL
        WHERE chain.depth < 100
    )
    SELECT array_agg(chain.id ORDER BY chain.depth),
           (array_agg(chain.target_occurrence_id ORDER BY chain.depth DESC))[1]
    INTO v_chain_ids, v_final_target_id
    FROM chain;

    PERFORM 1 FROM public.single_lesson_transfers AS transfer
    WHERE transfer.id = ANY(v_chain_ids)
    FOR UPDATE;

    -- An onward link that merged reports must be cancelled on its own first;
    -- its archive belongs to an intermediate occurrence.
    IF EXISTS (
        SELECT 1 FROM public.single_lesson_transfer_report_archives AS archive
        WHERE archive.transfer_id = ANY(v_chain_ids) AND archive.transfer_id <> v_transfer.id
    ) THEN
        RAISE EXCEPTION 'TRANSFER_CHAIN_HAS_MERGED_REPORT';
    END IF;

    SELECT report.* INTO v_source_report
    FROM public.occurrence_reports AS report
    WHERE report.enrollment_id = v_transfer.enrollment_id
      AND report.class_occurrence_id = v_transfer.source_occurrence_id
    FOR UPDATE;
    IF FOUND THEN
        IF NOT private.is_blank_occurrence_report(v_source_report) THEN
            RAISE EXCEPTION 'SOURCE_REPORT_HAS_CONTENT';
        END IF;
        DELETE FROM public.report_versions WHERE occurrence_report_id = v_source_report.id;
        DELETE FROM public.occurrence_reports WHERE id = v_source_report.id;
    END IF;

    SELECT archive.* INTO v_archive
    FROM public.single_lesson_transfer_report_archives AS archive
    WHERE archive.transfer_id = v_transfer.id
    ORDER BY archive.archived_at DESC
    LIMIT 1;

    SELECT report.* INTO v_moving_report
    FROM public.occurrence_reports AS report
    WHERE report.enrollment_id = v_transfer.enrollment_id
      AND report.class_occurrence_id = v_final_target_id
    FOR UPDATE;

    IF v_archive.id IS NOT NULL THEN
        -- The conflict tool merged the source report into a report that already
        -- existed on the target. Put that report back on the head target and
        -- restore the archived source report.
        IF v_moving_report.id IS NOT NULL AND v_final_target_id <> v_transfer.target_occurrence_id THEN
            UPDATE public.occurrence_reports
            SET class_occurrence_id = v_transfer.target_occurrence_id,
                version = COALESCE(version, 1) + 1
            WHERE id = v_moving_report.id;
        END IF;
        v_target_report_retained := v_moving_report.id IS NOT NULL;

        INSERT INTO public.occurrence_reports
        SELECT (jsonb_populate_record(
            NULL::public.occurrence_reports,
            v_archive.source_report || jsonb_build_object('class_occurrence_id', v_transfer.source_occurrence_id)
        )).*
        RETURNING id INTO v_restored_report_id;

        INSERT INTO public.report_versions
        SELECT (jsonb_populate_record(NULL::public.report_versions, version_row.value)).*
        FROM jsonb_array_elements(COALESCE(v_archive.source_versions, '[]'::jsonb)) AS version_row(value)
        ON CONFLICT DO NOTHING;
    ELSIF v_moving_report.id IS NOT NULL THEN
        UPDATE public.occurrence_reports
        SET class_occurrence_id = v_transfer.source_occurrence_id,
            version = COALESCE(version, 1) + 1
        WHERE id = v_moving_report.id;
        v_restored_report_id := v_moving_report.id;
    END IF;

    UPDATE public.single_lesson_transfers
    SET cancelled_at = now()
    WHERE id = ANY(v_chain_ids);

    RETURN jsonb_build_object(
        'transfer_id', v_transfer.id,
        'cancelled_transfer_ids', to_jsonb(v_chain_ids),
        'restored_report_id', v_restored_report_id,
        'target_report_retained', v_target_report_retained
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_single_lesson_transfer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_single_lesson_transfer(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_occurrence_lesson_transfers(
    p_occurrence_id uuid
) RETURNS TABLE (
    direction text,
    transfer_id uuid,
    enrollment_id uuid,
    student_name text,
    other_occurrence_id uuid,
    other_occurrence_date date,
    other_start_time time,
    other_end_time time,
    other_session_id uuid,
    other_session_name text,
    other_classroom_name text,
    can_cancel boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_session_id uuid;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
    END IF;

    SELECT occurrence.class_session_id INTO v_session_id
    FROM public.class_occurrences AS occurrence
    WHERE occurrence.id = p_occurrence_id;

    IF v_session_id IS NULL THEN
        RETURN;
    END IF;
    IF COALESCE(auth.role(), '') <> 'service_role' AND NOT (
        public.can_access_class_session(v_session_id, 'teaching.class_sessions.read')
        OR public.can_access_class_session(v_session_id, 'teaching.class_sessions.list')
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT moves.direction,
           moves.id,
           moves.enrollment_id,
           student.name,
           other.id,
           other.occurrence_date,
           COALESCE(other.actual_start_time, other.original_start_time, other_session.start_time),
           COALESCE(other.actual_end_time, other.original_end_time, other_session.end_time),
           other_session.id,
           other_session.name,
           other_classroom.name,
           public.can_access_single_lesson_transfer(moves.id, 'teaching.enrollments.update')
    FROM (
        SELECT 'out'::text AS direction, transfer.id, transfer.enrollment_id,
               transfer.target_occurrence_id AS other_occurrence_id, transfer.created_at
        FROM public.single_lesson_transfers AS transfer
        WHERE transfer.source_occurrence_id = p_occurrence_id
          AND transfer.cancelled_at IS NULL
        UNION ALL
        SELECT 'in'::text, transfer.id, transfer.enrollment_id,
               transfer.source_occurrence_id, transfer.created_at
        FROM public.single_lesson_transfers AS transfer
        WHERE transfer.target_occurrence_id = p_occurrence_id
          AND transfer.cancelled_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.single_lesson_transfers AS onward
              WHERE onward.enrollment_id = transfer.enrollment_id
                AND onward.source_occurrence_id = p_occurrence_id
                AND onward.cancelled_at IS NULL
          )
    ) AS moves
    JOIN public.enrollments AS enrollment ON enrollment.id = moves.enrollment_id
    JOIN public.students AS student ON student.id = enrollment.student_id
    JOIN public.class_occurrences AS other ON other.id = moves.other_occurrence_id
    JOIN public.class_sessions AS other_session ON other_session.id = other.class_session_id
    LEFT JOIN public.classrooms AS other_classroom ON other_classroom.id = other_session.classroom_id
    ORDER BY moves.direction DESC, student.name, moves.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_occurrence_lesson_transfers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_occurrence_lesson_transfers(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
