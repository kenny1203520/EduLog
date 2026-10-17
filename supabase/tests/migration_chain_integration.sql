\set ON_ERROR_STOP on

-- 1000106 removes the overlapping SELECT access from the former FOR ALL
-- policy. Keep exactly one permissive authenticated policy per operation.
DO $$
DECLARE
  action_name text;
  policy_count integer;
BEGIN
  FOREACH action_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    SELECT count(*) INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_permission_policies'
      AND cmd = action_name
      AND permissive = 'PERMISSIVE'
      AND roles @> ARRAY['authenticated'::name];
    IF policy_count <> 1 THEN
      RAISE EXCEPTION 'expected one authenticated % policy on role_permission_policies, found %',
        action_name, policy_count;
    END IF;
  END LOOP;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'role_permission_policies'
    AND cmd = 'ALL'
    AND permissive = 'PERMISSIVE'
    AND roles @> ARRAY['authenticated'::name];
  IF policy_count <> 0 THEN
    RAISE EXCEPTION 'broad authenticated policy remains on role_permission_policies';
  END IF;
END;
$$;

DO $$
DECLARE
  workspace_definition text;
  invalidation_policy text;
  trigger_count integer;
BEGIN
  workspace_definition := pg_get_functiondef('public.get_class_session_workspace(uuid,date)'::regprocedure);
  IF workspace_definition NOT LIKE '%get_effective_occurrence_enrollment_ids%'
     OR workspace_definition NOT LIKE '%v_occurrence_id IS NULL%'
     OR workspace_definition LIKE '%makeup_ids%' THEN
    RAISE EXCEPTION 'class session workspace does not use the unified effective occurrence roster';
  END IF;

  SELECT qual INTO invalidation_policy
  FROM pg_policies
  WHERE schemaname = 'realtime' AND tablename = 'messages'
     AND policyname = 'Authorized users can receive private realtime messages';
  IF invalidation_policy IS NULL
     OR invalidation_policy NOT LIKE '%can_access_class_session%'
     OR invalidation_policy NOT LIKE '%class-session:%' THEN
    RAISE EXCEPTION 'private class-session invalidation channel does not enforce class-session read permission';
  END IF;

  SELECT count(*) INTO trigger_count
  FROM pg_trigger
  WHERE NOT tgisinternal AND tgname = 'class_session_workspace_invalidation'
    AND tgrelid IN (
      'public.class_sessions'::regclass, 'public.class_session_schedule_rules'::regclass,
      'public.class_session_teachers'::regclass, 'public.enrollments'::regclass,
      'public.class_occurrences'::regclass, 'public.occurrence_reports'::regclass,
      'public.single_lesson_transfers'::regclass, 'public.students'::regclass,
      'public.student_suspensions'::regclass, 'public.courses'::regclass,
      'public.lessons'::regclass, 'public.classrooms'::regclass, 'public.holidays'::regclass,
      'public.teacher_records'::regclass, 'public.profiles'::regclass
    );
  IF trigger_count <> 15 THEN
    RAISE EXCEPTION 'expected invalidation triggers on 15 class-session source tables, found %', trigger_count;
  END IF;
