-- Include standalone global students in the Student overview while keeping
-- classroom/session-scoped access limited to students with readable enrollments.
DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_students_overview(integer,integer,text,text)') IS NULL THEN
    RAISE EXCEPTION '1000102 prerequisites missing; apply migrations through 1000101 first';
  END IF;
END;
$$;

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
      COALESCE(classroom.id, session.classroom_id) AS classroom_id,
      session.id AS class_session_id
    FROM public.enrollments enrollment
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
  ),
  global_student_access AS MATERIALIZED (
    SELECT public.has_api_permission(v_user_id, 'teaching.students.read', NULL, NULL) AS can_read_all
  ),
  visible_student_ids AS MATERIALIZED (
    -- Compatibility for any legacy rows not yet cleared by the scope migration.
    SELECT student.id FROM public.students student WHERE student.user_id = v_user_id
    UNION
    -- Students are system-level records. A platform-level read grant includes
    -- students who have not been enrolled in a classroom or class session yet.
    SELECT student.id
    FROM public.students student
    CROSS JOIN global_student_access access
    WHERE access.can_read_all
    UNION
    -- Local teaching roles only see students through an authorized enrollment
    -- path. The permission resolver preserves classroom/session deny precedence.
    SELECT enrollment.student_id
    FROM enrollment_scopes enrollment
    WHERE public.has_api_permission(
      v_user_id,
      'teaching.students.read',
      enrollment.classroom_id,
      enrollment.class_session_id
    )
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

REVOKE ALL ON FUNCTION public.get_students_overview(integer,integer,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_students_overview(integer,integer,text,text) TO authenticated;
COMMENT ON FUNCTION public.get_students_overview(integer,integer,text,text)
  IS 'Returns paginated students readable through platform, classroom, or class-session teaching permissions.';

NOTIFY pgrst, 'reload schema';
