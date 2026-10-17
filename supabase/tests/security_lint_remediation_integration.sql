DO $$
DECLARE
  view_options text[];
  policy_expression text;
  policy_name text;
  policy_names text[] := ARRAY[
    'Canonical holidays read',
    'Canonical holidays create',
    'Canonical holidays update',
    'Canonical holidays delete',
    'Canonical reports create'
  ];
BEGIN
  SELECT reloptions INTO view_options
  FROM pg_class
  WHERE oid = 'public.user_accounts'::regclass;
  IF NOT COALESCE(view_options @> ARRAY['security_invoker=true'], false) THEN
    RAISE EXCEPTION 'user_accounts must use security_invoker';
  END IF;
  SELECT reloptions INTO view_options
  FROM pg_class
  WHERE oid = 'public.teachers'::regclass;
  IF NOT COALESCE(view_options @> ARRAY['security_invoker=true'], false) THEN
    RAISE EXCEPTION 'teachers must use security_invoker';
  END IF;

  FOREACH policy_name IN ARRAY ARRAY['user_accounts', 'teachers'] LOOP
    IF has_table_privilege('anon', format('public.%I', policy_name), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', policy_name), 'SELECT') THEN
      RAISE EXCEPTION 'direct view access remains granted to public API roles: %', policy_name;
    END IF;
    IF NOT has_table_privilege('service_role', format('public.%I', policy_name), 'SELECT') THEN
      RAISE EXCEPTION 'service_role cannot read API view: %', policy_name;
    END IF;
  END LOOP;
  IF NOT has_column_privilege('service_role', 'auth.users', 'id', 'SELECT')
     OR NOT has_column_privilege('service_role', 'auth.users', 'email', 'SELECT') THEN
    RAISE EXCEPTION 'service_role is missing the minimal auth.users columns needed by user_accounts';
  END IF;
  IF NOT has_column_privilege('service_role', 'public.teacher_records', 'id', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.teacher_records', 'profile_id', 'SELECT') THEN
    RAISE EXCEPTION 'service_role is missing the minimal teacher columns needed by teachers';
  END IF;

  FOREACH policy_name IN ARRAY policy_names LOOP
    SELECT COALESCE(qual, '') || ' ' || COALESCE(with_check, '')
    INTO policy_expression
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = CASE WHEN policy_name LIKE 'Canonical holidays %' THEN 'holidays' ELSE 'occurrence_reports' END
      AND policyname = policy_name;
    IF policy_expression IS NULL THEN
      RAISE EXCEPTION 'expected linted policy is missing: %', policy_name;
    END IF;
    IF policy_expression !~* 'SELECT[[:space:]]+auth[.]uid[(][)]'
       OR policy_expression ~* 'has_api_permission[[:space:]]*[(][[:space:]]*auth[.]uid[(][)]' THEN
      RAISE EXCEPTION 'policy does not hoist auth.uid() into an initplan: %', policy_name;
    END IF;
  END LOOP;

  IF to_regclass('public.idx_class_occurrences_date') IS NOT NULL
     OR to_regclass('public.class_occurrences_date_session_id_idx') IS NOT NULL
     OR to_regclass('public.class_sessions_teaching_id_idx') IS NOT NULL
     OR to_regclass('public.occurrence_reports_occurrence_attendance_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'a duplicate index remains after lint remediation';
  END IF;
  IF to_regclass('public.class_occurrences_occurrence_date_idx') IS NULL
     OR to_regclass('public.class_occurrences_date_session_idx') IS NULL
     OR to_regclass('public.class_sessions_teaching_idx') IS NULL
     OR to_regclass('public.occurrence_reports_occurrence_status_idx') IS NULL THEN
    RAISE EXCEPTION 'a retained query index is missing';
  END IF;
END;
$$;

-- Exercise both invoker views as the only granted application role; this also
-- catches missing base-table/column privileges hidden by the migration owner.
SET ROLE service_role;
SELECT id, email, display_name FROM public.user_accounts LIMIT 0;
SELECT id, user_id, name FROM public.teachers LIMIT 0;
RESET ROLE;
