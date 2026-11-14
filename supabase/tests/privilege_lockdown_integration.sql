-- Privilege lockdown gate (1000167). Fails when anon can reach anything in
-- public, when authenticated can call a function outside the reviewed list, or
-- when a new function would be callable without an explicit GRANT.
--
-- Adding an authenticated RPC: GRANT EXECUTE to authenticated in its migration
-- and add its signature to the list below. Keep released migrations intact.

DO $$
DECLARE
  expected text[] := ARRAY[
    'public.accessible_classroom_ids(uuid,text)',
    'public.accessible_class_session_ids(uuid,text)',
    'public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text)',
    'public.apply_student_suspension(text,uuid,uuid,date,date,text,text,boolean,boolean)',
    'public.can_access_classroom(uuid,text)',
    'public.can_access_class_session(uuid,text)',
    'public.can_access_enrollment_scope(uuid,uuid,uuid,uuid,text)',
    'public.can_access_enrollment(uuid,text)',
    'public.can_access_occurrence_report(uuid)',
    'public.correct_occurrence_report(uuid,uuid,integer,uuid)',
    'public.can_access_report(uuid,text)',
    'public.can_access_sensitive_student(uuid,text)',
    'public.can_access_single_lesson_transfer(uuid,text)',
    'public.can_access_student(uuid,text)',
    'public.can_access_teacher(uuid,text)',
    'public.cancel_single_lesson_transfer(uuid)',
    'public.check_class_holiday(uuid,date,uuid)',
    'public.can_create_occurrence_report(uuid,uuid)',
    'public.can_manage_editor_rbac()',
    'public.can_mutate_occurrence_report(uuid,text)',
    'public.can_teaching_resource_action_any_scope(text,text)',
    'public.can_teaching_resource_action(text,text)',
    'public.can_teaching_scope_action(text,text,uuid,uuid)',
    'public.create_classroom_with_details(jsonb)',
    'public.current_rbac_policy_epoch()',
    'public.current_user_teacher_id()',
    'public.end_class_session_teacher_assignments(uuid,uuid,date)',
    'public.enrollment_history_access(text,jsonb)',
    'public.get_classrooms_overview(integer,integer,text,text,integer,integer,uuid)',
    'public.get_class_report_completion(uuid,date,date)',
    'public.get_class_session_occupancy(uuid,date,date)',
    'public.get_class_session_roster_flags(uuid,date,date)',
    'public.get_class_session_workspace(uuid)',
    'public.get_class_session_workspace(uuid,date)',
    'public.get_courses_overview(integer,integer,text,text)',
    'public.get_dashboard_counts()',
    'public.get_effective_attendance(uuid,uuid,boolean)',
    'public.get_effective_occurrence_enrollment_ids(uuid)',
    'public.get_effective_single_lesson_transfer_targets(uuid)',
    'public.get_effective_teaching_roles(uuid,text,uuid,date)',
    'public.get_enrollment_class_timeline(uuid)',
    'public.get_holidays_overview(integer,integer,text,text,boolean)',
    'public.get_incomplete_reports_page(integer,text,integer,integer,text,text)',
    'public.get_my_teaching_capabilities()',
    'public.get_occurrence_lesson_transfers(uuid)',
    'public.get_occurrence_report_mutation_context(uuid,text)',
    'public.get_provisionable_occurrence_enrollment_ids(uuid)',
    'public.get_rbac_capabilities(uuid)',
    'public.get_single_lesson_transfer_history(uuid)',
    'public.get_student_profile_page(uuid)',
    'public.get_student_sensitive_details(uuid)',
    'public.get_students_overview(integer,integer,text,text)',
    'public.get_teacher_assignments(uuid)',
    'public.get_teacher_sensitive_details(uuid)',
    'public.get_teachers_overview(integer,integer,text,text)',
    'public.get_teachers_overview(integer,integer,text,text,text)',
    'public.has_active_teaching_role(uuid)',
    'public.has_api_permission(uuid,text,uuid,uuid)',
    'public.has_system_permission(uuid,text)',
    'public.has_teaching_permission_any_scope(uuid,text)',
    'public.has_teaching_permission(uuid,text,uuid,uuid,uuid)',
    'public.prepare_repeatable_single_lesson_transfer(uuid,uuid,uuid)',
    'public.provision_class_reports(uuid)',
    'public.provision_occurrence_reports(uuid)',
    'public.rbac_can_manage_domain(text,uuid)',
    'public.rbac_can_grant_role(uuid,text,uuid)',
    'public.rbac_create_role(text,uuid,text,text,text,uuid,bigint)',
    'public.rbac_delete_platform_teaching_assignment(uuid,bigint)',
    'public.rbac_delete_role_assignment_exclusion(uuid,text,uuid,bigint)',
    'public.rbac_delete_role(uuid,bigint)',
    'public.rbac_delete_scoped_teaching_assignment(uuid,text,uuid,bigint)',
    'public.rbac_delete_system_assignment(uuid,bigint)',
    'public.rbac_get_role_permissions(uuid,text,uuid)',
    'public.rbac_is_system_owner(uuid)',
    'public.rbac_replace_role_permissions(uuid,text,uuid,bigint,jsonb)',
    'public.rbac_scope_exists(text,uuid)',
    'public.rbac_set_role_parent(uuid,uuid,bigint)',
    'public.rbac_update_role(uuid,text,text,text,bigint)',
    'public.rbac_upsert_platform_teaching_assignment(uuid,uuid,uuid,date,date,bigint)',
    'public.rbac_upsert_role_assignment_exclusion(uuid,uuid,uuid,text,uuid,date,date,bigint)',
    'public.rbac_upsert_scoped_teaching_assignment(uuid,uuid,uuid,text,uuid,date,date,bigint)',
    'public.rbac_upsert_system_assignment(uuid,uuid,uuid,date,date,bigint)',
    'public.repair_single_lesson_transfer_report(uuid,uuid)',
    'public.replace_class_session_teacher_assignments(uuid,jsonb)',
    'public.replace_role_permission_policies(text,text,uuid,jsonb)',
    'public.resolve_dashboard_schedule_modes(uuid,uuid[],date)',
    'public.resolve_incomplete_report_notification_permission(uuid,uuid,uuid,date)',
    'public.resolve_scoped_permission(uuid,text,uuid,uuid,date)',
    'public.resolve_single_lesson_transfer_conflict(uuid,uuid,uuid,uuid,integer,uuid,integer,jsonb)',
    'public.resolve_user_permission(uuid,text,uuid,uuid,date)',
    'public.save_class_session_with_schedule(jsonb,jsonb,uuid)',
    'public.save_report_collab_snapshot(uuid,text,integer)',
    'public.set_occurrence_teacher_attendance(uuid,jsonb)',
    'public.set_system_user_status(uuid,text,text,bigint)',
    'public.set_teacher_archived(uuid,boolean)',
    'public.sync_enrollment_reports(uuid,integer,date,boolean)',
    'public.sync_suspension_attendance(uuid,date,date,boolean)',
    'public.transfer_enrollment_class(uuid,uuid,date,text)',
    'public.transfer_single_lesson(uuid,uuid,uuid,uuid)',
    'public.update_student_sensitive(uuid,jsonb)',
    'public.update_teacher_profile(uuid,jsonb)',
    'public.update_teacher_sensitive(uuid,jsonb)'
  ];
  unexpected text;
  missing text;
  leaked text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO leaked
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'anon can execute public functions: %', leaked;
  END IF;

  SELECT string_agg(c.oid::regclass::text, ', ' ORDER BY 1) INTO leaked
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
      OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'));
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'anon has privileges on public relations: %', leaked;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO leaked
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype)
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated can execute trigger functions: %', leaked;
  END IF;

  SELECT string_agg(sig, ', ' ORDER BY sig) INTO unexpected FROM (
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.oid <> ALL (SELECT to_regprocedure(e) FROM unnest(expected) e WHERE to_regprocedure(e) IS NOT NULL)
  ) s;
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated can execute functions outside the reviewed list: %', unexpected;
  END IF;

  SELECT string_agg(e, ', ' ORDER BY e) INTO missing FROM unnest(expected) e
  WHERE to_regprocedure(e) IS NULL OR NOT has_function_privilege('authenticated', to_regprocedure(e), 'EXECUTE');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'reviewed authenticated functions are missing or not executable: %', missing;
  END IF;
