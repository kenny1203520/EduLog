BEGIN;

-- Use the transfer-aware roster for generated occurrences. A session without a
-- generated occurrence keeps the existing date-based enrollment fallback.
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

CREATE OR REPLACE FUNCTION public.get_class_session_workspace(p_session_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT public.get_class_session_workspace(p_session_id, CURRENT_DATE); $$;

-- The private channel carries only an invalidation hint. The client re-reads
-- data through the existing scoped APIs, so no student or report content is
-- placed in Realtime messages.
CREATE OR REPLACE FUNCTION public.broadcast_class_session_invalidation(
  p_class_session_id uuid,
  p_change_kind text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_class_session_id IS NULL THEN RETURN; END IF;
  PERFORM realtime.send(
    jsonb_build_object('resource', 'class_session', 'change', p_change_kind),
    'class_session_invalidated',
    'class-session:' || p_class_session_id::text,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_class_session_workspace_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_session_id uuid;
  v_occurrence_id uuid;
  v_course_id uuid;
  v_classroom_id uuid;
BEGIN
  IF TG_TABLE_NAME IN ('class_sessions', 'class_session_schedule_rules', 'class_session_teachers', 'enrollments', 'class_occurrences') THEN
    IF TG_OP <> 'INSERT' THEN
      v_session_id := (to_jsonb(OLD)->>'class_session_id')::uuid;
      IF v_session_id IS NULL AND TG_TABLE_NAME = 'class_sessions' THEN v_session_id := (to_jsonb(OLD)->>'id')::uuid; END IF;
      PERFORM public.broadcast_class_session_invalidation(v_session_id, TG_TABLE_NAME);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_session_id := (to_jsonb(NEW)->>'class_session_id')::uuid;
      IF v_session_id IS NULL AND TG_TABLE_NAME = 'class_sessions' THEN v_session_id := (to_jsonb(NEW)->>'id')::uuid; END IF;
      PERFORM public.broadcast_class_session_invalidation(v_session_id, TG_TABLE_NAME);
    END IF;
  ELSIF TG_TABLE_NAME = 'occurrence_reports' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT occurrence.class_session_id INTO v_session_id FROM public.class_occurrences AS occurrence
      WHERE occurrence.id = (to_jsonb(OLD)->>'class_occurrence_id')::uuid;
      PERFORM public.broadcast_class_session_invalidation(v_session_id, 'report');
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT occurrence.class_session_id INTO v_session_id FROM public.class_occurrences AS occurrence
      WHERE occurrence.id = (to_jsonb(NEW)->>'class_occurrence_id')::uuid;
      PERFORM public.broadcast_class_session_invalidation(v_session_id, 'report');
    END IF;
  ELSIF TG_TABLE_NAME = 'single_lesson_transfers' THEN
    FOR v_occurrence_id IN
      SELECT DISTINCT occurrence_id
      FROM (VALUES
        (CASE WHEN TG_OP <> 'INSERT' THEN (to_jsonb(OLD)->>'source_occurrence_id')::uuid END),
        (CASE WHEN TG_OP <> 'INSERT' THEN (to_jsonb(OLD)->>'target_occurrence_id')::uuid END),
        (CASE WHEN TG_OP <> 'DELETE' THEN (to_jsonb(NEW)->>'source_occurrence_id')::uuid END),
        (CASE WHEN TG_OP <> 'DELETE' THEN (to_jsonb(NEW)->>'target_occurrence_id')::uuid END)
      ) AS ids(occurrence_id) WHERE occurrence_id IS NOT NULL
    LOOP
      SELECT occurrence.class_session_id INTO v_session_id FROM public.class_occurrences AS occurrence WHERE occurrence.id = v_occurrence_id;
      PERFORM public.broadcast_class_session_invalidation(v_session_id, 'transfer');
    END LOOP;
  ELSIF TG_TABLE_NAME IN ('students', 'student_suspensions') THEN
    IF TG_TABLE_NAME = 'students' THEN
      v_id := CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD)->>'id')::uuid ELSE (to_jsonb(NEW)->>'id')::uuid END;
      FOR v_session_id IN SELECT DISTINCT enrollment.class_session_id FROM public.enrollments AS enrollment
        WHERE enrollment.student_id = v_id AND enrollment.class_session_id IS NOT NULL
      LOOP PERFORM public.broadcast_class_session_invalidation(v_session_id, 'student'); END LOOP;
      FOR v_occurrence_id IN
        SELECT DISTINCT ids.occurrence_id
        FROM public.enrollments enrollment
        JOIN public.single_lesson_transfers transfer ON transfer.enrollment_id = enrollment.id
        CROSS JOIN LATERAL (VALUES (transfer.source_occurrence_id), (transfer.target_occurrence_id)) ids(occurrence_id)
        WHERE enrollment.student_id = v_id
      LOOP
        SELECT occurrence.class_session_id INTO v_session_id FROM public.class_occurrences AS occurrence WHERE occurrence.id = v_occurrence_id;
        PERFORM public.broadcast_class_session_invalidation(v_session_id, 'student');
      END LOOP;
    ELSE
      v_id := CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD)->>'enrollment_id')::uuid ELSE (to_jsonb(NEW)->>'enrollment_id')::uuid END;
      SELECT enrollment.class_session_id INTO v_session_id FROM public.enrollments AS enrollment WHERE enrollment.id = v_id;
      PERFORM public.broadcast_class_session_invalidation(v_session_id, 'suspension');
    END IF;
  ELSIF TG_TABLE_NAME IN ('courses', 'lessons') THEN
    v_course_id := CASE WHEN TG_TABLE_NAME = 'courses'
      THEN CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD)->>'id')::uuid ELSE (to_jsonb(NEW)->>'id')::uuid END
      ELSE CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD)->>'course_id')::uuid ELSE (to_jsonb(NEW)->>'course_id')::uuid END END;
    FOR v_session_id IN SELECT DISTINCT session.id FROM public.class_sessions AS session
      WHERE v_course_id = ANY(COALESCE(session.course_ids, '{}'::uuid[]))
    LOOP PERFORM public.broadcast_class_session_invalidation(v_session_id, 'course'); END LOOP;
    FOR v_session_id IN SELECT DISTINCT enrollment.class_session_id FROM public.enrollments AS enrollment
      WHERE enrollment.course_id = v_course_id AND enrollment.class_session_id IS NOT NULL
    LOOP PERFORM public.broadcast_class_session_invalidation(v_session_id, 'course'); END LOOP;
  ELSIF TG_TABLE_NAME = 'classrooms' THEN
    v_classroom_id := CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD)->>'id')::uuid ELSE (to_jsonb(NEW)->>'id')::uuid END;
    FOR v_session_id IN SELECT session.id FROM public.class_sessions AS session WHERE session.classroom_id = v_classroom_id
    LOOP PERFORM public.broadcast_class_session_invalidation(v_session_id, 'classroom'); END LOOP;
  ELSIF TG_TABLE_NAME = 'holidays' THEN
    FOR v_session_id IN
      SELECT DISTINCT value::uuid
      FROM (
        SELECT jsonb_array_elements_text(COALESCE(to_jsonb(OLD)->'class_session_ids', '[]'::jsonb)) AS value
        WHERE TG_OP <> 'INSERT'
        UNION ALL
        SELECT jsonb_array_elements_text(COALESCE(to_jsonb(NEW)->'class_session_ids', '[]'::jsonb)) AS value
        WHERE TG_OP <> 'DELETE'
      ) AS session_ids
    LOOP PERFORM public.broadcast_class_session_invalidation(v_session_id, 'holiday'); END LOOP;
    FOR v_classroom_id IN
      SELECT DISTINCT value::uuid
      FROM (
        SELECT jsonb_array_elements_text(COALESCE(to_jsonb(OLD)->'classroom_ids', '[]'::jsonb)) AS value
        WHERE TG_OP <> 'INSERT'
        UNION ALL
        SELECT jsonb_array_elements_text(COALESCE(to_jsonb(NEW)->'classroom_ids', '[]'::jsonb)) AS value
        WHERE TG_OP <> 'DELETE'
      ) AS classroom_ids
    LOOP
      FOR v_session_id IN SELECT session.id FROM public.class_sessions AS session WHERE session.classroom_id = v_classroom_id
      LOOP PERFORM public.broadcast_class_session_invalidation(v_session_id, 'holiday'); END LOOP;
    END LOOP;
    IF (TG_OP <> 'INSERT' AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(to_jsonb(OLD)->'class_session_ids', '[]'::jsonb))
        ) AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(to_jsonb(OLD)->'classroom_ids', '[]'::jsonb))
        )) OR (TG_OP <> 'DELETE' AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(to_jsonb(NEW)->'class_session_ids', '[]'::jsonb))
        ) AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(to_jsonb(NEW)->'classroom_ids', '[]'::jsonb))
        )) THEN
      FOR v_session_id IN SELECT session.id FROM public.class_sessions AS session
      LOOP PERFORM public.broadcast_class_session_invalidation(v_session_id, 'holiday'); END LOOP;
    END IF;
  ELSIF TG_TABLE_NAME = 'teacher_records' THEN
    v_id := CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD)->>'id')::uuid ELSE (to_jsonb(NEW)->>'id')::uuid END;
    FOR v_session_id IN SELECT DISTINCT assignment.class_session_id FROM public.class_session_teachers AS assignment
      WHERE assignment.teacher_id = v_id
    LOOP PERFORM public.broadcast_class_session_invalidation(v_session_id, 'teacher'); END LOOP;
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    v_id := CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD)->>'id')::uuid ELSE (to_jsonb(NEW)->>'id')::uuid END;
    FOR v_session_id IN
      SELECT DISTINCT assignment.class_session_id
      FROM public.teacher_records AS teacher
      JOIN public.class_session_teachers AS assignment ON assignment.teacher_id = teacher.id
      WHERE teacher.profile_id = v_id
    LOOP PERFORM public.broadcast_class_session_invalidation(v_session_id, 'teacher'); END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'class_sessions', 'class_session_schedule_rules', 'class_session_teachers',
    'enrollments', 'class_occurrences', 'occurrence_reports', 'single_lesson_transfers',
    'students', 'student_suspensions', 'courses', 'lessons', 'classrooms', 'holidays',
    'teacher_records', 'profiles'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS class_session_workspace_invalidation ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER class_session_workspace_invalidation AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.notify_class_session_workspace_changed()', table_name);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS "Report editors can receive private room messages" ON realtime.messages;
CREATE POLICY "Authorized users can receive private realtime messages"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    CASE
      WHEN realtime.topic() ~ '^room:[0-9a-fA-F-]{36}$'
        THEN public.can_access_occurrence_report(split_part(realtime.topic(), ':', 2)::uuid)
      WHEN realtime.topic() ~ '^class-session:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN public.can_access_class_session(split_part(realtime.topic(), ':', 2)::uuid, 'teaching.class_sessions.read')
          OR public.can_access_class_session(split_part(realtime.topic(), ':', 2)::uuid, 'teaching.class_sessions.list')
      ELSE false
    END
  );

REVOKE ALL ON FUNCTION public.broadcast_class_session_invalidation(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_class_session_workspace_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_class_session_workspace(uuid, date) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_class_session_workspace(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_class_session_workspace(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_session_workspace(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_class_session_workspace(uuid, date)
  IS 'Safe occurrence-scoped workspace; uses effective transfer roster for generated occurrences and enrollment fallback before occurrence generation.';

NOTIFY pgrst, 'reload schema';
COMMIT;
