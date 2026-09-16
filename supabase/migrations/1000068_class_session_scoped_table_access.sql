-- Restore the table privileges required by the authenticated session RPC,
-- while making row-level policies the only authorization path for both the
-- session and its schedule rules.
DO $$
DECLARE
  session_table_rls boolean;
  rules_table_rls boolean;
  session_rpc_is_definer boolean;
BEGIN
  IF to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.class_session_schedule_rules') IS NULL
     OR to_regprocedure('public.can_teaching_action(uuid,text,text)') IS NULL
     OR to_regprocedure('public.can_access_class_session(uuid,text)') IS NULL
     OR to_regprocedure('public.save_class_session_with_schedule(jsonb,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000068 prerequisites missing; apply session scope and RPC migrations first';
  END IF;

  SELECT relrowsecurity INTO session_table_rls
  FROM pg_class WHERE oid = 'public.class_sessions'::regclass;
  SELECT relrowsecurity INTO rules_table_rls
  FROM pg_class WHERE oid = 'public.class_session_schedule_rules'::regclass;
  IF NOT COALESCE(session_table_rls, false) OR NOT COALESCE(rules_table_rls, false) THEN
    RAISE EXCEPTION '1000068 requires RLS enabled on class session tables';
  END IF;

  SELECT proc.prosecdef INTO session_rpc_is_definer
  FROM pg_proc AS proc
  WHERE proc.oid = to_regprocedure('public.save_class_session_with_schedule(jsonb,jsonb,uuid)');
  IF COALESCE(session_rpc_is_definer, true) THEN
    RAISE EXCEPTION '1000068 requires save_class_session_with_schedule to run as invoker';
  END IF;
END;
$$;

-- Remove only policies created by the known migration history. Unexpected
-- policies are not silently deleted; the postcondition below fails if one
-- would broaden or duplicate access.
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.class_sessions;
DROP POLICY IF EXISTS "Teaching sessions read" ON public.class_sessions;
DROP POLICY IF EXISTS "Teaching sessions write" ON public.class_sessions;
DROP POLICY IF EXISTS "Teaching sessions update" ON public.class_sessions;
DROP POLICY IF EXISTS "Teaching sessions delete" ON public.class_sessions;
DROP POLICY IF EXISTS "Canonical sessions read" ON public.class_sessions;
DROP POLICY IF EXISTS "Canonical sessions create" ON public.class_sessions;
DROP POLICY IF EXISTS "Canonical sessions update" ON public.class_sessions;
DROP POLICY IF EXISTS "Canonical sessions delete" ON public.class_sessions;

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.class_session_schedule_rules;
DROP POLICY IF EXISTS "Canonical session schedule rules read" ON public.class_session_schedule_rules;
DROP POLICY IF EXISTS "Canonical session schedule rules create" ON public.class_session_schedule_rules;
DROP POLICY IF EXISTS "Canonical session schedule rules update" ON public.class_session_schedule_rules;
DROP POLICY IF EXISTS "Canonical session schedule rules delete" ON public.class_session_schedule_rules;

CREATE POLICY "Canonical sessions read" ON public.class_sessions
  FOR SELECT TO authenticated
  USING (
    public.can_teaching_action(teaching_id, 'class_sessions', 'read')
    OR public.can_teaching_action(teaching_id, 'class_sessions', 'list')
  );
CREATE POLICY "Canonical sessions create" ON public.class_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_teaching_action(teaching_id, 'class_sessions', 'create'));
CREATE POLICY "Canonical sessions update" ON public.class_sessions
  FOR UPDATE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'class_sessions', 'update'))
  WITH CHECK (public.can_teaching_action(teaching_id, 'class_sessions', 'update'));
CREATE POLICY "Canonical sessions delete" ON public.class_sessions
  FOR DELETE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'class_sessions', 'delete'));

CREATE POLICY "Canonical session schedule rules read" ON public.class_session_schedule_rules
  FOR SELECT TO authenticated
  USING (
    public.can_access_class_session(class_session_id, 'teaching.class_sessions.read')
    OR public.can_access_class_session(class_session_id, 'teaching.class_sessions.list')
  );
CREATE POLICY "Canonical session schedule rules create" ON public.class_session_schedule_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_class_session(class_session_id, 'teaching.class_sessions.create')
    OR public.can_access_class_session(class_session_id, 'teaching.class_sessions.update')
  );
CREATE POLICY "Canonical session schedule rules update" ON public.class_session_schedule_rules
  FOR UPDATE TO authenticated
  USING (public.can_access_class_session(class_session_id, 'teaching.class_sessions.update'))
  WITH CHECK (public.can_access_class_session(class_session_id, 'teaching.class_sessions.update'));
CREATE POLICY "Canonical session schedule rules delete" ON public.class_session_schedule_rules
  FOR DELETE TO authenticated
  USING (
    public.can_access_class_session(class_session_id, 'teaching.class_sessions.update')
    OR public.can_access_class_session(class_session_id, 'teaching.class_sessions.delete')
  );

-- RLS predicates remain mandatory after these SQL privileges are granted.
REVOKE ALL ON TABLE public.class_sessions, public.class_session_schedule_rules FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.class_sessions, public.class_session_schedule_rules
  TO authenticated, service_role;

DO $$
DECLARE
  target_table text;
  action_name text;
  policy_count integer;
  broad_policy_count integer;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['class_sessions', 'class_session_schedule_rules'] LOOP
    SELECT count(*) INTO broad_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = target_table
      AND cmd = 'ALL'
      AND permissive = 'PERMISSIVE'
      AND (
        roles @> ARRAY['authenticated'::name]
        OR roles @> ARRAY['public'::name]
      );
    IF broad_policy_count <> 0 THEN
      RAISE EXCEPTION '1000068 broad authenticated policy remains on %: %',
        target_table, broad_policy_count;
    END IF;

    FOREACH action_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      SELECT count(*) INTO policy_count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND cmd = action_name
        AND permissive = 'PERMISSIVE'
        AND (
          roles @> ARRAY['authenticated'::name]
          OR roles @> ARRAY['public'::name]
        );
      IF policy_count <> 1 THEN
        RAISE EXCEPTION '1000068 expected exactly one authenticated % policy on %, found %',
          action_name, target_table, policy_count;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT has_table_privilege('authenticated', 'public.class_sessions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.class_sessions', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.class_sessions', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.class_sessions', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.class_session_schedule_rules', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.class_session_schedule_rules', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.class_session_schedule_rules', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.class_session_schedule_rules', 'DELETE') THEN
    RAISE EXCEPTION '1000068 authenticated session table privileges are incomplete';
  END IF;
END;
$$;