END;
$$;

-- New functions must not be callable until a migration grants them.
BEGIN;
CREATE FUNCTION public.privilege_lockdown_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE TABLE public.privilege_lockdown_probe_table (id integer);
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.privilege_lockdown_probe()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.privilege_lockdown_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'new public functions are executable by anon/authenticated by default';
  END IF;
  IF has_table_privilege('anon', 'public.privilege_lockdown_probe_table', 'SELECT') THEN
    RAISE EXCEPTION 'new public tables are readable by anon by default';
  END IF;
END;
$$;
ROLLBACK;

-- has_system_permission answers only for the caller.
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('d1610000-0000-4000-8000-000000000001', 'lockdown-caller@example.test')
ON CONFLICT (id) DO NOTHING;
SELECT set_config('lockdown.other_user', coalesce((
  SELECT assignment.user_id::text FROM public.user_role_assignments assignment
  JOIN public.roles r ON r.id = assignment.role_id
  WHERE assignment.scope_type = 'system' AND r.domain = 'system' LIMIT 1
), 'd1610000-0000-4000-8000-000000000002'), true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1610000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
BEGIN
  IF public.has_system_permission(current_setting('lockdown.other_user')::uuid, 'system.roles.manage') THEN
    RAISE EXCEPTION 'has_system_permission answered for another user';
  END IF;
END;
$$;
ROLLBACK;
