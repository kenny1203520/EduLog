-- The invoker-security class-session RPC must read referenced classrooms and
-- courses to validate their teaching scope. SQL privileges are granted here;
-- row visibility remains constrained by the canonical teaching-scoped RLS.
DO $$
DECLARE
  target_table text;
  rls_enabled boolean;
  canonical_read_policy_count integer;
BEGIN
  IF to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regprocedure('public.save_class_session_with_schedule(jsonb,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000070 prerequisites missing; apply migrations through 1000069 first';
  END IF;

  FOREACH target_table IN ARRAY ARRAY['classrooms', 'courses'] LOOP
    SELECT relrowsecurity INTO rls_enabled
    FROM pg_class
    WHERE oid = format('public.%I', target_table)::regclass;
    IF NOT COALESCE(rls_enabled, false) THEN
      RAISE EXCEPTION '1000070 requires RLS enabled on public.%', target_table;
    END IF;

    SELECT count(*) INTO canonical_read_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = target_table
      AND policyname = CASE target_table
        WHEN 'classrooms' THEN 'Canonical classrooms read'
        ELSE 'Canonical courses read'
      END
      AND cmd = 'SELECT'
      AND permissive = 'PERMISSIVE'
      AND roles @> ARRAY['authenticated'::name]
      AND qual LIKE '%can_teaching_action%';
    IF canonical_read_policy_count <> 1 THEN
      RAISE EXCEPTION '1000070 expected the canonical teaching-scoped read policy on public.%', target_table;
    END IF;
  END LOOP;
END;
$$;

-- Do not inherit a broad SELECT privilege from PUBLIC/anon. The authenticated
-- role gets only SELECT; RLS decides which referenced rows the RPC can inspect.
REVOKE SELECT ON TABLE public.classrooms, public.courses FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.classrooms, public.courses TO authenticated, service_role;

DO $$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.classrooms', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.courses', 'SELECT')
     OR has_table_privilege('anon', 'public.classrooms', 'SELECT')
     OR has_table_privilege('anon', 'public.courses', 'SELECT') THEN
    RAISE EXCEPTION '1000070 class-session reference SELECT privileges are incomplete';
  END IF;
END;
$$;
