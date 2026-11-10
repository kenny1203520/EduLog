\set ON_ERROR_STOP on

-- Regression for 1000164: nobody grants what they do not hold.
-- * A protected role (an owner role) is assigned, and inherited from, by an
--   owner of that domain only.
-- * Assigning a role, inheriting from one, or adding a permission to a role
--   needs the caller to hold every permission that this hands out, at the
--   scope where it is handed out.
-- * Teaching roles are assigned with teaching.role_assignments.manage or
--   teaching.roles.manage; defining roles needs teaching.roles.manage.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO auth.users(id, email) VALUES
  ('16400000-0000-4000-8000-000000000001', 'ceiling-system-owner@example.test'),
  ('16400000-0000-4000-8000-000000000002', 'ceiling-system-admin@example.test'),
  ('16400000-0000-4000-8000-000000000003', 'ceiling-user-manager@example.test'),
  ('16400000-0000-4000-8000-000000000004', 'ceiling-teaching-owner@example.test'),
  ('16400000-0000-4000-8000-000000000005', 'ceiling-teaching-manager@example.test'),
  ('16400000-0000-4000-8000-000000000006', 'ceiling-classroom-manager@example.test'),
  ('16400000-0000-4000-8000-000000000007', 'ceiling-assigner@example.test'),
  ('16400000-0000-4000-8000-000000000008', 'ceiling-target@example.test');
UPDATE public.profiles SET account_status = 'active'
WHERE auth_user_id::text LIKE '16400000-0000-4000-8000-%';

INSERT INTO public.classrooms(id, name) VALUES
  ('16400000-0000-4000-8000-0000000000c1', 'Ceiling Classroom One'),
  ('16400000-0000-4000-8000-0000000000c2', 'Ceiling Classroom Two');

-- A custom teaching role that only assigns roles: no roles.manage.
INSERT INTO public.roles(id, code, name, is_system, sort_order, domain, teaching_id, is_builtin, is_protected)
VALUES ('16400000-0000-4000-8000-0000000000a1', 'ceiling_assigner', 'Ceiling assigner', false, 500, 'teaching', NULL, false, false),
       ('16400000-0000-4000-8000-0000000000a2', 'ceiling_custom', 'Ceiling custom', false, 500, 'teaching', NULL, false, false),
       ('16400000-0000-4000-8000-0000000000a3', 'ceiling_denied', 'Ceiling denied', false, 500, 'teaching', NULL, false, false);
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT '16400000-0000-4000-8000-0000000000a1', id, 'system', NULL, 'allow'
FROM public.permissions WHERE key IN ('teaching.role_assignments.manage', 'teaching.students.access');
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT '16400000-0000-4000-8000-0000000000a3', id, 'system', NULL, 'deny'
FROM public.permissions WHERE key = 'teaching.student_credentials.read';

INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
SELECT fixture.user_id, role.id, fixture.scope_type, fixture.scope_id, DATE '2020-01-01', 'active'
FROM (VALUES
  ('16400000-0000-4000-8000-000000000001'::uuid, 'system', 'system_owner', 'system', NULL::uuid),
  ('16400000-0000-4000-8000-000000000002'::uuid, 'system', 'system_admin', 'system', NULL::uuid),
  ('16400000-0000-4000-8000-000000000003'::uuid, 'system', 'user_manager', 'system', NULL::uuid),
  ('16400000-0000-4000-8000-000000000004'::uuid, 'teaching', 'teaching_owner', 'system', NULL::uuid),
  ('16400000-0000-4000-8000-000000000005'::uuid, 'teaching', 'teaching_manager', 'system', NULL::uuid),
  ('16400000-0000-4000-8000-000000000006'::uuid, 'teaching', 'teaching_manager', 'classroom', '16400000-0000-4000-8000-0000000000c1'::uuid),
  ('16400000-0000-4000-8000-000000000007'::uuid, 'teaching', 'ceiling_assigner', 'system', NULL::uuid)
) fixture(user_id, domain, code, scope_type, scope_id)
JOIN public.roles role ON role.code = fixture.code AND role.domain = fixture.domain;

