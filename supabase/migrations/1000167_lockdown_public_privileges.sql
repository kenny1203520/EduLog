-- Lock down function and table privileges in the public schema.
--
-- The Supabase database linter reported SECURITY DEFINER functions that anon
-- and authenticated could call through /rest/v1/rpc, and tables that anon
-- could see in the GraphQL schema. Supabase's default privileges grant
-- EXECUTE on new public functions, and ALL on new public tables, to anon,
-- authenticated and service_role by name. Earlier migrations mostly wrote
-- "REVOKE ... FROM PUBLIC", which does not remove those named grants.
--
-- EduLog's browser never talks to PostgREST. The API server is the only
-- client: it calls PostgREST as authenticated (the user's JWT, so RLS
-- applies) or as service_role. So:
--
-- * anon gets nothing in public: no table, sequence or function privileges.
-- * authenticated may EXECUTE only the functions listed below: the RPCs the
--   API calls through the user client, the helpers RLS policies call, and
--   the SECURITY INVOKER helpers those call. Trigger functions and
--   service_role-only functions are revoked (a trigger does not need its
--   caller to hold EXECUTE). authenticated keeps its table grants; RLS
--   guards rows.
-- * service_role is not changed.
-- * Default privileges stop granting EXECUTE on new public functions to
--   anon and authenticated, and table/sequence privileges to anon. For the
--   postgres role (which applies these migrations) new functions in any
--   schema no longer get EXECUTE for PUBLIC either. Every new function must
--   GRANT EXECUTE explicitly to the roles that call it.
-- * pg_graphql is dropped when this role is allowed to; the app does not use
--   GraphQL. See the README for the manual step when it is not.
--
-- rls_auto_enable() exists on some databases outside this migration chain
-- (it backs an event trigger that turns RLS on for new tables). It is kept;
-- the loop below only removes the API's ability to call it.
--
-- Functions owned by extensions (uuid-ossp) are left alone: column defaults
-- such as uuid_generate_v4() run with the inserting role's privileges.
--
-- Rerunnable. Signatures missing from a partial schema are skipped, so the
-- CI reconciliation paths that apply this before 1000156/1000157 still work.

BEGIN;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END;
$$;

-- Keep this list in sync with supabase/tests/privilege_lockdown_integration.sql.
DO $$
DECLARE
  signature text;
  fn regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.accessible_classroom_ids(uuid,text)',
    'public.accessible_class_session_ids(uuid,text)',
    'public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text)',
    'public.apply_student_suspension(text,uuid,uuid,date,date,text,text,boolean,boolean)',
    'public.can_access_classroom(uuid,text)',
    'public.can_access_class_session(uuid,text)',
    'public.can_access_enrollment_scope(uuid,uuid,uuid,uuid,text)',
    'public.can_access_enrollment(uuid,text)',
    'public.can_access_occurrence_report(uuid)',
    'public.can_access_report(uuid,text)',
    'public.can_access_sensitive_student(uuid,text)',
    'public.can_access_single_lesson_transfer(uuid,text)',
    'public.can_access_student(uuid,text)',
    'public.can_access_teacher(uuid,text)',
    'public.cancel_single_lesson_transfer(uuid)',
    'public.can_create_occurrence_report(uuid,uuid)',
    'public.can_manage_editor_rbac()',
    'public.can_mutate_occurrence_report(uuid,text)',
    'public.can_teaching_resource_action_any_scope(text,text)',
    'public.can_teaching_resource_action(text,text)',
    'public.can_teaching_scope_action(text,text,uuid,uuid)',
    'public.current_rbac_policy_epoch()',
    'public.current_user_teacher_id()',
    'public.enrollment_history_access(text,jsonb)',
    'public.get_classrooms_overview(integer,integer,text,text,integer,integer,uuid)',
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
    'public.set_system_user_status(uuid,text,text,bigint)',
    'public.set_teacher_archived(uuid,boolean)',
    'public.sync_enrollment_reports(uuid,integer,date,boolean)',
    'public.sync_suspension_attendance(uuid,date,date,boolean)',
    'public.transfer_enrollment_class(uuid,uuid,date,text)',
    'public.transfer_single_lesson(uuid,uuid,uuid,uuid)',
    'public.update_student_sensitive(uuid,jsonb)',
    'public.update_teacher_profile(uuid,jsonb)',
    'public.update_teacher_sensitive(uuid,jsonb)'
  ] LOOP
    fn := pg_catalog.to_regprocedure(signature);
    IF fn IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END IF;
  END LOOP;
END;
$$;

-- Stop the next migration from reopening the gap. Default privileges belong
-- to the role that creates the object, so set them for every migration role
-- this session may act as.
DO $$
DECLARE
  owner_role text;
BEGIN
  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin', current_user] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = owner_role)
       AND pg_catalog.pg_has_role(current_user, owner_role, 'USAGE') THEN
      -- The PUBLIC default is global, not per schema. Only the application's
      -- migration role drops it; supabase_admin keeps it so functions that
      -- Supabase upgrades create in its own schemas stay callable.
      IF owner_role = 'postgres' THEN
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC';
      END IF;
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated', owner_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon', owner_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon', owner_role);
    END IF;
  END LOOP;
END;
$$;

COMMIT;

-- Outside the transaction: a failure here must not roll back the lockdown.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_graphql') THEN
    BEGIN
      DROP EXTENSION pg_graphql;
    EXCEPTION WHEN insufficient_privilege OR dependent_objects_still_exist THEN
      RAISE WARNING 'pg_graphql was not dropped (%). Run "DROP EXTENSION pg_graphql;" as supabase_admin.', SQLERRM;
    END;
  END IF;
END;
$$;