END;
$$;

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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_relation.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname = 'audit_events_created_at_idx'
      AND table_schema.nspname = 'public'
      AND table_relation.relname = 'audit_events'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'created_at'
  ) THEN
    RAISE EXCEPTION 'audit event timestamp lookup index is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_relation.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname = 'occurrence_reports_created_at_idx'
      AND table_schema.nspname = 'public'
      AND table_relation.relname = 'occurrence_reports'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'created_at'
  ) THEN
    RAISE EXCEPTION 'occurrence report creation timestamp index is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_relation.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname = 'lessons_course_id_idx'
      AND table_schema.nspname = 'public'
      AND table_relation.relname = 'lessons'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'course_id'
  ) THEN
    RAISE EXCEPTION 'lesson course lookup index is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_relation.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname = 'lessons_sequence_idx'
      AND table_schema.nspname = 'public'
      AND table_relation.relname = 'lessons'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'sequence'
  ) THEN
    RAISE EXCEPTION 'lesson sequence index is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_relation.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname = 'lessons_course_id_sequence_idx'
      AND table_schema.nspname = 'public'
      AND table_relation.relname = 'lessons'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'course_id'
      AND pg_get_indexdef(index_metadata.indexrelid, 2, true) = 'sequence'
      AND pg_get_indexdef(index_metadata.indexrelid, 3, true) = 'id'
  ) THEN
    RAISE EXCEPTION 'existing lesson course/sequence index is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_relation.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname = 'students_birthday_idx'
      AND table_schema.nspname = 'public'
      AND table_relation.relname = 'students'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'birthday'
  ) THEN
    RAISE EXCEPTION 'student birthday index is missing or invalid';
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
     OR to_regprocedure('public.get_courses_overview(integer,integer,text,text)') IS NULL
     OR to_regprocedure('public.get_teachers_overview(integer,integer,text,text)') IS NULL
     OR to_regprocedure('public.get_classrooms_overview(integer,integer,text,text,integer,integer,uuid)') IS NULL
     OR to_regprocedure('public.get_incomplete_reports_page(integer,text,integer,integer,text,text)') IS NULL
     OR to_regprocedure('public.get_holidays_overview(integer,integer,text,text,boolean)') IS NULL
     OR to_regprocedure('public.get_class_session_workspace(uuid)') IS NULL
     OR to_regprocedure('public.get_student_profile_page(uuid)') IS NULL
     OR NOT has_function_privilege('authenticated', 'public.get_dashboard_page(date,date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_dashboard_counts()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_students_overview(integer,integer,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_courses_overview(integer,integer,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_teachers_overview(integer,integer,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_classrooms_overview(integer,integer,text,text,integer,integer,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_incomplete_reports_page(integer,text,integer,integer,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_holidays_overview(integer,integer,text,text,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_class_session_workspace(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_student_profile_page(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_dashboard_page(date,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_dashboard_counts()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_students_overview(integer,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_courses_overview(integer,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_teachers_overview(integer,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_classrooms_overview(integer,integer,text,text,integer,integer,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_incomplete_reports_page(integer,text,integer,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_holidays_overview(integer,integer,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_class_session_workspace(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_student_profile_page(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_dashboard_counts()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_students_overview(integer,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_courses_overview(integer,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_teachers_overview(integer,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_classrooms_overview(integer,integer,text,text,integer,integer,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_incomplete_reports_page(integer,text,integer,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_holidays_overview(integer,integer,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_class_session_workspace(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_student_profile_page(uuid)', 'EXECUTE') THEN
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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    WHERE procedure.oid = to_regprocedure('public.get_student_profile_page(uuid)')
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'Student profile RPC must use its controlled read-model security boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
    WHERE procedure.oid = to_regprocedure('public.get_student_profile_page(uuid)')
      AND owner_role.rolname IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'Student profile RPC has an unsafe owner';
  END IF;

  IF (
    SELECT count(*) FROM pg_proc procedure
    WHERE procedure.oid IN (
      to_regprocedure('public.get_courses_overview(integer,integer,text,text)'),
      to_regprocedure('public.get_teachers_overview(integer,integer,text,text)'),
      to_regprocedure('public.get_classrooms_overview(integer,integer,text,text,integer,integer,uuid)'),
      to_regprocedure('public.get_incomplete_reports_page(integer,text,integer,integer,text,text)'),
      to_regprocedure('public.get_holidays_overview(integer,integer,text,text,boolean)'),
      to_regprocedure('public.get_class_session_workspace(uuid)')
    )
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) <> 6 THEN
    RAISE EXCEPTION 'Page API RPCs must use controlled read-model security boundaries';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
    WHERE procedure.oid IN (
      to_regprocedure('public.get_courses_overview(integer,integer,text,text)'),
      to_regprocedure('public.get_teachers_overview(integer,integer,text,text)'),
      to_regprocedure('public.get_classrooms_overview(integer,integer,text,text,integer,integer,uuid)'),
      to_regprocedure('public.get_incomplete_reports_page(integer,text,integer,integer,text,text)'),
      to_regprocedure('public.get_holidays_overview(integer,integer,text,text,boolean)'),
      to_regprocedure('public.get_class_session_workspace(uuid)')
    )
      AND owner_role.rolname IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'Page API read-model RPC has an unsafe owner';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name IN ('display_name', 'email')
  ) THEN
    RAISE EXCEPTION 'legacy profile display_name or duplicated login email remains';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'full_name'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'nickname'
  ) THEN
    RAISE EXCEPTION 'separate full_name and nickname profile fields are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_accounts' AND column_name = 'email'
  ) THEN
    RAISE EXCEPTION 'user account directory no longer reads the Auth email';
  END IF;
