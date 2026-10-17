\set ON_ERROR_STOP on

-- Catalog-level regression for 1000072. This intentionally does not select
-- personal data; it only verifies the privilege and function boundary.
DO $$
DECLARE
  permission_count integer;
BEGIN
  SELECT count(*) INTO permission_count
  FROM public.permissions
  WHERE key IN (
    'teaching.students.read_sensitive',
    'teaching.students.update_sensitive',
    'teaching.teachers.read_sensitive',
    'teaching.teachers.update_sensitive'
  );
  IF permission_count <> 4 THEN
    RAISE EXCEPTION 'sensitive permission catalogue is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.role_permission_policies policy
    JOIN public.permissions permission ON permission.id = policy.permission_id
    JOIN public.roles role ON role.id = policy.role_id
    WHERE permission.key IN (
      'teaching.students.read_sensitive',
      'teaching.students.update_sensitive',
      'teaching.teachers.read_sensitive',
      'teaching.teachers.update_sensitive'
    )
      AND policy.effect = 'allow'
      AND role.code <> 'teaching_owner'
  ) THEN
    RAISE EXCEPTION 'sensitive permissions were implicitly granted to a non-owner role';
  END IF;

  IF to_regprocedure('public.get_student_sensitive_details(uuid)') IS NULL
     OR to_regprocedure('public.can_access_sensitive_student(uuid,text)') IS NULL
     OR to_regprocedure('public.get_teacher_sensitive_details(uuid)') IS NULL
     OR to_regprocedure('public.update_student_sensitive(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.update_teacher_sensitive(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'sensitive data RPC boundary is incomplete';
  END IF;

  IF has_column_privilege('authenticated', 'public.students', 'email', 'SELECT')
     OR has_column_privilege('authenticated', 'public.students', 'gov_id', 'SELECT')
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'teachers'
         AND column_name IN ('email', 'gov_id')
     ) THEN
    RAISE EXCEPTION 'authenticated role can directly select core sensitive columns';
  END IF;

  IF has_column_privilege('authenticated', 'public.students', 'email', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.students', 'gov_id', 'UPDATE')
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'teachers'
         AND column_name IN ('email', 'gov_id')
     ) THEN
    RAISE EXCEPTION 'authenticated role can directly update core sensitive columns';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'student_credentials'
      AND policyname = 'Canonical student credentials read'
  ) THEN
    RAISE EXCEPTION 'student credential sensitive read policy is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'teacher_credentials'
      AND policyname = 'teacher_credentials_permission_read'
  ) THEN
    RAISE EXCEPTION 'teacher credential sensitive read policy is missing';
  END IF;
END;
$$;
