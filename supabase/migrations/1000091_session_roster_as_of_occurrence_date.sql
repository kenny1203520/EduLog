-- Scope class-session roster reads to the selected occurrence date.
-- Completed enrollments remain visible only through their final completed report date.

CREATE INDEX IF NOT EXISTS enrollments_class_session_status_start_idx
  ON public.enrollments (class_session_id, status, start_date, id);

CREATE INDEX IF NOT EXISTS occurrence_reports_enrollment_completion_lookup_idx
  ON public.occurrence_reports (enrollment_id, attendance_status, is_completed, class_occurrence_id);

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

  WITH session_enrollments AS MATERIALIZED (
    SELECT enrollment.*
    FROM public.enrollments enrollment
    WHERE enrollment.class_session_id = p_session_id
      AND enrollment.start_date <= v_occurrence_date
      AND enrollment.status IN ('regular', 'completed')
  ),
  completion_dates AS MATERIALIZED (
    SELECT enrollment.id AS enrollment_id,
           max(occurrence.occurrence_date) AS completed_on
    FROM session_enrollments enrollment
    JOIN public.occurrence_reports report
      ON report.enrollment_id = enrollment.id
     AND report.attendance_status = 'present'
     AND report.is_completed IS TRUE
     AND report.lesson_id IS NOT NULL
    JOIN public.class_occurrences occurrence
      ON occurrence.id = report.class_occurrence_id
    JOIN public.lessons current_lesson
      ON current_lesson.id = report.lesson_id
     AND current_lesson.course_id = enrollment.course_id
    WHERE enrollment.status = 'completed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.lessons later_lesson
        WHERE later_lesson.course_id = enrollment.course_id
          AND later_lesson.sequence > current_lesson.sequence
      )
    GROUP BY enrollment.id
  ),
  eligible_enrollments AS MATERIALIZED (
    SELECT enrollment.*
    FROM session_enrollments enrollment
    LEFT JOIN completion_dates completion
      ON completion.enrollment_id = enrollment.id
    WHERE enrollment.status = 'regular'
       OR (
         enrollment.status = 'completed'
         AND completion.completed_on IS NOT NULL
         AND v_occurrence_date <= completion.completed_on
       )
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
          FROM public.classrooms classroom
          WHERE classroom.id = session.classroom_id
        ),
        'schedule_rules', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', rule.id, 'schedule_kind', rule.schedule_kind, 'day_of_week', rule.day_of_week,
            'day_of_month', rule.day_of_month, 'occurrence_date', rule.occurrence_date,
            'start_time', rule.start_time, 'end_time', rule.end_time
          ) ORDER BY rule.occurrence_date NULLS LAST, rule.day_of_week NULLS LAST, rule.start_time, rule.id)
          FROM public.class_session_schedule_rules rule
          WHERE rule.class_session_id = session.id
        ), '[]'::jsonb)
      )
      FROM public.class_sessions session
      WHERE session.id = p_session_id
    ),
    'enrollments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', enrollment.id, 'student_id', enrollment.student_id, 'course_id', enrollment.course_id,
        'classroom_id', enrollment.classroom_id, 'class_session_id', enrollment.class_session_id,
        'status', enrollment.status, 'start_date', enrollment.start_date,
        'lesson_number', enrollment.lesson_number, 'external_link', enrollment.external_link,
        'time_zone', enrollment.time_zone, 'koding_admission_id', enrollment.koding_admission_id,
        'created_at', enrollment.created_at, 'updated_at', enrollment.updated_at,
        'courses', (
          SELECT jsonb_build_object('subject', course.subject, 'stage', course.stage, 'display_name', course.display_name)
          FROM public.courses course
          WHERE course.id = enrollment.course_id
        ),
        'classrooms', (
          SELECT jsonb_build_object('name', classroom.name)
          FROM public.classrooms classroom
          WHERE classroom.id = enrollment.classroom_id
        ),
        'students', (
          SELECT jsonb_build_object('name', student.name)
          FROM public.students student
          WHERE student.id = enrollment.student_id
        )
      ) ORDER BY enrollment.created_at, enrollment.id)
      FROM eligible_enrollments enrollment
    ), '[]'::jsonb),
    'teachers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', teacher.id, 'user_id', teacher.user_id, 'name', teacher.name
      ) ORDER BY teacher.name, teacher.id)
      FROM public.class_session_teachers assignment
      JOIN public.teachers teacher ON teacher.id = assignment.teacher_id
      WHERE assignment.class_session_id = p_session_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Keep the old signature safe for direct callers: it is date-scoped rather than
-- returning every historical enrollment for the session.
CREATE OR REPLACE FUNCTION public.get_class_session_workspace(p_session_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.get_class_session_workspace(p_session_id, CURRENT_DATE);
$$;

REVOKE ALL ON FUNCTION public.get_class_session_workspace(uuid, date)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_class_session_workspace(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_class_session_workspace(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_session_workspace(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_class_session_workspace(uuid, date)
  IS 'Safe class-session workspace scoped to the selected occurrence date; completed enrollments require a final completed report on or after that date.';
COMMENT ON FUNCTION public.get_class_session_workspace(uuid)
  IS 'Compatibility wrapper for the date-scoped class-session workspace using the current database date.';

NOTIFY pgrst, 'reload schema';
