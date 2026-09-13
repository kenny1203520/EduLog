-- 1000062: forward-only report lifecycle and strict mutation boundary.
-- Historical migrations 1000001-1000061 are restored byte-for-byte and must
-- not be edited. This migration owns the post-1000061 lifecycle behavior.

CREATE OR REPLACE FUNCTION public.get_occurrence_report_mutation_context(
  p_report_id uuid,
  p_permission_key text
) RETURNS TABLE (
  report_id uuid,
  version integer,
  attendance_status text,
  absence_reason text,
  enrollment_id uuid,
  class_occurrence_id uuid,
  teaching_id uuid,
  classroom_id uuid,
  class_session_id uuid,
  lesson_id uuid,
  is_completed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    report.id,
    report.version,
    report.attendance_status,
    report.absence_reason,
    report.enrollment_id,
    report.class_occurrence_id,
    session.teaching_id,
    session.classroom_id,
    session.id,
    report.lesson_id,
    report.is_completed
  FROM public.occurrence_reports report
  JOIN public.class_occurrences occurrence
    ON occurrence.id = report.class_occurrence_id
  JOIN public.class_sessions session
    ON session.id = occurrence.class_session_id
  WHERE report.id = p_report_id
    AND auth.uid() IS NOT NULL
    AND p_permission_key IN ('teaching.reports.update', 'teaching.reports.delete')
    AND public.is_teaching_member(session.teaching_id, auth.uid())
    AND public.has_teaching_permission(auth.uid(), p_permission_key, session.teaching_id, session.classroom_id, session.id);
$$;

REVOKE ALL ON FUNCTION public.get_occurrence_report_mutation_context(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_occurrence_report_mutation_context(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_mutate_occurrence_report(
  p_report_id uuid,
  p_permission_key text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.get_occurrence_report_mutation_context(p_report_id, p_permission_key)
  );
$$;

REVOKE ALL ON FUNCTION public.can_mutate_occurrence_report(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_mutate_occurrence_report(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_occurrence_report_lifecycle(
  p_report_id uuid,
  p_expected_version integer,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_actor uuid DEFAULT auth.uid(),
  p_operation text DEFAULT 'update'
) RETURNS public.occurrence_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.occurrence_reports%ROWTYPE;
  v_report public.occurrence_reports%ROWTYPE;
  v_permission text;
  v_enrollment public.enrollments%ROWTYPE;
  v_occurrence public.class_occurrences%ROWTYPE;
  v_base_session public.class_sessions%ROWTYPE;
  v_next public.class_occurrences%ROWTYPE;
  v_next_date date;
  v_start_time time;
  v_end_time time;
  v_next_lesson integer;
  v_next_attendance_status text := 'pending';
  v_next_absence_reason text := NULL;
BEGIN
  IF p_operation NOT IN ('update', 'delete') THEN
    RAISE EXCEPTION 'INVALID_OPERATION';
  END IF;
  IF p_actor IS NULL OR auth.uid() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  v_permission := CASE WHEN p_operation = 'delete'
    THEN 'teaching.reports.delete'
    ELSE 'teaching.reports.update'
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_occurrence_report_mutation_context(p_report_id, v_permission)
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT * INTO v_current
  FROM public.occurrence_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF v_current.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT';
  END IF;

  IF p_operation = 'delete' THEN
    DELETE FROM public.report_versions WHERE occurrence_report_id = p_report_id;
    DELETE FROM public.occurrence_reports
    WHERE id = p_report_id
    RETURNING * INTO v_report;
    SELECT * INTO v_enrollment
    FROM public.enrollments
    WHERE id = v_report.enrollment_id
    FOR UPDATE;
  ELSE
    IF (p_patch ? 'absence_reason')
       AND (p_patch->>'absence_reason') IN ('holiday', 'suspension')
       AND v_current.absence_reason IS DISTINCT FROM (p_patch->>'absence_reason') THEN
      RAISE EXCEPTION 'SYSTEM_MANAGED_REPORT';
    END IF;
    IF v_current.absence_reason IN ('holiday', 'suspension')
       AND ((p_patch ? 'attendance_status' AND p_patch->>'attendance_status' IS DISTINCT FROM v_current.attendance_status)
         OR (p_patch ? 'absence_reason' AND p_patch->>'absence_reason' IS DISTINCT FROM v_current.absence_reason)) THEN
      RAISE EXCEPTION 'SYSTEM_MANAGED_REPORT';
    END IF;

    UPDATE public.occurrence_reports
    SET lesson_id = CASE WHEN p_patch ? 'lesson_id' THEN NULLIF(p_patch->>'lesson_id', '')::uuid ELSE lesson_id END,
        is_completed = CASE WHEN p_patch ? 'is_completed' THEN (p_patch->>'is_completed')::boolean ELSE is_completed END,
        progress_letter = CASE WHEN p_patch ? 'progress_letter' THEN NULLIF(p_patch->>'progress_letter', '') ELSE progress_letter END,
        attendance_status = CASE WHEN p_patch ? 'attendance_status' THEN p_patch->>'attendance_status' ELSE attendance_status END,
        absence_reason = CASE WHEN p_patch ? 'absence_reason' THEN NULLIF(p_patch->>'absence_reason', '') ELSE absence_reason END,
        class_participation = CASE WHEN p_patch ? 'class_participation' THEN (p_patch->>'class_participation')::numeric ELSE class_participation END,
        classroom_behavior = CASE WHEN p_patch ? 'classroom_behavior' THEN (p_patch->>'classroom_behavior')::numeric ELSE classroom_behavior END,
        contact_notes = CASE WHEN p_patch ? 'contact_notes' THEN NULLIF(p_patch->>'contact_notes', '') ELSE contact_notes END,
        contact_notes_document = CASE WHEN p_patch ? 'contact_notes_document' THEN NULLIF(p_patch->'contact_notes_document', 'null'::jsonb) ELSE contact_notes_document END,
        class_notes = CASE WHEN p_patch ? 'class_notes' THEN NULLIF(p_patch->>'class_notes', '') ELSE class_notes END,
        class_notes_document = CASE WHEN p_patch ? 'class_notes_document' THEN NULLIF(p_patch->'class_notes_document', 'null'::jsonb) ELSE class_notes_document END,
        content = CASE WHEN p_patch ? 'content' THEN NULLIF(p_patch->>'content', '') ELSE content END,
        content_document = CASE WHEN p_patch ? 'content_document' THEN NULLIF(p_patch->'content_document', 'null'::jsonb) ELSE content_document END,
        external_link = CASE WHEN p_patch ? 'external_link' THEN NULLIF(p_patch->>'external_link', '') ELSE external_link END,
        version = version + 1,
        last_edited_by = p_actor,
        last_edited_at = timezone('utc'::text, now())
    WHERE id = p_report_id AND version = p_expected_version
    RETURNING * INTO v_report;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'VERSION_CONFLICT';
    END IF;
    SELECT * INTO v_enrollment
    FROM public.enrollments
    WHERE id = v_report.enrollment_id
    FOR UPDATE;
  END IF;

  IF v_enrollment.id IS NOT NULL THEN
    SELECT COALESCE(min(lesson.sequence), v_enrollment.lesson_number)
      INTO v_next_lesson
    FROM public.lessons lesson
    WHERE lesson.course_id = v_enrollment.course_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.occurrence_reports completed_report
        WHERE completed_report.enrollment_id = v_enrollment.id
          AND completed_report.lesson_id = lesson.id
          AND completed_report.is_completed IS TRUE
      );
    UPDATE public.enrollments
    SET lesson_number = COALESCE(v_next_lesson, lesson_number)
    WHERE id = v_enrollment.id;
  END IF;

  -- Pre-create the next report when lesson/completion changes. Progress is
  -- calculated independently above, so incomplete reports do not advance it.
  IF p_operation = 'update'
     AND v_enrollment.status = 'regular'
     AND (p_patch ? 'lesson_id' OR p_patch ? 'is_completed')
     AND v_report.lesson_id IS NOT NULL THEN
    SELECT * INTO v_occurrence
    FROM public.class_occurrences
    WHERE id = v_report.class_occurrence_id;
    IF v_occurrence.id IS NOT NULL THEN
      SELECT * INTO v_base_session
      FROM public.class_sessions
      WHERE id = v_enrollment.class_session_id;
      IF v_base_session.id IS NULL THEN
        RETURN v_report;
      END IF;

      SELECT * INTO v_next
      FROM public.class_occurrences occurrence
      WHERE occurrence.class_session_id = v_base_session.id
        AND occurrence.occurrence_date > v_occurrence.occurrence_date
        AND (v_base_session.end_date IS NULL OR occurrence.occurrence_date <= v_base_session.end_date)
      ORDER BY occurrence.occurrence_date
      LIMIT 1;

      IF v_next.id IS NULL THEN
        SELECT candidate::date, rule.start_time, rule.end_time
          INTO v_next_date, v_start_time, v_end_time
        FROM generate_series(
          v_occurrence.occurrence_date + 1,
          LEAST(v_occurrence.occurrence_date + 730, COALESCE(v_base_session.end_date, v_occurrence.occurrence_date + 730)),
          interval '1 day'
        ) candidate
        JOIN public.class_session_schedule_rules rule
          ON rule.class_session_id = v_base_session.id
         AND ((rule.schedule_kind = 'weekly' AND rule.day_of_week = EXTRACT(DOW FROM candidate)::integer)
           OR (rule.schedule_kind = 'monthly' AND rule.day_of_month = EXTRACT(DAY FROM candidate)::integer)
           OR (rule.schedule_kind = 'specific_dates' AND rule.occurrence_date = candidate::date))
        ORDER BY candidate
        LIMIT 1;
        IF v_next_date IS NOT NULL THEN
          INSERT INTO public.class_occurrences(class_session_id, occurrence_date, status, original_start_time, original_end_time, time_zone, is_conducted)
          SELECT v_base_session.id, v_next_date, 'scheduled', v_start_time, v_end_time, v_base_session.time_zone, true
          WHERE v_base_session.start_date IS NULL OR v_next_date >= v_base_session.start_date
          ON CONFLICT (class_session_id, occurrence_date) DO NOTHING
          RETURNING * INTO v_next;
          IF v_next.id IS NULL THEN
            SELECT * INTO v_next
            FROM public.class_occurrences occurrence
            WHERE occurrence.class_session_id = v_base_session.id
              AND occurrence.occurrence_date = v_next_date;
          END IF;
        END IF;
      END IF;

      IF v_next.id IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.student_suspensions suspension
          WHERE suspension.enrollment_id = v_enrollment.id
            AND suspension.start_date <= v_next.occurrence_date
            AND (suspension.end_date IS NULL OR suspension.end_date >= v_next.occurrence_date)
        ) THEN
          v_next_attendance_status := 'absent';
          v_next_absence_reason := 'suspension';
        ELSIF EXISTS (
          SELECT 1 FROM public.holidays holiday
          WHERE holiday.kind = 'closure'
            AND holiday.start_date <= v_next.occurrence_date
            AND holiday.end_date >= v_next.occurrence_date
            AND (
              (COALESCE(cardinality(holiday.classroom_ids), 0) = 0 AND COALESCE(cardinality(holiday.class_session_ids), 0) = 0)
              OR v_base_session.classroom_id = ANY(COALESCE(holiday.classroom_ids, '{}'::uuid[]))
              OR v_base_session.id = ANY(COALESCE(holiday.class_session_ids, '{}'::uuid[]))
            )
        ) THEN
          v_next_attendance_status := 'absent';
          v_next_absence_reason := 'holiday';
        END IF;
        INSERT INTO public.occurrence_reports(enrollment_id, class_occurrence_id, content, version, is_completed, attendance_status, absence_reason)
        VALUES (v_enrollment.id, v_next.id, '', 1, false, v_next_attendance_status, v_next_absence_reason)
        ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_occurrence_report_lifecycle(uuid, integer, jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_occurrence_report_lifecycle(uuid, integer, jsonb, uuid, text) TO authenticated, service_role;
