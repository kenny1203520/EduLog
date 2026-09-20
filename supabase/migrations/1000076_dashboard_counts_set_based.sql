-- Set-based, exact Dashboard counts.
--
-- 1000075 executes as the caller, which preserves RLS but makes PostgreSQL
-- evaluate the student policy's recursive scope check for every row. This
-- narrowly scoped function intentionally bypasses table RLS only to return
-- two aggregate values. It reconstructs the same visible scope from the
-- caller's JWT and canonical permission helpers without accepting a user id.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.get_dashboard_counts()') IS NULL
     OR to_regprocedure('public.can_access_teaching(uuid,text)') IS NULL
     OR to_regprocedure('public.can_teaching_action(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION '1000076 prerequisites missing; apply migrations through 1000075 first';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS enrollments_student_id_idx
  ON public.enrollments USING btree (student_id);

CREATE INDEX IF NOT EXISTS students_user_id_idx
  ON public.students USING btree (user_id);

CREATE INDEX IF NOT EXISTS courses_teaching_idx
  ON public.courses USING btree (teaching_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('enrollments_student_id_idx'::text, 'public.enrollments'::regclass, 'student_id'::text),
      ('students_user_id_idx'::text, 'public.students'::regclass, 'user_id'::text),
      ('courses_teaching_idx'::text, 'public.courses'::regclass, 'teaching_id'::text)
    ) expected(index_name, table_oid, column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class index_relation
      JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
      JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
      WHERE index_schema.nspname = 'public'
        AND index_relation.relname = expected.index_name
        AND index_metadata.indrelid = expected.table_oid
        AND index_metadata.indisvalid
        AND index_metadata.indisready
        AND index_metadata.indnkeyatts = 1
        AND pg_get_indexdef(index_metadata.indexrelid, 1, true) = expected.column_name
    )
  ) THEN
    RAISE EXCEPTION '1000076 required Dashboard count index is missing or conflicting';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;

  RETURN (
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
      SELECT teaching_id
      FROM enrollment_scopes
      WHERE teaching_id IS NOT NULL
      UNION
      SELECT course.teaching_id
      FROM public.courses course
      WHERE course.teaching_id IS NOT NULL
    ),
    student_teachings AS MATERIALIZED (
      SELECT candidate.teaching_id
      FROM candidate_teachings candidate
      WHERE public.can_access_teaching(candidate.teaching_id, 'teaching.students.read')
    ),
    course_teachings AS MATERIALIZED (
      SELECT candidate.teaching_id
      FROM candidate_teachings candidate
      WHERE public.can_teaching_action(candidate.teaching_id, 'courses', 'read')
         OR public.can_teaching_action(candidate.teaching_id, 'courses', 'list')
    ),
    visible_student_ids AS MATERIALIZED (
      SELECT student.id
      FROM public.students student
      WHERE student.user_id = v_user_id
      UNION
      SELECT enrollment.student_id
      FROM enrollment_scopes enrollment
      JOIN student_teachings teaching
        ON teaching.teaching_id = enrollment.teaching_id
    )
    SELECT jsonb_build_object(
      'totalStudents', (SELECT count(*) FROM visible_student_ids),
      'activeCourses', (
        SELECT count(course.id)
        FROM public.courses course
        JOIN course_teachings teaching
          ON teaching.teaching_id = course.teaching_id
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_counts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_counts() TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_counts()
  IS 'Exact Dashboard counts reconstructed from the caller JWT and canonical teaching permissions.';

NOTIFY pgrst, 'reload schema';