END;
$$;

DO $$
DECLARE attribute_name text;
BEGIN
  IF to_regclass('public.person_profiles') IS NOT NULL THEN
    RAISE EXCEPTION 'person_profiles table remains after the person-master migration';
  END IF;
  IF to_regclass('public.teacher_records') IS NULL OR to_regclass('public.teachers') IS NULL THEN
    RAISE EXCEPTION 'canonical teacher records or compatibility view are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'auth_user_id' AND is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION 'profiles.auth_user_id must be nullable for teachers without accounts';
  END IF;
  FOREACH attribute_name IN ARRAY ARRAY['name','email','phone','gov_id','address','birthday','bio','bio_document','user_id','person_profile_id'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'teacher_records'
        AND column_name = attribute_name
    ) THEN
      RAISE EXCEPTION 'duplicate teacher profile column remains: %', attribute_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'contact_email'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'government_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'profiles_auth_user_id_unique'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'teacher_records_profile_id_unique'
  ) THEN
    RAISE EXCEPTION 'person profile attributes or unique account/teacher links are missing';
  END IF;
  IF has_table_privilege('authenticated', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated users can directly read sensitive profiles';
  END IF;
  IF has_table_privilege('authenticated', 'public.teachers', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated users can bypass the teacher API through the compatibility view';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.teachers', 'SELECT') THEN
    RAISE EXCEPTION 'the trusted API role cannot read the teacher compatibility view';
  END IF;
END;
$$;

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner-a@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'owner-b@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'unassigned@example.test'),
  ('00000000-0000-0000-0000-000000000004', 'enrollment-creator@example.test')
ON CONFLICT (id) DO NOTHING;

-- Teaching roles are assigned at the platform root and stay separate from
-- system-administration roles. Either root teaching assignment covers the
-- shared classroom directory; an unassigned account gets no such access.
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, effective_to, status)
SELECT account.id, role.id, 'system', NULL, CURRENT_DATE, NULL, 'active'
FROM auth.users account
CROSS JOIN public.roles role
WHERE account.id IN (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002'
  )
  AND role.code = 'teaching_owner'
  AND role.domain = 'teaching'
ON CONFLICT DO NOTHING;

INSERT INTO public.classrooms(id, name, user_id, teaching_id)
SELECT classroom.id, classroom.name, NULL, teaching.id
FROM (VALUES
  ('30000000-0000-0000-0000-000000000001'::uuid, 'A classroom'),
  ('40000000-0000-0000-0000-000000000002'::uuid, 'B classroom')
) AS classroom(id, name)
CROSS JOIN LATERAL (SELECT id FROM public.teachings WHERE is_global LIMIT 1) teaching
ON CONFLICT (id) DO NOTHING;

-- These standalone students model records whose former owner was cleared by
-- the global-scope migrations and which have no enrollment to reveal them.
INSERT INTO public.students(id, name, user_id) VALUES
  ('20000000-0000-0000-0000-000000000101', 'Migration Visibility A', NULL),
  ('20000000-0000-0000-0000-000000000102', 'Migration Visibility B', NULL)
