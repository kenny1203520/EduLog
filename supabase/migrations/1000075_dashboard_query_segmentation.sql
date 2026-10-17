-- Dashboard query segmentation.
--
-- 1000074 keeps the complete page read model for short-term compatibility,
-- but a large invoker statement can make independent RLS scans share one
-- statement timeout.  This migration adds a small, exact-count invoker RPC;
-- the API combines it with the existing report and occurrence reads.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regprocedure('public.get_dashboard_page(date,date)') IS NULL THEN
    RAISE EXCEPTION '1000075 prerequisites missing; apply migrations through 1000074 first';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname IN ('enrollments_student_id_idx', 'students_user_id_idx')
      AND (
        NOT index_metadata.indisvalid
        OR NOT index_metadata.indisready
      )
  ) THEN
    RAISE EXCEPTION '1000075 required Dashboard scope index is invalid or not ready';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('enrollments_student_id_idx'::text, 'public.enrollments'::regclass, 'student_id'::text),
      ('students_user_id_idx'::text, 'public.students'::regclass, 'user_id'::text)
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
    RAISE EXCEPTION '1000075 required Dashboard scope index definition is missing or conflicting';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'totalStudents', (SELECT count(student.id) FROM public.students student),
    'activeCourses', (SELECT count(course.id) FROM public.courses course)
  );
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_counts() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_dashboard_counts()
  IS 'Exact RLS-scoped Dashboard counts; the API combines this with independent page reads.';

COMMENT ON FUNCTION public.get_dashboard_page(date, date)
  IS 'Deprecated compatibility read model; use segmented Dashboard page reads through the API.';

NOTIFY pgrst, 'reload schema';
