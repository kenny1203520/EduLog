\set ON_ERROR_STOP on

DO $$
DECLARE forbidden_count integer;
BEGIN
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
     OR to_regclass('public.rbac_policy_epoch') IS NULL THEN
    RAISE EXCEPTION 'API RBAC forward migration did not create required objects';
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

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
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

  SELECT count(*) INTO forbidden_count
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
    AND (COALESCE(qual, '') || COALESCE(with_check, '')) !~ '\([[:space:]]*select[[:space:]]+auth\.uid\(\)[[:space:]]*\)';
  IF forbidden_count <> 0 THEN
    RAISE EXCEPTION 'RLS initplan rewrites are incomplete: %', forbidden_count;
  END IF;
END;
$$;