ON CONFLICT (id) DO NOTHING;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
DO $$
DECLARE student_page jsonb;
DECLARE student_second_page jsonb;
BEGIN
  IF (SELECT count(*) FROM public.classrooms WHERE NOT is_virtual) <> 2 THEN
    RAISE EXCEPTION 'platform teaching role did not grant access to the shared classroom directory';
  END IF;
  IF public.has_system_permission(auth.uid(), 'system.audit.list') THEN
    RAISE EXCEPTION 'teaching role granted a system-administration permission';
  END IF;
  student_page := public.get_students_overview(1, 0, 'Migration Visibility', 'name');
  student_second_page := public.get_students_overview(1, 1, 'Migration Visibility', 'name');
  IF (student_page->>'total')::integer <> 2
     OR jsonb_array_length(student_page->'items') <> 1
     OR jsonb_array_length(student_second_page->'items') <> 1
     OR student_page->'items'->0->>'name' <> 'Migration Visibility A'
     OR student_second_page->'items'->0->>'name' <> 'Migration Visibility B' THEN
    RAISE EXCEPTION 'platform-level student access omitted standalone students or broke pagination: %, %', student_page, student_second_page;
  END IF;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
DECLARE student_page jsonb;
BEGIN
  IF (SELECT count(*) FROM public.classrooms WHERE NOT is_virtual) <> 0 THEN
    RAISE EXCEPTION 'teaching role membership was required for classroom access';
  END IF;
  student_page := public.get_students_overview(10, 0, 'Migration Visibility', 'name');
  IF (student_page->>'total')::integer <> 0 OR jsonb_array_length(student_page->'items') <> 0 THEN
    RAISE EXCEPTION 'unassigned account can see platform students: %', student_page;
  END IF;
  IF public.can_access_enrollment_scope(
    '20000000-0000-0000-0000-000000000101',
    '50000000-0000-0000-0000-000000000101',
    '30000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000104',
    'teaching.enrollments.create'
  ) THEN
    RAISE EXCEPTION 'account without target teaching permissions can create an enrollment';
  END IF;
END;
$$;
RESET ROLE;

