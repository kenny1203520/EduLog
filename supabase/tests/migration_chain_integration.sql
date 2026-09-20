\set ON_ERROR_STOP on

DO $$
DECLARE forbidden_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_relation.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname = 'enrollments_student_id_idx'
      AND table_schema.nspname = 'public'
      AND table_relation.relname = 'enrollments'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'student_id'
  ) THEN
    RAISE EXCEPTION 'student RLS enrollment lookup index is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_relation.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname = 'students_user_id_idx'
      AND table_schema.nspname = 'public'
      AND table_relation.relname = 'students'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'user_id'
  ) THEN
    RAISE EXCEPTION 'student owner lookup index is missing or invalid';
  END IF;

  SELECT count(*) INTO forbidden_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname = 'Enable all access for authenticated users'
    AND tablename IN ('students','student_contacts','student_schools','student_credentials','teachers','courses','lessons','classrooms','classroom_schedules','class_sessions','class_session_teachers','holidays','enrollments','class_occurrences','occurrence_reports','report_templates','student_suspensions');
  IF forbidden_count <> 0 THEN
    RAISE EXCEPTION 'authenticated-wide core policies remain: %', forbidden_count;
  END IF;
  SELECT count(*) INTO forbidden_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd = 'ALL'
    AND tablename IN ('teachings','teaching_members','lessons','class_session_teachers','enrollments','class_occurrences','occurrence_reports','report_templates','student_credentials');
  IF forbidden_count <> 0 THEN
    RAISE EXCEPTION 'action-specific core RLS policies are incomplete: %', forbidden_count;
  END IF;
  IF to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL
     OR to_regclass('public.rbac_policy_epoch') IS NULL
     OR to_regprocedure('public.get_dashboard_page(date,date)') IS NULL
     OR to_regprocedure('public.get_dashboard_counts()') IS NULL
     OR NOT has_function_privilege('authenticated', 'public.get_dashboard_page(date,date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_dashboard_counts()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_students_overview(integer,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_dashboard_page(date,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_dashboard_counts()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_students_overview(integer,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_dashboard_counts()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_students_overview(integer,integer,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'API RBAC forward migration did not create required objects';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.class_session_teachers', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.class_occurrences', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.occurrence_reports', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.enrollments', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.class_sessions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.classrooms', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.courses', 'SELECT') THEN
    RAISE EXCEPTION 'dashboard read model dependencies lack authenticated SELECT grants';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = to_regprocedure('public.get_dashboard_page(date,date)')
      AND prosecdef
  ) THEN
    RAISE EXCEPTION 'dashboard read model must execute as the caller';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    WHERE procedure.oid = to_regprocedure('public.get_dashboard_counts()')
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'dashboard count RPC must use its controlled aggregate security boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
    WHERE procedure.oid = to_regprocedure('public.get_dashboard_counts()')
      AND owner_role.rolname IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'dashboard count RPC has an unsafe owner';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    WHERE procedure.oid = to_regprocedure('public.get_students_overview(integer,integer,text,text)')
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'Student overview RPC must use its controlled read-model security boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
    WHERE procedure.oid = to_regprocedure('public.get_students_overview(integer,integer,text,text)')
      AND owner_role.rolname IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'Student overview RPC has an unsafe owner';
  END IF;
END;
$$;

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner-a@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'owner-b@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.teachings(id, name, owner_user_id) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Teaching A', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'Teaching B', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.teaching_members(teaching_id, user_id, role_id)
SELECT teaching.id, teaching.owner_user_id, role.id
FROM public.teachings teaching
JOIN public.roles role ON role.code = 'teaching_owner'
WHERE teaching.id IN ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')
ON CONFLICT (teaching_id, user_id) DO NOTHING;

