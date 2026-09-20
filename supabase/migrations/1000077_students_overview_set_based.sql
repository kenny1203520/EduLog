-- Set-based Student overview page read model.
--
-- Direct PostgREST pagination with count=exact evaluates can_access_student()
-- for every candidate row. This narrowly scoped aggregate reconstructs the
-- same ownership and teaching visibility from the current JWT while resolving
-- each teaching permission only once.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.can_access_teaching(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000077 prerequisites missing; apply migrations through 1000076 first';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS enrollments_student_id_idx
  ON public.enrollments USING btree (student_id);

CREATE INDEX IF NOT EXISTS students_user_id_idx
  ON public.students USING btree (user_id);

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
  IF p_sort IS NULL OR p_sort NOT IN (
    'name', '-name',
    'created_at', '-created_at',
    'updated_at', '-updated_at'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SORT';
  END IF;

  WITH enrollment_scopes AS MATERIALIZED (
    SELECT
      enrollment.student_id,
      COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id) AS teaching_id
    FROM public.enrollments enrollment
    LEFT JOIN public.class_sessions session
      ON session.id = enrollment.class_session_id
    LEFT JOIN public.classrooms classroom
      ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.courses course
      ON course.id = enrollment.course_id
  ),
  candidate_teachings AS MATERIALIZED (
    SELECT DISTINCT enrollment.teaching_id
    FROM enrollment_scopes enrollment
    WHERE enrollment.teaching_id IS NOT NULL
  ),
  readable_teachings AS MATERIALIZED (
    SELECT candidate.teaching_id
    FROM candidate_teachings candidate
    WHERE public.can_access_teaching(
      candidate.teaching_id,
      'teaching.students.read'
    )
  ),
  visible_student_ids AS MATERIALIZED (
    SELECT student.id
    FROM public.students student
    WHERE student.user_id = v_user_id
    UNION
    SELECT enrollment.student_id
    FROM enrollment_scopes enrollment
    JOIN readable_teachings teaching
      ON teaching.teaching_id = enrollment.teaching_id
  ),
  filtered_students AS MATERIALIZED (
    SELECT
      student.id,
      student.name,
      student.notes,
      student.notes_document,
      student.external_link,
      student.created_at,
      student.updated_at
    FROM public.students student
    JOIN visible_student_ids visible ON visible.id = student.id
    WHERE v_search = ''
       OR strpos(lower(student.name), lower(v_search)) > 0
  ),
  ordered_students AS MATERIALIZED (
    SELECT
      student.*,
      row_number() OVER (
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
    SELECT *
    FROM ordered_students
    ORDER BY page_ordinal
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(page_row) - 'page_ordinal' ORDER BY page_row.page_ordinal)
        FROM page_rows page_row
      ),
      '[]'::jsonb
    ),
    'total', (SELECT count(*) FROM filtered_students)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_students_overview(integer, integer, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_students_overview(integer, integer, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.get_students_overview(integer, integer, text, text)
  IS 'Returns a paginated safe Student overview using caller ownership and canonical teaching permissions.';

NOTIFY pgrst, 'reload schema';