-- A classroom-scoped role should see its enrolled students but not standalone
-- platform records or students from another classroom.
DO $$
DECLARE classroom_role_id uuid := gen_random_uuid();
DECLARE classroom_creator_role_id uuid := gen_random_uuid();
DECLARE platform_teaching_id uuid;
DECLARE classroom_id uuid := '30000000-0000-0000-0000-000000000001';
DECLARE course_id uuid := '50000000-0000-0000-0000-000000000101';
DECLARE unrelated_course_id uuid := '50000000-0000-0000-0000-000000000103';
DECLARE student_id uuid := '20000000-0000-0000-0000-000000000103';
DECLARE class_session_id uuid := '60000000-0000-0000-0000-000000000103';
BEGIN
  SELECT id INTO platform_teaching_id FROM public.teachings WHERE is_global LIMIT 1;
  INSERT INTO public.roles(id, code, name, is_system, sort_order, domain, teaching_id, is_builtin, is_protected)
  VALUES (classroom_role_id, 'integration_classroom_student_reader', 'Integration Classroom Student Reader', false, 900, 'teaching', NULL, false, false);
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT classroom_role_id, permission.id, 'classroom', classroom_id, 'allow'
  FROM public.permissions permission
  WHERE permission.key IN ('teaching.students.list', 'teaching.students.read', 'teaching.class_sessions.list');
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
  VALUES ('00000000-0000-0000-0000-000000000003', classroom_role_id, 'classroom', classroom_id, CURRENT_DATE, 'active');
  INSERT INTO public.roles(id, code, name, is_system, sort_order, domain, teaching_id, is_builtin, is_protected)
  VALUES (classroom_creator_role_id, 'integration_classroom_enrollment_creator', 'Integration Classroom Enrollment Creator', false, 901, 'teaching', NULL, false, false);
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT classroom_creator_role_id, permission.id, 'classroom', classroom_id, 'allow'
  FROM public.permissions permission
  WHERE permission.key = 'teaching.enrollments.create';
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
  VALUES ('00000000-0000-0000-0000-000000000004', classroom_creator_role_id, 'classroom', classroom_id, CURRENT_DATE, 'active');
  INSERT INTO public.courses(id, subject, stage, user_id, teaching_id)
  VALUES (course_id, 'Scoped roster test', 'primary', NULL, platform_teaching_id);
  INSERT INTO public.courses(id, subject, stage, user_id, teaching_id)
  VALUES (unrelated_course_id, 'Unrelated makeup course', 'primary', NULL, platform_teaching_id);
  INSERT INTO public.students(id, name, user_id)
  VALUES (student_id, 'Migration Visibility Classroom', NULL);
  INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, user_id, teaching_id)
  VALUES (class_session_id, 'Scoped roster test session', classroom_id, ARRAY[course_id], '00000000-0000-0000-0000-000000000001', platform_teaching_id);
  INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, user_id, teaching_id)
  VALUES ('60000000-0000-0000-0000-000000000104', 'Scoped makeup source session', classroom_id, ARRAY[course_id], '00000000-0000-0000-0000-000000000001', platform_teaching_id);
  INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, user_id, teaching_id)
  VALUES ('60000000-0000-0000-0000-000000000105', 'Unrelated makeup source session', classroom_id, ARRAY[unrelated_course_id], '00000000-0000-0000-0000-000000000001', platform_teaching_id);
  INSERT INTO public.enrollments(student_id, course_id, classroom_id, class_session_id, user_id, status, start_date)
  VALUES (student_id, course_id, classroom_id, class_session_id, NULL, 'regular', CURRENT_DATE);
  INSERT INTO public.students(id, name, user_id) VALUES
    ('20000000-0000-0000-0000-000000000104', 'Migration Makeup Student', NULL),
    ('20000000-0000-0000-0000-000000000105', 'Migration Not Makeup Student', NULL),
    ('20000000-0000-0000-0000-000000000106', 'Migration Future Makeup Student', NULL),
    ('20000000-0000-0000-0000-000000000107', 'Migration Course Mismatch Student', NULL),
    ('20000000-0000-0000-0000-000000000108', 'Migration Transferred Out Student', NULL),
    ('20000000-0000-0000-0000-000000000109', 'Migration Completed Makeup Student', NULL),
    ('20000000-0000-0000-0000-000000000110', 'Migration Incomplete Completion Student', NULL);
  INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, user_id, status, start_date)
  VALUES
    ('99000000-0000-4000-8000-000000000103', '20000000-0000-0000-0000-000000000104', course_id, classroom_id, '60000000-0000-0000-0000-000000000104', NULL, 'regular', CURRENT_DATE),
    ('99000000-0000-4000-8000-000000000104', '20000000-0000-0000-0000-000000000105', course_id, classroom_id, '60000000-0000-0000-0000-000000000104', NULL, 'regular', CURRENT_DATE),
    ('99000000-0000-4000-8000-000000000105', '20000000-0000-0000-0000-000000000106', course_id, classroom_id, '60000000-0000-0000-0000-000000000104', NULL, 'regular', CURRENT_DATE + 1),
    ('99000000-0000-4000-8000-000000000106', '20000000-0000-0000-0000-000000000107', unrelated_course_id, classroom_id, '60000000-0000-0000-0000-000000000105', NULL, 'regular', CURRENT_DATE),
    ('99000000-0000-4000-8000-000000000107', '20000000-0000-0000-0000-000000000108', course_id, classroom_id, class_session_id, NULL, 'regular', CURRENT_DATE),
    ('99000000-0000-4000-8000-000000000108', '20000000-0000-0000-0000-000000000109', course_id, classroom_id, '60000000-0000-0000-0000-000000000104', NULL, 'completed', CURRENT_DATE),
    ('99000000-0000-4000-8000-000000000109', '20000000-0000-0000-0000-000000000110', course_id, classroom_id, '60000000-0000-0000-0000-000000000104', NULL, 'completed', CURRENT_DATE);
  INSERT INTO public.lessons(id, course_id, title, sequence, user_id)
  VALUES ('95000000-0000-4000-8000-000000000103', course_id, 'Roster completion lesson', 999999, '00000000-0000-0000-0000-000000000001');
  INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status, is_conducted)
  VALUES
    ('9a000000-0000-4000-8000-000000000103', class_session_id, CURRENT_DATE, 'scheduled', false),
    ('9a000000-0000-4000-8000-000000000104', '60000000-0000-0000-0000-000000000104', CURRENT_DATE, 'scheduled', false),
    ('9a000000-0000-4000-8000-000000000105', class_session_id, CURRENT_DATE + 1, 'scheduled', false),
    ('9a000000-0000-4000-8000-000000000106', class_session_id, CURRENT_DATE - 1, 'scheduled', false);
  INSERT INTO public.occurrence_reports(enrollment_id, class_occurrence_id, content, is_completed, attendance_status)
  VALUES
    ('99000000-0000-4000-8000-000000000103', '9a000000-0000-4000-8000-000000000103', '', false, 'pending'),
    ('99000000-0000-4000-8000-000000000105', '9a000000-0000-4000-8000-000000000103', '', false, 'pending'),
    ('99000000-0000-4000-8000-000000000106', '9a000000-0000-4000-8000-000000000103', '', false, 'pending'),
    ('99000000-0000-4000-8000-000000000107', '9a000000-0000-4000-8000-000000000103', '', false, 'pending'),
    ('99000000-0000-4000-8000-000000000108', '9a000000-0000-4000-8000-000000000103', '', false, 'pending'),
    ('99000000-0000-4000-8000-000000000109', '9a000000-0000-4000-8000-000000000103', '', false, 'pending');
  INSERT INTO public.occurrence_reports(enrollment_id, class_occurrence_id, content, lesson_id, is_completed, attendance_status)
  VALUES
    ('99000000-0000-4000-8000-000000000109', '9a000000-0000-4000-8000-000000000106', '', '95000000-0000-4000-8000-000000000103', true, 'present');
  INSERT INTO public.single_lesson_transfers(enrollment_id, source_occurrence_id, target_occurrence_id)
  VALUES ('99000000-0000-4000-8000-000000000107', '9a000000-0000-4000-8000-000000000103', '9a000000-0000-4000-8000-000000000104');
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments enrollment
    WHERE enrollment.student_id = '20000000-0000-0000-0000-000000000103'
      AND enrollment.classroom_id = '30000000-0000-0000-0000-000000000001'
      AND enrollment.course_id = '50000000-0000-0000-0000-000000000101'
  ) THEN
    RAISE EXCEPTION 'classroom scope integration fixture did not persist its enrollment classroom/course';
  END IF;
