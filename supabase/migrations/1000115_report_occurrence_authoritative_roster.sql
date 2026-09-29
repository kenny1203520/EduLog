BEGIN;

-- A report explicitly linked to an occurrence is authoritative for that
-- occurrence's roster, regardless of the enrollment's normal session/course,
-- start date, or status. A live transfer out of the occurrence still wins.
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
  WITH occurrence_context AS MATERIALIZED (
    SELECT occurrence.class_session_id, occurrence.occurrence_date
    FROM public.class_occurrences AS occurrence
    WHERE occurrence.id = p_occurrence_id
  ), same_session_enrollments AS MATERIALIZED (
    SELECT enrollment.*
    FROM public.enrollments AS enrollment
    JOIN occurrence_context AS occurrence
      ON occurrence.class_session_id = enrollment.class_session_id
    WHERE enrollment.status IN ('regular', 'completed')
      AND enrollment.start_date <= occurrence.occurrence_date
  ), transferred_out AS MATERIALIZED (
    SELECT transfer.enrollment_id
    FROM public.single_lesson_transfers AS transfer
    WHERE transfer.source_occurrence_id = p_occurrence_id
      AND transfer.cancelled_at IS NULL
  ), transferred_in AS MATERIALIZED (
    SELECT enrollment.*
    FROM public.single_lesson_transfers AS transfer
    JOIN public.enrollments AS enrollment ON enrollment.id = transfer.enrollment_id
    JOIN occurrence_context AS occurrence ON true
    WHERE transfer.target_occurrence_id = p_occurrence_id
      AND transfer.cancelled_at IS NULL
      AND enrollment.status = 'regular'
      AND enrollment.start_date <= occurrence.occurrence_date
      AND NOT EXISTS (
        SELECT 1
        FROM public.single_lesson_transfers AS onward
        WHERE onward.enrollment_id = transfer.enrollment_id
          AND onward.source_occurrence_id = p_occurrence_id
          AND onward.cancelled_at IS NULL
      )
  ), report_backed_enrollments AS MATERIALIZED (
    SELECT DISTINCT enrollment.*
    FROM public.occurrence_reports AS report
    JOIN public.enrollments AS enrollment ON enrollment.id = report.enrollment_id
    WHERE report.class_occurrence_id = p_occurrence_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.single_lesson_transfers AS transfer
        WHERE transfer.enrollment_id = enrollment.id
          AND transfer.source_occurrence_id = p_occurrence_id
          AND transfer.cancelled_at IS NULL
      )
  ), roster_candidates AS MATERIALIZED (
    SELECT enrollment.*
    FROM same_session_enrollments AS enrollment
    WHERE enrollment.status = 'completed'
       OR NOT EXISTS (
         SELECT 1 FROM transferred_out AS outgoing
         WHERE outgoing.enrollment_id = enrollment.id
       )
    UNION
    SELECT enrollment.* FROM transferred_in AS enrollment
    UNION
    SELECT enrollment.* FROM report_backed_enrollments AS enrollment
  ), completion_dates AS MATERIALIZED (
    SELECT enrollment.id AS enrollment_id,
           max(occurrence.occurrence_date) AS completed_on
    FROM roster_candidates AS enrollment
    JOIN public.occurrence_reports AS report
      ON report.enrollment_id = enrollment.id
     AND report.attendance_status = 'present'
     AND report.is_completed IS TRUE
     AND report.lesson_id IS NOT NULL
    JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.lessons AS current_lesson
      ON current_lesson.id = report.lesson_id
     AND current_lesson.course_id = enrollment.course_id
    WHERE enrollment.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM public.lessons AS later_lesson
        WHERE later_lesson.course_id = enrollment.course_id
          AND later_lesson.sequence > current_lesson.sequence
      )
    GROUP BY enrollment.id
  )
  SELECT candidate.id
  FROM roster_candidates AS candidate
  JOIN occurrence_context AS occurrence ON true
  LEFT JOIN completion_dates AS completion ON completion.enrollment_id = candidate.id
  WHERE NOT EXISTS (
          SELECT 1 FROM transferred_out AS outgoing
          WHERE outgoing.enrollment_id = candidate.id
        )
    AND (EXISTS (
          SELECT 1 FROM report_backed_enrollments AS reported
          WHERE reported.id = candidate.id
        )
     OR candidate.status = 'regular'
     OR (candidate.status = 'completed'
         AND completion.completed_on IS NOT NULL
         AND occurrence.occurrence_date <= completion.completed_on));
END;
$$;

