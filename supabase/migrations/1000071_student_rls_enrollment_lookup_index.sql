-- Speed up the enrollment lookup used by can_access_student() from the
-- students SELECT policy. Without this FK index, exact student counts scan all
-- enrollments once per student and can exceed the database statement timeout.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000071 prerequisites missing; apply migrations through 1000070 first';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname = 'enrollments_student_id_idx'
      AND (
      NOT index_metadata.indisvalid
      OR index_metadata.indrelid <> to_regclass('public.enrollments')
      OR pg_get_indexdef(index_metadata.indexrelid, 1, true) <> 'student_id'
      )
  ) THEN
    RAISE EXCEPTION '1000071 found an invalid or conflicting enrollments_student_id_idx; remove that index before retrying';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS enrollments_student_id_idx
  ON public.enrollments USING btree (student_id);

COMMENT ON INDEX public.enrollments_student_id_idx
  IS 'Supports can_access_student RLS enrollment lookups and exact student counts.';
