-- Keep an enrollment's report placeholders on the right lessons.
--
-- sync_enrollment_reports(enrollment, target_count, start_date, dry_run)
-- places the enrollment's blank placeholder reports on the first eligible
-- lessons from its start date, so the enrollment holds target_count reports:
--
-- * Fixed reports are never moved or deleted and count toward the target:
--   reports with content, reports on an active single-lesson transfer target,
--   and reports on lessons outside the enrollment's class history.
-- * Eligible lessons belong to the enrollment's class on that date (class
--   history), are on/after the start date, are not cancelled/rescheduled, are
--   not the source of an active transfer, and hold no fixed report.
-- * Blank placeholders outside the chosen lessons are deleted; chosen lessons
--   without a report get one. target_count defaults to the current number of
--   reports, so editing the start date shifts the same number of reports.
-- * Only this enrollment's reports are touched (provision_occurrence_reports
--   creates them for the whole roster), and trial enrollments are included.
-- * dry_run returns the plan without writing; the client shows it before a
--   start-date edit is saved. A start_date argument previews that date before
--   the enrollment itself is updated.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_enrollment_reports(
    p_enrollment_id uuid,
    p_target_count integer DEFAULT NULL,
    p_start_date date DEFAULT NULL,
    p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enrollment public.enrollments%ROWTYPE;
    v_start date;
    v_first_segment uuid;
    v_target integer;
    v_fixed_count integer;
    v_blank_count integer;
    v_slots integer;
    v_created jsonb := '[]'::jsonb;
    v_removed jsonb := '[]'::jsonb;
    v_fixed_before_start jsonb := '[]'::jsonb;
    v_chosen_count integer;
    v_row record;
    v_attendance record;
BEGIN
    IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
    END IF;

    SELECT enrollment.* INTO v_enrollment
    FROM public.enrollments AS enrollment
    WHERE enrollment.id = p_enrollment_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'; END IF;

    IF COALESCE(auth.role(), '') <> 'service_role'
       AND NOT public.can_access_enrollment(p_enrollment_id, 'teaching.enrollments.update')
       AND NOT public.can_access_enrollment(p_enrollment_id, 'teaching.enrollments.create') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    v_start := COALESCE(p_start_date, v_enrollment.start_date, CURRENT_DATE);
    IF p_target_count IS NOT NULL AND (p_target_count < 0 OR p_target_count > 200) THEN
        RAISE EXCEPTION 'INVALID_TARGET_REPORT_COUNT';
    END IF;

    SELECT history.id INTO v_first_segment
    FROM public.enrollment_class_history AS history
    WHERE history.enrollment_id = p_enrollment_id
    ORDER BY history.effective_from
    LIMIT 1;

    CREATE TEMP TABLE IF NOT EXISTS pg_temp.sync_enrollment_report_rows (
        report_id uuid,
        occurrence_id uuid,
        occurrence_date date,
        is_fixed boolean
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.sync_enrollment_report_rows;

    -- Classify the enrollment's existing reports.
    INSERT INTO pg_temp.sync_enrollment_report_rows
    SELECT report.id, occurrence.id, occurrence.occurrence_date,
           NOT private.is_blank_occurrence_report(report)
           OR EXISTS (
               SELECT 1 FROM public.single_lesson_transfers AS transfer
               WHERE transfer.enrollment_id = p_enrollment_id
                 AND transfer.target_occurrence_id = occurrence.id
                 AND transfer.cancelled_at IS NULL
           )
           OR NOT EXISTS (
               SELECT 1 FROM public.enrollment_class_history AS history
               WHERE history.enrollment_id = p_enrollment_id
                 AND history.class_session_id = occurrence.class_session_id
                 AND (history.effective_from <= occurrence.occurrence_date OR history.id = v_first_segment)
                 AND (history.effective_to IS NULL OR history.effective_to >= occurrence.occurrence_date)
           )
    FROM public.occurrence_reports AS report
    JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
    WHERE report.enrollment_id = p_enrollment_id;

    SELECT count(*) FILTER (WHERE is_fixed), count(*) FILTER (WHERE NOT is_fixed)
    INTO v_fixed_count, v_blank_count
    FROM pg_temp.sync_enrollment_report_rows;

    v_target := COALESCE(p_target_count, v_fixed_count + v_blank_count);
    v_slots := GREATEST(v_target - v_fixed_count, 0);

    SELECT COALESCE(jsonb_agg(to_jsonb(row_value.occurrence_date) ORDER BY row_value.occurrence_date), '[]'::jsonb)
    INTO v_fixed_before_start
    FROM pg_temp.sync_enrollment_report_rows AS row_value
    WHERE row_value.is_fixed AND row_value.occurrence_date < v_start;

    -- The lessons the blank placeholders should sit on.
    CREATE TEMP TABLE IF NOT EXISTS pg_temp.sync_enrollment_chosen (
        occurrence_id uuid PRIMARY KEY,
        occurrence_date date
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.sync_enrollment_chosen;

    INSERT INTO pg_temp.sync_enrollment_chosen
    SELECT occurrence.id, occurrence.occurrence_date
    FROM public.class_occurrences AS occurrence
    JOIN public.enrollment_class_history AS history
      ON history.enrollment_id = p_enrollment_id
     AND history.class_session_id = occurrence.class_session_id
     AND (history.effective_from <= occurrence.occurrence_date OR history.id = v_first_segment)
     AND (history.effective_to IS NULL OR history.effective_to >= occurrence.occurrence_date)
    WHERE occurrence.occurrence_date >= v_start
      AND COALESCE(occurrence.status, 'scheduled') NOT IN ('cancelled', 'rescheduled')
      AND NOT EXISTS (
          SELECT 1 FROM public.single_lesson_transfers AS transfer
          WHERE transfer.enrollment_id = p_enrollment_id
            AND transfer.source_occurrence_id = occurrence.id
            AND transfer.cancelled_at IS NULL
      )
      AND NOT EXISTS (
          SELECT 1 FROM pg_temp.sync_enrollment_report_rows AS row_value
          WHERE row_value.occurrence_id = occurrence.id AND row_value.is_fixed
      )
    ORDER BY occurrence.occurrence_date, occurrence.original_start_time NULLS LAST, occurrence.id
    LIMIT v_slots;

    SELECT count(*) INTO v_chosen_count FROM pg_temp.sync_enrollment_chosen;

    SELECT COALESCE(jsonb_agg(to_jsonb(row_value.occurrence_date) ORDER BY row_value.occurrence_date), '[]'::jsonb)
    INTO v_removed
    FROM pg_temp.sync_enrollment_report_rows AS row_value
    WHERE NOT row_value.is_fixed
      AND NOT EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_chosen AS chosen WHERE chosen.occurrence_id = row_value.occurrence_id);

    SELECT COALESCE(jsonb_agg(to_jsonb(chosen.occurrence_date) ORDER BY chosen.occurrence_date), '[]'::jsonb)
    INTO v_created
    FROM pg_temp.sync_enrollment_chosen AS chosen
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_report_rows AS row_value WHERE row_value.occurrence_id = chosen.occurrence_id);

    IF NOT p_dry_run THEN
        DELETE FROM public.report_versions AS version_row
        USING pg_temp.sync_enrollment_report_rows AS row_value
        WHERE version_row.occurrence_report_id = row_value.report_id
          AND NOT row_value.is_fixed
          AND NOT EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_chosen AS chosen WHERE chosen.occurrence_id = row_value.occurrence_id);
        DELETE FROM public.occurrence_reports AS report
        USING pg_temp.sync_enrollment_report_rows AS row_value
        WHERE report.id = row_value.report_id
          AND NOT row_value.is_fixed
          AND NOT EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_chosen AS chosen WHERE chosen.occurrence_id = row_value.occurrence_id);

        FOR v_row IN
            SELECT chosen.occurrence_id FROM pg_temp.sync_enrollment_chosen AS chosen
            WHERE NOT EXISTS (SELECT 1 FROM pg_temp.sync_enrollment_report_rows AS row_value WHERE row_value.occurrence_id = chosen.occurrence_id)
        LOOP
            SELECT * INTO v_attendance FROM public.get_effective_attendance(p_enrollment_id, v_row.occurrence_id);
            INSERT INTO public.occurrence_reports (
                enrollment_id, class_occurrence_id, content, version, is_completed, attendance_status, absence_reason
            ) VALUES (
                p_enrollment_id, v_row.occurrence_id, '', 1, false,
                COALESCE(v_attendance.attendance_status, 'pending'), v_attendance.absence_reason
            )
            ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'enrollment_id', p_enrollment_id,
        'start_date', v_start,
        'target_count', v_target,
        'fixed_count', v_fixed_count,
        'created_dates', v_created,
        'removed_dates', v_removed,
        'fixed_before_start_dates', v_fixed_before_start,
        'missing_count', GREATEST(v_slots - v_chosen_count, 0),
        'dry_run', p_dry_run
    );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_enrollment_reports(uuid, integer, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_enrollment_reports(uuid, integer, date, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