END;
$$;

-- The destination-scope grants authorize a standalone student with no prior
-- enrollment in any classroom.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
DO $$
BEGIN
  IF public.can_access_enrollment_scope(
    '20000000-0000-0000-0000-000000000101',
    '50000000-0000-0000-0000-000000000101',
    '30000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000104',
    'teaching.enrollments.create'
  ) THEN
    RAISE EXCEPTION 'target create permission without target student-read permission was accepted';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
DO $$
BEGIN
  IF NOT public.can_access_enrollment_scope(
    '20000000-0000-0000-0000-000000000101',
    '50000000-0000-0000-0000-000000000101',
    '30000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000104',
    'teaching.enrollments.create'
  ) THEN
    RAISE EXCEPTION 'target-scope owner could not enroll a student without prior enrollment';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
DECLARE student_page jsonb;
  target_workspace jsonb;
  other_date_workspace jsonb;
  source_workspace jsonb;
  makeup_count integer;
  effective_makeup_count integer;
BEGIN
  IF public.can_access_enrollment_scope(
    '20000000-0000-0000-0000-000000000101',
    '50000000-0000-0000-0000-000000000101',
    '30000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000104',
    'teaching.enrollments.create'
  ) THEN
    RAISE EXCEPTION 'target student-read permission without target enrollment-create permission was accepted';
  END IF;
  student_page := public.get_students_overview(10, 0, 'Migration Visibility', 'name');
  IF (student_page->>'total')::integer <> 1
     OR student_page->'items'->0->>'name' <> 'Migration Visibility Classroom' THEN
    RAISE EXCEPTION 'classroom-scoped student access was broadened or omitted: %', student_page;
  END IF;

  target_workspace := public.get_class_session_workspace('60000000-0000-0000-0000-000000000103', CURRENT_DATE);
  SELECT count(*) INTO effective_makeup_count
  FROM public.get_effective_occurrence_enrollment_ids('9a000000-0000-4000-8000-000000000103') AS roster
  WHERE roster.enrollment_id = '99000000-0000-4000-8000-000000000103';
  IF effective_makeup_count <> 1 THEN
    RAISE EXCEPTION 'report-backed makeup enrollment should be part of the shared effective occurrence roster';
  END IF;
  SELECT count(*) INTO makeup_count
  FROM jsonb_array_elements(target_workspace->'enrollments') AS enrollment
  WHERE enrollment->>'id' = '99000000-0000-4000-8000-000000000103';
  IF makeup_count <> 1 THEN
    RAISE EXCEPTION 'report-backed makeup enrollment should appear exactly once in its target occurrence workspace: %', target_workspace->'enrollments';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(target_workspace->'enrollments') AS enrollment
    WHERE enrollment->>'id' = '99000000-0000-4000-8000-000000000104'
  ) THEN
    RAISE EXCEPTION 'cross-session enrollment without a target occurrence report was added to the roster';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.get_effective_occurrence_enrollment_ids('9a000000-0000-4000-8000-000000000103') AS roster
    WHERE roster.enrollment_id = '99000000-0000-4000-8000-000000000104'
  ) THEN
    RAISE EXCEPTION 'cross-session enrollment without a target occurrence report was added to the shared effective roster';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.get_effective_occurrence_enrollment_ids('9a000000-0000-4000-8000-000000000103') AS roster
    WHERE roster.enrollment_id = '99000000-0000-4000-8000-000000000107'
  ) THEN
    RAISE EXCEPTION 'a report-backed enrollment transferred out of the occurrence remained in the shared roster';
  END IF;
  IF (
    SELECT count(*)
    FROM public.get_effective_occurrence_enrollment_ids('9a000000-0000-4000-8000-000000000103') AS roster
    WHERE roster.enrollment_id IN (
      '99000000-0000-4000-8000-000000000105', -- start date is after the occurrence
      '99000000-0000-4000-8000-000000000106', -- course is not listed by the target session
      '99000000-0000-4000-8000-000000000108', -- completed without a completion report
      '99000000-0000-4000-8000-000000000109'  -- completion predates the occurrence
    )
  ) <> 4 THEN
    RAISE EXCEPTION 'the target occurrence report did not override normal enrollment date, course, or status filters';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_effective_occurrence_enrollment_ids('9a000000-0000-4000-8000-000000000103') AS roster
    WHERE roster.enrollment_id = '99000000-0000-4000-8000-000000000109'
  ) THEN
    RAISE EXCEPTION 'completed report-backed makeup enrollment should remain eligible';
  END IF;
  SELECT count(*) INTO makeup_count
  FROM jsonb_array_elements(target_workspace->'enrollments') AS enrollment
  WHERE enrollment->>'id' = '99000000-0000-4000-8000-000000000109';
  IF makeup_count <> 1 THEN
    RAISE EXCEPTION 'completed makeup enrollment should appear once in its target-date workspace';
  END IF;
  SELECT count(DISTINCT enrollment->>'id') INTO makeup_count
  FROM jsonb_array_elements(target_workspace->'enrollments') AS enrollment
  WHERE enrollment->>'id' IN (
    '99000000-0000-4000-8000-000000000105',
    '99000000-0000-4000-8000-000000000106',
    '99000000-0000-4000-8000-000000000108',
    '99000000-0000-4000-8000-000000000109'
  );
  IF makeup_count <> 4 THEN
    RAISE EXCEPTION 'the workspace filtered report-backed enrollments a second time: %', target_workspace->'enrollments';
  END IF;

  other_date_workspace := public.get_class_session_workspace('60000000-0000-0000-0000-000000000103', CURRENT_DATE + 1);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(other_date_workspace->'enrollments') AS enrollment
    WHERE enrollment->>'id' = '99000000-0000-4000-8000-000000000103'
  ) THEN
    RAISE EXCEPTION 'one-off makeup enrollment leaked into another target-session date';
  END IF;

  source_workspace := public.get_class_session_workspace('60000000-0000-0000-0000-000000000104', CURRENT_DATE);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(source_workspace->'enrollments') AS enrollment
    WHERE enrollment->>'id' = '99000000-0000-4000-8000-000000000103'
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(source_workspace->'enrollments') AS enrollment
    WHERE enrollment->>'id' = '99000000-0000-4000-8000-000000000104'
  ) THEN
    RAISE EXCEPTION 'makeup entry changed the normal roster in its source session';
  END IF;
