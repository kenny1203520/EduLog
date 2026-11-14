-- Avoid same-statement reads through the scoped SELECT policies during creation.
CREATE OR REPLACE FUNCTION public.save_class_session_with_schedule(
  p_session jsonb,
  p_rules jsonb,
  p_session_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session_id uuid;
  v_classroom_id uuid := NULLIF(p_session->>'classroom_id', '')::uuid;
  v_course_ids uuid[] := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(p_session->'course_ids', '[]'::jsonb))
  )::uuid[];
  v_classroom_teaching_id uuid;
  v_course_teaching_id uuid;
  v_existing_teaching_id uuid;
  v_course_count integer;
  v_course_teaching_count integer;
  v_session_type text := COALESCE(NULLIF(p_session->>'session_type', ''), 'regular');
  v_schedule_mode text := COALESCE(NULLIF(p_session->>'schedule_mode', ''), 'weekly');
  v_start_date date := NULLIF(p_session->>'start_date', '')::date;
  v_end_date date := NULLIF(p_session->>'end_date', '')::date;
  v_teaching_id uuid;
  v_first_rule record;
  v_permission_key text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF jsonb_typeof(COALESCE(p_rules, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Schedule rules must be a JSON array';
  END IF;
  IF v_session_type NOT IN ('regular', 'camp')
     OR v_schedule_mode NOT IN ('weekly', 'monthly', 'specific_dates')
     OR (v_session_type = 'camp' AND v_schedule_mode <> 'specific_dates')
     OR (v_session_type = 'regular' AND v_schedule_mode = 'specific_dates') THEN
    RAISE EXCEPTION 'Invalid session type and schedule mode combination';
  END IF;
  IF v_session_type = 'regular' AND v_start_date IS NULL THEN
    RAISE EXCEPTION 'Regular sessions require a start date';
  END IF;
  IF v_session_type = 'regular' AND jsonb_array_length(COALESCE(p_rules, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Regular sessions require at least one schedule rule';
  END IF;
  IF v_start_date IS NOT NULL AND v_end_date IS NOT NULL AND v_start_date > v_end_date THEN
    RAISE EXCEPTION 'Start date must not be after end date';
  END IF;

  IF v_classroom_id IS NOT NULL THEN
    SELECT classroom.teaching_id INTO v_classroom_teaching_id
    FROM public.classrooms classroom
    WHERE classroom.id = v_classroom_id;
    IF v_classroom_teaching_id IS NULL THEN
      RAISE EXCEPTION 'Classroom scope is invalid';
    END IF;
  END IF;

  SELECT count(*), count(DISTINCT course.teaching_id),
         (array_agg(course.teaching_id ORDER BY course.teaching_id))[1]
    INTO v_course_count, v_course_teaching_count, v_course_teaching_id
  FROM public.courses course
  WHERE course.id = ANY(v_course_ids);
  IF v_course_count <> COALESCE(cardinality(v_course_ids), 0)
     OR v_course_teaching_count > 1 THEN
    RAISE EXCEPTION 'Course references must belong to one teaching';
  END IF;
  IF v_classroom_teaching_id IS NOT NULL
     AND v_course_teaching_id IS NOT NULL
     AND v_classroom_teaching_id <> v_course_teaching_id THEN
    RAISE EXCEPTION 'Classroom and course references must belong to one teaching';
  END IF;
  v_teaching_id := COALESCE(v_classroom_teaching_id, v_course_teaching_id);
  IF v_teaching_id IS NULL THEN
    RAISE EXCEPTION 'A classroom or course teaching scope is required';
  END IF;

  v_permission_key := CASE WHEN p_session_id IS NULL
    THEN 'teaching.class_sessions.create'
    ELSE 'teaching.class_sessions.update' END;
  IF NOT public.has_teaching_permission(
    auth.uid(), v_permission_key, v_teaching_id, v_classroom_id, p_session_id
  ) THEN
    RAISE EXCEPTION 'Class session permission denied';
  END IF;

  IF p_session_id IS NULL THEN
    v_session_id := gen_random_uuid();
    SELECT * INTO v_first_rule
    FROM jsonb_to_recordset(COALESCE(p_rules, '[]'::jsonb)) AS rule(
      schedule_kind text, day_of_week integer, day_of_month integer,
      occurrence_date date, start_time time, end_time time
    )
    ORDER BY COALESCE(day_of_week, day_of_month, EXTRACT(DOY FROM occurrence_date)::integer), start_time
    LIMIT 1;

    INSERT INTO public.class_sessions (
      id, name, classroom_id, course_ids, capacity, lesson_number,
      external_link, start_date, end_date, time_zone,
      session_type, schedule_mode, teaching_id, user_id, day_of_week, start_time, end_time
    ) VALUES (
      v_session_id, p_session->>'name', v_classroom_id, v_course_ids,
      COALESCE(NULLIF(p_session->>'capacity', '')::integer, 10),
      NULLIF(p_session->>'lesson_number', '')::integer,
      NULLIF(p_session->>'external_link', ''), v_start_date, v_end_date,
      COALESCE(NULLIF(p_session->>'time_zone', ''), 'Asia/Taipei'),
      v_session_type, v_schedule_mode, v_teaching_id, auth.uid(),
      CASE WHEN v_first_rule.schedule_kind = 'weekly' THEN v_first_rule.day_of_week
           WHEN v_first_rule.schedule_kind = 'specific_dates' THEN EXTRACT(DOW FROM v_first_rule.occurrence_date)::integer END,
      v_first_rule.start_time, v_first_rule.end_time
    );
  ELSE
    SELECT session.teaching_id INTO v_existing_teaching_id
    FROM public.class_sessions session
    WHERE session.id = p_session_id;
    IF v_existing_teaching_id IS NULL THEN
      RAISE EXCEPTION 'Class session not found';
    END IF;
    IF v_existing_teaching_id <> v_teaching_id THEN
      RAISE EXCEPTION 'Class session teaching scope cannot change';
    END IF;
    UPDATE public.class_sessions SET
      name = p_session->>'name', classroom_id = v_classroom_id,
      course_ids = v_course_ids,
      capacity = COALESCE(NULLIF(p_session->>'capacity', '')::integer, 10),
      lesson_number = NULLIF(p_session->>'lesson_number', '')::integer,
      external_link = NULLIF(p_session->>'external_link', ''),
      start_date = v_start_date, end_date = v_end_date,
      time_zone = COALESCE(NULLIF(p_session->>'time_zone', ''), 'Asia/Taipei'),
      session_type = v_session_type, schedule_mode = v_schedule_mode,
      teaching_id = v_teaching_id
    WHERE id = p_session_id
    RETURNING id INTO v_session_id;
  END IF;

  IF p_session_id IS NOT NULL THEN
    DELETE FROM public.class_session_schedule_rules WHERE class_session_id = v_session_id;
  END IF;
  INSERT INTO public.class_session_schedule_rules (
    class_session_id, schedule_kind, day_of_week, day_of_month,
    occurrence_date, start_time, end_time
  )
  SELECT v_session_id, rule.schedule_kind, rule.day_of_week,
         rule.day_of_month, rule.occurrence_date, rule.start_time, rule.end_time
  FROM jsonb_to_recordset(COALESCE(p_rules, '[]'::jsonb)) AS rule(
    schedule_kind text, day_of_week integer, day_of_month integer,
    occurrence_date date, start_time time, end_time time
  );

  IF EXISTS (
    SELECT 1 FROM public.class_session_schedule_rules
    WHERE class_session_id = v_session_id AND schedule_kind <> v_schedule_mode
  ) THEN
    RAISE EXCEPTION 'Schedule rule kind must match session schedule mode';
  END IF;
  IF v_session_type = 'camp' AND v_start_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.class_session_schedule_rules
    WHERE class_session_id = v_session_id AND occurrence_date < v_start_date
  ) THEN
    RAISE EXCEPTION 'Camp schedule date is before the start date';
  END IF;
  IF v_session_type = 'camp' AND v_end_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.class_session_schedule_rules
    WHERE class_session_id = v_session_id AND occurrence_date > v_end_date
  ) THEN
    RAISE EXCEPTION 'Camp schedule date is after the end date';
  END IF;
  SELECT * INTO v_first_rule
  FROM public.class_session_schedule_rules
  WHERE class_session_id = v_session_id
  ORDER BY COALESCE(day_of_week, day_of_month, EXTRACT(DOY FROM occurrence_date)::integer), start_time
  LIMIT 1;
  IF p_session_id IS NOT NULL AND v_first_rule IS NOT NULL THEN
    UPDATE public.class_sessions SET
      day_of_week = CASE
        WHEN v_first_rule.schedule_kind = 'weekly' THEN v_first_rule.day_of_week
        WHEN v_first_rule.schedule_kind = 'specific_dates' THEN EXTRACT(DOW FROM v_first_rule.occurrence_date)::integer
        ELSE NULL END,
      start_time = v_first_rule.start_time,
      end_time = v_first_rule.end_time
    WHERE id = v_session_id;
  END IF;
  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_class_session_with_schedule(jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_class_session_with_schedule(jsonb, jsonb, uuid) TO authenticated;

-- Read the new room in a subsequent statement under the caller's SELECT policy.
CREATE FUNCTION public.create_classroom_with_details(p_room jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_room jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_api_permission(auth.uid(), 'teaching.classrooms.create') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;
  INSERT INTO public.classrooms(id, name, color, address, phone, external_link)
  VALUES (v_id, p_room->>'name', CASE WHEN p_room ? 'color' THEN p_room->>'color' ELSE '#10b981' END, p_room->>'address', p_room->>'phone', p_room->>'external_link');
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'color', color, 'address', address, 'phone', phone,
    'external_link', external_link, 'teaching_id', teaching_id, 'is_virtual', is_virtual,
    'created_at', created_at, 'updated_at', updated_at, 'classroom_schedules', '[]'::jsonb
  ) INTO v_room FROM public.classrooms WHERE id = v_id;
  IF v_room IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;
  RETURN v_room;
END;
$$;
REVOKE ALL ON FUNCTION public.create_classroom_with_details(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_classroom_with_details(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
