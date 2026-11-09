-- Page access permissions and the built-in `member` teaching role.
--
-- Page entry used to be gated by each resource's `.list` permission, so a
-- user could not open a page unless they also held data access somewhere.
-- This migration separates the two:
--
-- * `teaching.<page>.access` grants page entry only. The page RPCs still
--   filter rows by the caller's list/read scope, so access alone returns
--   empty lists.
-- * The built-in `member` role (基本成員) holds the six access permissions at
--   platform scope and nothing else. New accounts are not assigned it and
--   existing users are not backfilled.
-- * Every existing teaching role that holds an allow for the matching `.list`
--   receives `.access` on the same policy scope, so nobody loses a page.
--   The dashboard follows `reports.list`, which gated it before.
--
-- The overview RPCs (students, classrooms, courses, holidays, incomplete
-- reports, dashboard counts) only raise for authentication and argument
-- errors; a caller without any list/read scope already receives empty
-- results. supabase/tests/member_role_integration.sql asserts that.
--
-- Rerunnable: upserts, ON CONFLICT DO NOTHING and CREATE OR REPLACE only.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('public.has_teaching_permission_any_scope(uuid,text)') IS NULL
     OR to_regprocedure('public.get_my_teaching_capabilities()') IS NULL THEN
    RAISE EXCEPTION '1000161 prerequisites missing; apply migrations through 1000160 first';
  END IF;
END;
$$;

-- 1. Page access permissions.

INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES
  ('teaching.dashboard.access', 'Open dashboard', 'Open the dashboard page; data still follows list/read scope', 'teaching', 'dashboard', 'access'),
  ('teaching.students.access', 'Open students page', 'Open the students page; data still follows list/read scope', 'teaching', 'students', 'access'),
  ('teaching.courses.access', 'Open courses page', 'Open the courses page; data still follows list/read scope', 'teaching', 'courses', 'access'),
  ('teaching.classrooms.access', 'Open classrooms page', 'Open the classrooms page; data still follows list/read scope', 'teaching', 'classrooms', 'access'),
  ('teaching.holidays.access', 'Open holidays page', 'Open the holidays page; data still follows list/read scope', 'teaching', 'holidays', 'access'),
  ('teaching.reports.access', 'Open incomplete reports page', 'Open the incomplete reports page; data still follows list/read scope', 'teaching', 'reports', 'access')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action;

-- 2. Built-in member role. The second insert only lands when a custom role
-- already uses the name "Member"; when the first insert succeeded the code
-- conflict skips it.

INSERT INTO public.roles(code, name, description, is_system, sort_order, domain, teaching_id, is_builtin, is_protected)
VALUES ('member', 'Member', 'Opens the basic teaching pages without granting any data', true, 150, 'teaching', NULL, true, false)
ON CONFLICT DO NOTHING;
INSERT INTO public.roles(code, name, description, is_system, sort_order, domain, teaching_id, is_builtin, is_protected)
VALUES ('member', 'Member (built-in)', 'Opens the basic teaching pages without granting any data', true, 150, 'teaching', NULL, true, false)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.roles
    WHERE code = 'member' AND domain = 'teaching' AND is_builtin AND teaching_id IS NULL
  ) THEN
    RAISE EXCEPTION '1000161 could not create the built-in member role; a custom role already uses code "member"';
  END IF;
END;
$$;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles role
JOIN public.permissions permission ON permission.key IN (
  'teaching.dashboard.access', 'teaching.students.access', 'teaching.courses.access',
  'teaching.classrooms.access', 'teaching.holidays.access', 'teaching.reports.access'
)
WHERE role.code = 'member' AND role.domain = 'teaching' AND role.is_builtin
ON CONFLICT DO NOTHING;

-- 3. Existing roles keep their pages: copy each `.list` allow to `.access`
-- on the same scope. Covers built-in and custom teaching roles.

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT DISTINCT policy.role_id, access_permission.id, policy.scope_type, policy.scope_id, 'allow'
FROM (VALUES
  ('teaching.dashboard.access', 'teaching.reports.list'),
  ('teaching.students.access', 'teaching.students.list'),
  ('teaching.courses.access', 'teaching.courses.list'),
  ('teaching.classrooms.access', 'teaching.classrooms.list'),
  ('teaching.holidays.access', 'teaching.holidays.list'),
  ('teaching.reports.access', 'teaching.reports.list')
) mapping(access_key, list_key)
JOIN public.permissions list_permission ON list_permission.key = mapping.list_key
JOIN public.permissions access_permission ON access_permission.key = mapping.access_key
JOIN public.role_permission_policies policy
  ON policy.permission_id = list_permission.id AND policy.effect = 'allow'
JOIN public.roles role ON role.id = policy.role_id AND role.domain = 'teaching'
ON CONFLICT DO NOTHING;

-- 4. Navigation capabilities include the access keys.

CREATE OR REPLACE FUNCTION public.get_my_teaching_capabilities()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_keys text[] := ARRAY[
    'teaching.dashboard.access', 'teaching.students.access', 'teaching.courses.access',
    'teaching.classrooms.access', 'teaching.holidays.access', 'teaching.reports.access',
    'teaching.reports.list', 'teaching.reports.create', 'teaching.reports.update', 'teaching.reports.delete',
    'teaching.students.list', 'teaching.students.create', 'teaching.students.update', 'teaching.students.delete',
    'teaching.courses.list', 'teaching.courses.create', 'teaching.courses.update', 'teaching.courses.delete',
    'teaching.lessons.create', 'teaching.lessons.update', 'teaching.lessons.delete',
    'teaching.classrooms.list', 'teaching.classrooms.create', 'teaching.classrooms.update', 'teaching.classrooms.delete',
    'teaching.class_sessions.list', 'teaching.class_sessions.create', 'teaching.class_sessions.update', 'teaching.class_sessions.delete',
    'teaching.holidays.list', 'teaching.holidays.create', 'teaching.holidays.update', 'teaching.holidays.delete',
    'teaching.teachers.list', 'teaching.teachers.create', 'teaching.teachers.update', 'teaching.teachers.delete',
    'teaching.teachers.read_sensitive', 'teaching.teachers.update_sensitive',
    'teaching.roles.read', 'teaching.roles.manage', 'teaching.role_assignments.manage', 'teaching.permissions.read'
  ];
  v_key text;
  v_platform boolean;
  v_result jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  FOREACH v_key IN ARRAY v_keys LOOP
    v_platform := public.has_api_permission(v_user_id, v_key, NULL, NULL);
    v_result := v_result || jsonb_build_object(v_key, jsonb_build_object(
      'platform', v_platform,
      'any', v_platform OR public.has_teaching_permission_any_scope(v_user_id, v_key)
    ));
  END LOOP;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_teaching_capabilities() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_teaching_capabilities() TO authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.permissions WHERE action = 'access' AND domain = 'teaching'
      AND key IN ('teaching.dashboard.access', 'teaching.students.access', 'teaching.courses.access',
                  'teaching.classrooms.access', 'teaching.holidays.access', 'teaching.reports.access')) <> 6 THEN
    RAISE EXCEPTION '1000161 page access permission catalogue is incomplete';
  END IF;
  IF (SELECT count(*) FROM public.role_permission_policies policy
      JOIN public.roles role ON role.id = policy.role_id
      WHERE role.code = 'member' AND role.is_builtin) <> 6 THEN
    RAISE EXCEPTION '1000161 member role must hold exactly the six page access permissions';
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
