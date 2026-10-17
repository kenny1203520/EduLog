-- Safe current-school summaries for Student Page API read models.
-- Full school history and school_student_id remain behind read_sensitive.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.student_schools') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.class_session_schedule_rules') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_sensitive_student(uuid,text)') IS NULL
     OR to_regprocedure('public.get_students_overview(integer,integer,text,text)') IS NULL THEN
    RAISE EXCEPTION '1000079 prerequisites missing; apply migrations through 1000078 first';
  END IF;
END;
$$;

-- The partial predicate matches the current-school selection below and keeps
-- Page API lookups bounded to active school rows.
CREATE INDEX IF NOT EXISTS student_schools_current_summary_idx
  ON public.student_schools (student_id, start_date DESC, updated_at DESC, id)
  WHERE lower(COALESCE(status, '')) = 'enrolled';

CREATE OR REPLACE FUNCTION public.get_students_overview(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT '',
  p_sort text DEFAULT 'name'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_search text := btrim(COALESCE(p_search, ''));
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_LIMIT';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_OFFSET';
  END IF;
  IF char_length(v_search) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SEARCH';
  END IF;
  IF p_sort IS NULL OR p_sort NOT IN ('name', '-name', 'created_at', '-created_at', 'updated_at', '-updated_at') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SORT';
  END IF;

  WITH enrollment_scopes AS MATERIALIZED (
    SELECT enrollment.student_id,
      COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id) AS teaching_id
    FROM public.enrollments enrollment
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.courses course ON course.id = enrollment.course_id
  ),
  candidate_teachings AS MATERIALIZED (
    SELECT DISTINCT teaching_id FROM enrollment_scopes WHERE teaching_id IS NOT NULL
  ),
  readable_teachings AS MATERIALIZED (
    SELECT candidate.teaching_id
    FROM candidate_teachings candidate
    WHERE public.can_access_teaching(candidate.teaching_id, 'teaching.students.read')
  ),
  visible_student_ids AS MATERIALIZED (
    SELECT student.id FROM public.students student WHERE student.user_id = v_user_id
    UNION
    SELECT enrollment.student_id
    FROM enrollment_scopes enrollment
    JOIN readable_teachings teaching ON teaching.teaching_id = enrollment.teaching_id
  ),
  filtered_students AS MATERIALIZED (
    SELECT student.id, student.name, student.notes, student.notes_document,
      student.external_link, student.created_at, student.updated_at,
      current_school.current_school
    FROM public.students student
    JOIN visible_student_ids visible ON visible.id = student.id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'name', school.name,
        'status', lower(school.status),
        'grade', school.grade,
        'class', school.class
      ) AS current_school
      FROM public.student_schools school
      WHERE school.student_id = student.id
        AND lower(COALESCE(school.status, '')) = 'enrolled'
      ORDER BY school.start_date DESC NULLS LAST, school.updated_at DESC NULLS LAST, school.id
      LIMIT 1
    ) current_school ON TRUE
    WHERE v_search = '' OR strpos(lower(student.name), lower(v_search)) > 0
  ),
  ordered_students AS MATERIALIZED (
    SELECT student.*, row_number() OVER (
      ORDER BY
        CASE WHEN p_sort = 'name' THEN lower(student.name) END ASC NULLS LAST,
        CASE WHEN p_sort = '-name' THEN lower(student.name) END DESC NULLS LAST,
        CASE WHEN p_sort = 'created_at' THEN student.created_at END ASC NULLS LAST,
        CASE WHEN p_sort = '-created_at' THEN student.created_at END DESC NULLS LAST,
        CASE WHEN p_sort = 'updated_at' THEN student.updated_at END ASC NULLS LAST,
        CASE WHEN p_sort = '-updated_at' THEN student.updated_at END DESC NULLS LAST,
        student.id ASC
    ) AS page_ordinal
    FROM filtered_students student
  ),
  page_rows AS MATERIALIZED (
    SELECT * FROM ordered_students ORDER BY page_ordinal LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(page_row) - 'page_ordinal' ORDER BY page_row.page_ordinal)
      FROM page_rows page_row
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered_students)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_student_profile_page(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_student_id IS NULL OR NOT public.can_access_student(p_student_id, 'teaching.students.read') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'STUDENT_ACCESS_DENIED';
  END IF;

  SELECT jsonb_build_object(
    'id', student.id,
    'name', student.name,
    'notes', student.notes,
    'notes_document', student.notes_document,
    'external_link', student.external_link,
    'created_at', student.created_at,
    'updated_at', student.updated_at,
    'current_school', current_school.current_school,
    'enrollments', COALESCE(enrollments.items, '[]'::jsonb),
    'capabilities', jsonb_build_object(
      'read_sensitive', public.can_access_sensitive_student(student.id, 'teaching.students.read_sensitive'),
      'update_sensitive', public.can_access_sensitive_student(student.id, 'teaching.students.update_sensitive')
    )
  ) INTO v_profile
  FROM public.students student
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'name', school.name,
      'status', lower(school.status),
      'grade', school.grade,
      'class', school.class
    ) AS current_school
    FROM public.student_schools school
    WHERE school.student_id = student.id
      AND lower(COALESCE(school.status, '')) = 'enrolled'
    ORDER BY school.start_date DESC NULLS LAST, school.updated_at DESC NULLS LAST, school.id
    LIMIT 1
  ) current_school ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', enrollment.id,
      'student_id', enrollment.student_id,
      'course_id', enrollment.course_id,
      'classroom_id', enrollment.classroom_id,
      'class_session_id', enrollment.class_session_id,
      'status', enrollment.status,
      'start_date', enrollment.start_date,
      'lesson_number', enrollment.lesson_number,
      'external_link', enrollment.external_link,
      'time_zone', enrollment.time_zone,
      'koding_admission_id', enrollment.koding_admission_id,
      'created_at', enrollment.created_at,
      'updated_at', enrollment.updated_at,
      'courses', CASE WHEN course.id IS NULL THEN NULL ELSE jsonb_build_object('subject', course.subject, 'stage', course.stage, 'display_name', course.display_name) END,
      'classrooms', CASE WHEN classroom.id IS NULL THEN NULL ELSE jsonb_build_object('name', classroom.name) END,
      'class_sessions', CASE WHEN session.id IS NULL THEN NULL ELSE jsonb_build_object(
        'name', session.name,
        'day_of_week', session.day_of_week,
        'start_time', session.start_time,
        'end_time', session.end_time,
        'time_zone', session.time_zone,
        'session_type', session.session_type,
        'schedule_mode', session.schedule_mode,
        'class_session_schedule_rules', COALESCE(schedule_rules.items, '[]'::jsonb)
      ) END
    ) ORDER BY enrollment.created_at, enrollment.id) AS items
    FROM public.enrollments enrollment
    LEFT JOIN public.courses course ON course.id = enrollment.course_id
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'id', rule.id,
        'schedule_kind', rule.schedule_kind,
        'day_of_week', rule.day_of_week,
        'day_of_month', rule.day_of_month,
        'occurrence_date', rule.occurrence_date,
        'start_time', rule.start_time,
        'end_time', rule.end_time
      ) ORDER BY rule.occurrence_date NULLS LAST, rule.day_of_week NULLS LAST, rule.day_of_month NULLS LAST, rule.id) AS items
      FROM public.class_session_schedule_rules rule
      WHERE rule.class_session_id = session.id
    ) schedule_rules ON TRUE
    WHERE enrollment.student_id = student.id
  ) enrollments ON TRUE
  WHERE student.id = p_student_id;

  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_student_sensitive_details(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  student_row jsonb;
  contacts jsonb;
  schools jsonb;
BEGIN
  IF NOT public.can_access_sensitive_student(p_student_id, 'teaching.students.read_sensitive') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SENSITIVE_PERMISSION_REQUIRED';
  END IF;

  SELECT jsonb_build_object(
    'id', student.id,
    'gov_id', student.gov_id,
    'email', student.email,
    'phone', student.phone,
    'residence_address', student.residence_address,
    'mailing_address', student.mailing_address,
    'birthday', student.birthday
  ) INTO student_row
  FROM public.students student
  WHERE student.id = p_student_id;
  IF student_row IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', contact.id,
    'name', contact.name,
    'relation', contact.relation,
    'phone', contact.phone,
    'email', contact.email,
    'created_at', contact.created_at,
    'updated_at', contact.updated_at
  ) ORDER BY contact.created_at, contact.id), '[]'::jsonb) INTO contacts
  FROM public.student_contacts contact
  WHERE contact.student_id = p_student_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', school.id,
    'student_id', school.student_id,
    'name', school.name,
    'status', school.status,
    'grade', school.grade,
    'class', school.class,
    'school_student_id', school.school_student_id,
    'start_date', school.start_date,
    'end_date', school.end_date,
    'time_zone', school.time_zone,
    'created_at', school.created_at,
    'updated_at', school.updated_at
  ) ORDER BY school.start_date DESC NULLS LAST, school.updated_at DESC NULLS LAST, school.id), '[]'::jsonb) INTO schools
  FROM public.student_schools school
  WHERE school.student_id = p_student_id;

  RETURN jsonb_build_object('student', student_row, 'contacts', contacts, 'schools', schools);
END;
$$;

REVOKE ALL ON FUNCTION public.get_students_overview(integer, integer, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_student_profile_page(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_student_sensitive_details(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_students_overview(integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_profile_page(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_sensitive_details(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_student_profile_page(uuid)
  IS 'Returns a safe Student Page API profile plus current-school summary; sensitive details remain separately authorized.';

NOTIFY pgrst, 'reload schema';