END;
$$;
RESET ROLE;

-- Cancelling an active transfer out restores the report-linked occurrence entry.
DO $$
BEGIN
  UPDATE public.single_lesson_transfers
  SET cancelled_at = now()
  WHERE enrollment_id = '99000000-0000-4000-8000-000000000107'
    AND source_occurrence_id = '9a000000-0000-4000-8000-000000000103'
    AND cancelled_at IS NULL;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.get_effective_occurrence_enrollment_ids('9a000000-0000-4000-8000-000000000103') AS roster
    WHERE roster.enrollment_id = '99000000-0000-4000-8000-000000000107'
  ) THEN
    RAISE EXCEPTION 'cancelling a transfer out did not restore the report-backed roster entry';
  END IF;
END;
$$;

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
  INSERT INTO public.roles(id, code, name, is_system, domain, teaching_id) VALUES
    (alpha, 'integration_alpha_' || left(alpha::text, 8), 'Integration alpha', false, 'teaching', NULL),
    (beta, 'integration_beta_' || left(beta::text, 8), 'Integration beta', false, 'teaching', NULL);
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

-- Execute the effective teaching-role RPC for a historical date. This catches
-- ambiguity between RETURNS TABLE output names and columns inside its CTEs.
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, effective_to, status)
SELECT '00000000-0000-0000-0000-000000000003', role.id, 'classroom',
       '30000000-0000-0000-0000-000000000001', DATE '2025-07-05', DATE '2025-07-05', 'active'
FROM public.roles role
WHERE role.code = 'integration_classroom_student_reader' AND role.domain = 'teaching'
ON CONFLICT DO NOTHING;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
DO $$
DECLARE effective_role_count integer;
BEGIN
  SELECT count(*) INTO effective_role_count
  FROM public.get_effective_teaching_roles(
    '00000000-0000-0000-0000-000000000003',
    'class_session',
    '60000000-0000-0000-0000-000000000104',
    DATE '2025-07-05'
  ) effective_role
  WHERE effective_role.code = 'integration_classroom_student_reader'
    AND effective_role.source_type = 'direct'
    AND effective_role.source_scope_type = 'classroom'
    AND effective_role.source_scope_id = '30000000-0000-0000-0000-000000000001';
  IF effective_role_count <> 1 THEN
    RAISE EXCEPTION 'effective teaching-role RPC did not return the historical classroom assignment';
  END IF;
END;
$$;
RESET ROLE;