-- Runs p_sql as p_user and returns the error it raised, or 'OK'.
CREATE FUNCTION pg_temp.attempt(p_user uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  BEGIN
    EXECUTE replace(p_sql, ':epoch', public.current_rbac_policy_epoch()::text);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    RETURN SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN 'OK';
END;
$$;
CREATE FUNCTION pg_temp.expect(p_label text, p_actual text, p_expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION '%: expected %, got %', p_label, p_expected, p_actual;
  END IF;
END;
$$;
CREATE FUNCTION pg_temp.role_id(p_domain text, p_code text) RETURNS text LANGUAGE sql AS $$
  SELECT quote_literal(id) FROM public.roles WHERE domain = p_domain AND code = p_code;
$$;
CREATE FUNCTION pg_temp.policy(p_key text, p_effect text) RETURNS text LANGUAGE sql AS $$
  SELECT quote_literal(jsonb_build_array(jsonb_build_object('permission_id', id, 'effect', p_effect))::text) || '::jsonb'
  FROM public.permissions WHERE key = p_key;
$$;

DO $$
DECLARE
  system_owner constant uuid := '16400000-0000-4000-8000-000000000001';
  system_admin constant uuid := '16400000-0000-4000-8000-000000000002';
  user_manager constant uuid := '16400000-0000-4000-8000-000000000003';
  teaching_owner constant uuid := '16400000-0000-4000-8000-000000000004';
  teaching_manager constant uuid := '16400000-0000-4000-8000-000000000005';
  classroom_manager constant uuid := '16400000-0000-4000-8000-000000000006';
  assigner constant uuid := '16400000-0000-4000-8000-000000000007';
  target constant text := quote_literal('16400000-0000-4000-8000-000000000008');
  classroom_one constant text := quote_literal('16400000-0000-4000-8000-0000000000c1');
  classroom_two constant text := quote_literal('16400000-0000-4000-8000-0000000000c2');
  custom constant text := quote_literal('16400000-0000-4000-8000-0000000000a2');
  denied constant text := quote_literal('16400000-0000-4000-8000-0000000000a3');
BEGIN
  -- Inheriting from an owner role is refused for everyone, by both routes.
  PERFORM pg_temp.expect('admin creates a role under system_owner', pg_temp.attempt(system_admin,
    format('SELECT public.rbac_create_role(''system'', NULL, ''shadow_owner'', ''Shadow'', NULL, %s, :epoch)', pg_temp.role_id('system', 'system_owner'))),
    'PROTECTED_ROLE_PARENT');
  PERFORM pg_temp.expect('admin creates a plain system role', pg_temp.attempt(system_admin,
    'SELECT public.rbac_create_role(''system'', NULL, ''ceiling_plain'', ''Plain'', NULL, NULL, :epoch)'), 'OK');
  PERFORM pg_temp.expect('admin re-parents a role under system_owner', pg_temp.attempt(system_admin,
    format('SELECT public.rbac_set_role_parent(%s, %s, :epoch)', pg_temp.role_id('system', 'ceiling_plain'), pg_temp.role_id('system', 'system_owner'))),
    'PROTECTED_ROLE_PARENT');
  PERFORM pg_temp.expect('owner creates a role under system_owner', pg_temp.attempt(system_owner,
    format('SELECT public.rbac_create_role(''system'', NULL, ''shadow_owner_2'', ''Shadow'', NULL, %s, :epoch)', pg_temp.role_id('system', 'system_owner'))),
    'PROTECTED_ROLE_PARENT');
  PERFORM pg_temp.expect('manager creates a role under teaching_owner', pg_temp.attempt(teaching_manager,
    format('SELECT public.rbac_create_role(''teaching'', NULL, ''shadow_teaching_owner'', ''Shadow'', NULL, %s, :epoch)', pg_temp.role_id('teaching', 'teaching_owner'))),
    'PROTECTED_ROLE_PARENT');
  PERFORM pg_temp.expect('manager creates a role under viewer', pg_temp.attempt(teaching_manager,
    format('SELECT public.rbac_create_role(''teaching'', NULL, ''ceiling_viewer_child'', ''Viewer child'', NULL, %s, :epoch)', pg_temp.role_id('teaching', 'viewer'))),
    'OK');

  -- System assignments: a user manager cannot hand out more than it holds.
  PERFORM pg_temp.expect('user manager makes itself system admin', pg_temp.attempt(user_manager,
    format('SELECT public.rbac_upsert_system_assignment(NULL, %L, %s, CURRENT_DATE, NULL, :epoch)', user_manager, pg_temp.role_id('system', 'system_admin'))),
    'GRANT_EXCEEDS_CALLER');
  PERFORM pg_temp.expect('user manager assigns user_manager', pg_temp.attempt(user_manager,
    format('SELECT public.rbac_upsert_system_assignment(NULL, %s, %s, CURRENT_DATE, NULL, :epoch)', target, pg_temp.role_id('system', 'user_manager'))),
    'OK');
  PERFORM pg_temp.expect('admin assigns system_owner', pg_temp.attempt(system_admin,
    format('SELECT public.rbac_upsert_system_assignment(NULL, %s, %s, CURRENT_DATE, NULL, :epoch)', target, pg_temp.role_id('system', 'system_owner'))),
    'OWNER_ROLE_REQUIRED');
  PERFORM pg_temp.expect('admin assigns system_admin', pg_temp.attempt(system_admin,
    format('SELECT public.rbac_upsert_system_assignment(NULL, %s, %s, CURRENT_DATE, NULL, :epoch)', target, pg_temp.role_id('system', 'system_admin'))),
    'OK');
  PERFORM pg_temp.expect('owner assigns system_owner', pg_temp.attempt(system_owner,
    format('SELECT public.rbac_upsert_system_assignment(NULL, %s, %s, CURRENT_DATE, NULL, :epoch)', target, pg_temp.role_id('system', 'system_owner'))),
    'OK');

  -- Teaching: the manager was seeded without the sensitive student groups.
  PERFORM pg_temp.expect('manager makes itself teaching owner', pg_temp.attempt(teaching_manager,
    format('SELECT public.rbac_upsert_platform_teaching_assignment(NULL, %L, %s, CURRENT_DATE, NULL, :epoch)', teaching_manager, pg_temp.role_id('teaching', 'teaching_owner'))),
    'OWNER_ROLE_REQUIRED');
  PERFORM pg_temp.expect('manager adds student credentials to a role', pg_temp.attempt(teaching_manager,
    format('SELECT public.rbac_replace_role_permissions(%s, ''system'', NULL, :epoch, %s)', custom, pg_temp.policy('teaching.student_credentials.read', 'allow'))),
    'GRANT_EXCEEDS_CALLER');
  PERFORM pg_temp.expect('manager adds a permission it holds', pg_temp.attempt(teaching_manager,
    format('SELECT public.rbac_replace_role_permissions(%s, ''system'', NULL, :epoch, %s)', custom, pg_temp.policy('teaching.students.read', 'allow'))),
    'OK');
  PERFORM pg_temp.expect('manager saves that role again unchanged', pg_temp.attempt(teaching_manager,
    format('SELECT public.rbac_replace_role_permissions(%s, ''system'', NULL, :epoch, %s)', custom, pg_temp.policy('teaching.students.read', 'allow'))),
    'OK');
  PERFORM pg_temp.expect('manager lifts a deny on a permission it lacks', pg_temp.attempt(teaching_manager,
    format('SELECT public.rbac_replace_role_permissions(%s, ''system'', NULL, :epoch, ''[]''::jsonb)', denied)),
    'GRANT_EXCEEDS_CALLER');
  PERFORM pg_temp.expect('owner adds student credentials to a role', pg_temp.attempt(teaching_owner,
    format('SELECT public.rbac_replace_role_permissions(%s, ''system'', NULL, :epoch, %s)', custom, pg_temp.policy('teaching.student_credentials.read', 'allow'))),
    'OK');
  PERFORM pg_temp.expect('manager assigns a role that now exceeds it', pg_temp.attempt(teaching_manager,
    format('SELECT public.rbac_upsert_platform_teaching_assignment(NULL, %s, %s, CURRENT_DATE, NULL, :epoch)', target, custom)),
    'GRANT_EXCEEDS_CALLER');
  PERFORM pg_temp.expect('manager assigns viewer', pg_temp.attempt(teaching_manager,
    format('SELECT public.rbac_upsert_platform_teaching_assignment(NULL, %s, %s, CURRENT_DATE, NULL, :epoch)', target, pg_temp.role_id('teaching', 'viewer'))),
    'OK');
  PERFORM pg_temp.expect('owner assigns teaching_owner', pg_temp.attempt(teaching_owner,
    format('SELECT public.rbac_upsert_platform_teaching_assignment(NULL, %s, %s, CURRENT_DATE, NULL, :epoch)', target, pg_temp.role_id('teaching', 'teaching_owner'))),
    'OK');

  -- Classroom scope: the same rules inside the classroom, nothing outside it.
  PERFORM pg_temp.expect('classroom manager assigns teaching_owner in its classroom', pg_temp.attempt(classroom_manager,
    format('SELECT public.rbac_upsert_scoped_teaching_assignment(NULL, %L, %s, ''classroom'', %s, CURRENT_DATE, NULL, :epoch)', classroom_manager, pg_temp.role_id('teaching', 'teaching_owner'), classroom_one)),
    'OWNER_ROLE_REQUIRED');
  PERFORM pg_temp.expect('classroom manager assigns the exceeding role in its classroom', pg_temp.attempt(classroom_manager,
    format('SELECT public.rbac_upsert_scoped_teaching_assignment(NULL, %s, %s, ''classroom'', %s, CURRENT_DATE, NULL, :epoch)', target, custom, classroom_one)),
    'GRANT_EXCEEDS_CALLER');
  PERFORM pg_temp.expect('classroom manager assigns viewer in its classroom', pg_temp.attempt(classroom_manager,
    format('SELECT public.rbac_upsert_scoped_teaching_assignment(NULL, %s, %s, ''classroom'', %s, CURRENT_DATE, NULL, :epoch)', target, pg_temp.role_id('teaching', 'viewer'), classroom_one)),
    'OK');
  PERFORM pg_temp.expect('classroom manager assigns viewer in another classroom', pg_temp.attempt(classroom_manager,
    format('SELECT public.rbac_upsert_scoped_teaching_assignment(NULL, %s, %s, ''classroom'', %s, CURRENT_DATE, NULL, :epoch)', target, pg_temp.role_id('teaching', 'viewer'), classroom_two)),
    'RBAC_MANAGE_REQUIRED');
  PERFORM pg_temp.expect('classroom manager adds student credentials in its classroom', pg_temp.attempt(classroom_manager,
    format('SELECT public.rbac_replace_role_permissions(%s, ''classroom'', %s, :epoch, %s)', pg_temp.role_id('teaching', 'viewer'), classroom_one, pg_temp.policy('teaching.student_credentials.read', 'allow'))),
    'GRANT_EXCEEDS_CALLER');

  -- role_assignments.manage assigns roles but does not define them.
  PERFORM pg_temp.expect('assigner assigns member-level access it holds', pg_temp.attempt(assigner,
    format('SELECT public.rbac_upsert_platform_teaching_assignment(NULL, %s, %s, CURRENT_DATE, NULL, :epoch)', target, quote_literal('16400000-0000-4000-8000-0000000000a1'))),
    'OK');
  PERFORM pg_temp.expect('assigner assigns teaching_manager', pg_temp.attempt(assigner,
    format('SELECT public.rbac_upsert_platform_teaching_assignment(NULL, %s, %s, CURRENT_DATE, NULL, :epoch)', target, pg_temp.role_id('teaching', 'teaching_manager'))),
    'GRANT_EXCEEDS_CALLER');
  PERFORM pg_temp.expect('assigner edits a role', pg_temp.attempt(assigner,
    format('SELECT public.rbac_replace_role_permissions(%s, ''system'', NULL, :epoch, ''[]''::jsonb)', custom)),
    'RBAC_MANAGE_REQUIRED');
END;
$$;

-- rbac_can_grant_role answers the same question for the API (account approval).
DO $$
DECLARE v_manager uuid; v_member uuid; v_owner uuid; v_admin uuid;
BEGIN
  SELECT id INTO v_manager FROM public.roles WHERE domain = 'teaching' AND code = 'teaching_manager';
  SELECT id INTO v_member FROM public.roles WHERE domain = 'teaching' AND code = 'member';
  SELECT id INTO v_owner FROM public.roles WHERE domain = 'teaching' AND code = 'teaching_owner';
  SELECT id INTO v_admin FROM public.roles WHERE domain = 'system' AND code = 'system_admin';

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '16400000-0000-4000-8000-000000000007', true);
  IF public.rbac_can_grant_role(v_manager) THEN RAISE EXCEPTION 'assigner may grant teaching_manager'; END IF;
  IF public.rbac_can_grant_role(v_owner) THEN RAISE EXCEPTION 'assigner may grant teaching_owner'; END IF;
  IF public.rbac_can_grant_role(v_admin) THEN RAISE EXCEPTION 'teaching assigner may grant a system role'; END IF;
  IF NOT public.rbac_can_grant_role('16400000-0000-4000-8000-0000000000a1') THEN RAISE EXCEPTION 'assigner may not grant what it holds'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '16400000-0000-4000-8000-000000000005', true);
  IF NOT public.rbac_can_grant_role(v_member) THEN RAISE EXCEPTION 'manager may not grant member'; END IF;
  IF public.rbac_can_grant_role(v_owner) THEN RAISE EXCEPTION 'manager may grant teaching_owner'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '16400000-0000-4000-8000-000000000004', true);
  IF NOT public.rbac_can_grant_role(v_owner) THEN RAISE EXCEPTION 'teaching owner may not grant teaching_owner'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '16400000-0000-4000-8000-000000000008', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

ROLLBACK;