INSERT INTO public.classrooms(id, name, user_id, teaching_id) VALUES
  ('30000000-0000-0000-0000-000000000001', 'A classroom', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', 'B classroom', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.classrooms) <> 1 THEN
    RAISE EXCEPTION 'cross-teaching RLS isolation failed';
  END IF;
END;
$$;
RESET ROLE;

GRANT EXECUTE ON FUNCTION public.get_dashboard_page(date, date) TO authenticated;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
DO $$
DECLARE page jsonb;
BEGIN
  page := public.get_dashboard_page(current_date, current_date);
  IF jsonb_typeof(page) <> 'object'
     OR page->'stats' IS NULL
     OR jsonb_typeof(page->'pendingReports') <> 'array'
     OR jsonb_typeof(page->'occurrences') <> 'array' THEN
    RAISE EXCEPTION 'dashboard page read model returned an invalid response shape';
  END IF;
  IF jsonb_typeof(public.get_dashboard_counts()) <> 'object'
     OR (public.get_dashboard_counts() ? 'totalStudents') IS FALSE
     OR (public.get_dashboard_counts() ? 'activeCourses') IS FALSE THEN
    RAISE EXCEPTION 'dashboard segmented counts returned an invalid response shape';
  END IF;
END;
$$;
RESET ROLE;

DO $$
DECLARE before_epoch bigint;
DECLARE after_epoch bigint;
DECLARE alpha uuid := gen_random_uuid();
DECLARE beta uuid := gen_random_uuid();
BEGIN
  SELECT epoch INTO before_epoch FROM public.rbac_policy_epoch WHERE singleton;
  INSERT INTO public.roles(id, code, name, is_system) VALUES
    (alpha, 'integration_alpha_' || left(alpha::text, 8), 'Integration alpha', false),
    (beta, 'integration_beta_' || left(beta::text, 8), 'Integration beta', false);
  INSERT INTO public.role_inheritance(role_id, parent_role_id) VALUES (alpha, beta);
  BEGIN
    INSERT INTO public.role_inheritance(role_id, parent_role_id) VALUES (beta, alpha);
    RAISE EXCEPTION 'role cycle was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'RBAC_ROLE_INHERITANCE_CYCLE' THEN RAISE; END IF;
  END;
  SELECT epoch INTO after_epoch FROM public.rbac_policy_epoch WHERE singleton;
  IF after_epoch <= before_epoch THEN
    RAISE EXCEPTION 'RBAC policy epoch did not advance';
  END IF;
END;
$$;

DO $$
DECLARE
  function_definition text;
  forbidden_count integer;
  missing_policy_names text;
  policy_count integer;
  policy_command text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)'))
  INTO function_definition;
  IF function_definition LIKE '%SELECT false%' THEN
    RAISE EXCEPTION 'has_api_permission compatibility shim was not replaced by 1000044';
  END IF;

  SELECT count(*) INTO forbidden_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'occurrence_reports'
    AND policyname IN (
      'Report editor read is scoped',
      'Report editor insert is scoped',
      'Report editor update is scoped',
      'Report editor delete is scoped',
      'Teaching reports read',
      'Teaching reports create',
      'Teaching reports update',
      'Teaching reports delete'
    );
  IF forbidden_count <> 0 THEN
    RAISE EXCEPTION 'legacy occurrence report policies remain: %', forbidden_count;
  END IF;

  FOREACH policy_command IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    SELECT count(*) INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'occurrence_reports'
      AND cmd = policy_command
      AND permissive = 'PERMISSIVE'
      AND roles @> ARRAY['authenticated'::name];
    IF policy_count <> 1 THEN
      RAISE EXCEPTION 'expected one authenticated permissive occurrence report % policy, found %', policy_command, policy_count;
    END IF;
  END LOOP;

  SELECT count(*), string_agg(policyname, ', ' ORDER BY policyname)
  INTO forbidden_count, missing_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN (
      'Teaching owners create teachings',
      'Teaching owners update teachings',
      'Teaching owners delete teachings',
      'Users read own audit events',
      'Teaching templates read',
      'Teaching templates create',
      'Teaching templates update',
      'Teaching templates delete',
      'Teaching credentials read',
      'Teaching credentials create',
      'Teaching credentials update',
      'Teaching credentials delete',
      'Canonical teachers read',
      'Canonical teachers create',
      'Canonical teachers update',
      'Canonical teachers delete'
    )
    AND (COALESCE(qual, '') || COALESCE(with_check, '')) !~* 'SELECT[[:space:]]+auth\.uid\(\)';
  IF forbidden_count <> 0 THEN
    RAISE EXCEPTION 'RLS initplan rewrites are incomplete: % [%]', forbidden_count, missing_policy_names;
  END IF;
END;
$$;
