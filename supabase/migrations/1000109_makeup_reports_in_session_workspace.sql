BEGIN;

-- A one-off makeup report does not change the enrollment's normal session.
-- Surface that enrollment in this occurrence's workspace only, without
-- broadening the shared effective-roster function used by transfers/attendance.
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
  ),
  makeup_ids AS MATERIALIZED (
    SELECT DISTINCT report.enrollment_id
    FROM public.occurrence_reports AS report
    JOIN public.enrollments AS enrollment ON enrollment.id = report.enrollment_id
    JOIN public.class_sessions AS target ON target.id = p_session_id
    WHERE report.class_occurrence_id = v_occurrence_id
      AND enrollment.class_session_id IS DISTINCT FROM p_session_id
      AND enrollment.course_id = ANY(COALESCE(target.course_ids, '{}'::uuid[]))
      AND enrollment.start_date <= v_occurrence_date
      AND enrollment.status IN ('regular', 'completed')
      AND NOT EXISTS (
        SELECT 1 FROM public.single_lesson_transfers AS transfer
        WHERE transfer.enrollment_id = enrollment.id
          AND transfer.source_occurrence_id = v_occurrence_id
          AND transfer.cancelled_at IS NULL
      )
  ),
  session_enrollments AS MATERIALIZED (
    SELECT enrollment.*
    FROM public.enrollments AS enrollment
    WHERE enrollment.class_session_id = p_session_id
      AND enrollment.start_date <= v_occurrence_date
      AND enrollment.status IN ('regular', 'completed')
    UNION
    SELECT enrollment.*
    FROM effective_ids AS effective
    JOIN public.enrollments AS enrollment ON enrollment.id = effective.enrollment_id
    UNION
    SELECT enrollment.*
    FROM makeup_ids AS makeup
    JOIN public.enrollments AS enrollment ON enrollment.id = makeup.enrollment_id
  ),
  completion_dates AS MATERIALIZED (
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
  ),
  eligible_enrollments AS MATERIALIZED (
    SELECT enrollment.*
    FROM session_enrollments AS enrollment
    LEFT JOIN completion_dates AS completion ON completion.enrollment_id = enrollment.id
    WHERE (enrollment.status = 'regular' AND (
             v_occurrence_id IS NULL
             OR EXISTS (SELECT 1 FROM effective_ids WHERE enrollment_id = enrollment.id)
             OR EXISTS (SELECT 1 FROM makeup_ids WHERE enrollment_id = enrollment.id)
           ))
       OR (enrollment.status = 'completed'
           AND completion.completed_on IS NOT NULL
           AND v_occurrence_date <= completion.completed_on)
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

COMMIT;