-- Keep the workspace's final status/date filter aligned with the shared roster:
-- a report-backed student must not be filtered out a second time here.
CREATE OR REPLACE FUNCTION public.get_class_session_workspace(
  p_session_id uuid,
  p_occurrence_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_occurrence_date date := COALESCE(p_occurrence_date, CURRENT_DATE);
  v_occurrence_id uuid;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;

  IF p_session_id IS NULL OR NOT (
    public.can_access_class_session(p_session_id, 'teaching.class_sessions.read')
    OR public.can_access_class_session(p_session_id, 'teaching.class_sessions.list')
  ) THEN
    RETURN jsonb_build_object('session', NULL, 'enrollments', '[]'::jsonb, 'teachers', '[]'::jsonb);
  END IF;

  SELECT occurrence.id INTO v_occurrence_id
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.class_session_id = p_session_id
    AND occurrence.occurrence_date = v_occurrence_date;

  WITH effective_ids AS MATERIALIZED (
    SELECT effective.enrollment_id
    FROM public.get_effective_occurrence_enrollment_ids(v_occurrence_id) AS effective
  ), session_enrollments AS MATERIALIZED (
    SELECT enrollment.*
    FROM public.enrollments AS enrollment
    WHERE enrollment.class_session_id = p_session_id
      AND enrollment.start_date <= v_occurrence_date
      AND enrollment.status IN ('regular', 'completed')
    UNION
    SELECT enrollment.*
    FROM effective_ids AS effective
    JOIN public.enrollments AS enrollment ON enrollment.id = effective.enrollment_id
  ), completion_dates AS MATERIALIZED (
    SELECT enrollment.id AS enrollment_id,
           max(occurrence.occurrence_date) AS completed_on
    FROM session_enrollments AS enrollment
    JOIN public.occurrence_reports AS report
      ON report.enrollment_id = enrollment.id
     AND report.attendance_status = 'present'
     AND report.is_completed IS TRUE
     AND report.lesson_id IS NOT NULL
    JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.lessons AS current_lesson
      ON current_lesson.id = report.lesson_id
     AND current_lesson.course_id = enrollment.course_id
    WHERE enrollment.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM public.lessons AS later_lesson
        WHERE later_lesson.course_id = enrollment.course_id
          AND later_lesson.sequence > current_lesson.sequence
      )
    GROUP BY enrollment.id
  ), eligible_enrollments AS MATERIALIZED (
    SELECT enrollment.*
    FROM session_enrollments AS enrollment
    LEFT JOIN completion_dates AS completion ON completion.enrollment_id = enrollment.id
    WHERE NOT EXISTS (
            SELECT 1 FROM public.single_lesson_transfers AS transfer
            WHERE transfer.enrollment_id = enrollment.id
              AND transfer.source_occurrence_id = v_occurrence_id
              AND transfer.cancelled_at IS NULL
          )
      AND (EXISTS (
            SELECT 1 FROM effective_ids AS effective
            WHERE effective.enrollment_id = enrollment.id
          )
       OR (enrollment.status = 'regular' AND v_occurrence_id IS NULL)
       OR (enrollment.status = 'completed'
           AND completion.completed_on IS NOT NULL
           AND v_occurrence_date <= completion.completed_on))
  )
  SELECT jsonb_build_object(
    'session', (
      SELECT jsonb_build_object(
        'id', session.id, 'name', session.name, 'classroom_id', session.classroom_id,
        'course_ids', session.course_ids, 'day_of_week', session.day_of_week,
        'start_time', session.start_time, 'end_time', session.end_time,
        'capacity', session.capacity, 'lesson_number', session.lesson_number,
        'external_link', session.external_link, 'start_date', session.start_date,
        'end_date', session.end_date, 'time_zone', session.time_zone,
        'session_type', session.session_type, 'schedule_mode', session.schedule_mode,
        'created_at', session.created_at, 'updated_at', session.updated_at,
        'roster_date', v_occurrence_date,
        'classrooms', (
          SELECT CASE WHEN classroom.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', classroom.id, 'name', classroom.name, 'color', classroom.color,
            'external_link', classroom.external_link
          ) END
          FROM public.classrooms AS classroom WHERE classroom.id = session.classroom_id
        ),
        'schedule_rules', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', rule.id, 'schedule_kind', rule.schedule_kind, 'day_of_week', rule.day_of_week,
            'day_of_month', rule.day_of_month, 'occurrence_date', rule.occurrence_date,
            'start_time', rule.start_time, 'end_time', rule.end_time
          ) ORDER BY rule.occurrence_date NULLS LAST, rule.day_of_week NULLS LAST, rule.start_time, rule.id)
          FROM public.class_session_schedule_rules AS rule WHERE rule.class_session_id = session.id
        ), '[]'::jsonb)
      )
      FROM public.class_sessions AS session WHERE session.id = p_session_id
    ),
    'enrollments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', enrollment.id, 'student_id', enrollment.student_id, 'course_id', enrollment.course_id,
        'classroom_id', CASE WHEN enrollment.class_session_id = p_session_id
          THEN enrollment.classroom_id ELSE (SELECT target.classroom_id FROM public.class_sessions AS target WHERE target.id = p_session_id) END,
        'class_session_id', p_session_id,
        'status', enrollment.status, 'start_date', enrollment.start_date,
        'lesson_number', enrollment.lesson_number, 'external_link', enrollment.external_link,
        'time_zone', enrollment.time_zone, 'koding_admission_id', enrollment.koding_admission_id,
        'created_at', enrollment.created_at, 'updated_at', enrollment.updated_at,
        'courses', (SELECT jsonb_build_object('subject', course.subject, 'stage', course.stage, 'display_name', course.display_name)
                    FROM public.courses AS course WHERE course.id = enrollment.course_id),
        'classrooms', (SELECT jsonb_build_object('name', classroom.name)
                       FROM public.classrooms AS classroom
                       WHERE classroom.id = CASE WHEN enrollment.class_session_id = p_session_id
                         THEN enrollment.classroom_id ELSE (SELECT target.classroom_id FROM public.class_sessions AS target WHERE target.id = p_session_id) END),
        'students', (SELECT jsonb_build_object('name', student.name)
                     FROM public.students AS student WHERE student.id = enrollment.student_id)
      ) ORDER BY enrollment.created_at, enrollment.id)
      FROM eligible_enrollments AS enrollment
    ), '[]'::jsonb),
    'teachers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', teacher.id, 'user_id', teacher.user_id, 'name', teacher.name)
                       ORDER BY teacher.name, teacher.id)
      FROM public.class_session_teachers AS assignment
      JOIN public.teachers AS teacher ON teacher.id = assignment.teacher_id
      WHERE assignment.class_session_id = p_session_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
