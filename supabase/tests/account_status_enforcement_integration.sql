\set ON_ERROR_STOP on

-- Regression for 1000165: an account that is not active holds no permission
-- in the database, and its extension tokens end when it stops being active.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO auth.users(id, email) VALUES
  ('16500000-0000-4000-8000-000000000001', 'status-admin@example.test'),
  ('16500000-0000-4000-8000-000000000002', 'status-teacher@example.test'),
  ('16500000-0000-4000-8000-000000000003', 'status-pending@example.test');
UPDATE public.profiles SET account_status = 'active'
WHERE auth_user_id IN ('16500000-0000-4000-8000-000000000001', '16500000-0000-4000-8000-000000000002');

INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
SELECT fixture.user_id, role.id, 'system', NULL, DATE '2020-01-01', 'active'
FROM (VALUES
  ('16500000-0000-4000-8000-000000000001'::uuid, 'system', 'system_owner'),
  ('16500000-0000-4000-8000-000000000002'::uuid, 'teaching', 'teacher'),
  ('16500000-0000-4000-8000-000000000003'::uuid, 'teaching', 'teacher')
) fixture(user_id, domain, code)
JOIN public.roles role ON role.code = fixture.code AND role.domain = fixture.domain;

INSERT INTO public.web_extension_tokens(id, user_id, extension_origin, token_hash) VALUES
  ('16500000-0000-4000-8000-0000000000e1', '16500000-0000-4000-8000-000000000002', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', repeat('a', 64)),
  ('16500000-0000-4000-8000-0000000000e2', '16500000-0000-4000-8000-000000000001', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', repeat('b', 64));

-- What the account can do, asked as that account.
CREATE FUNCTION pg_temp.holds(p_user uuid, p_key text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_result boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  v_result := public.has_api_permission(p_user, p_key, NULL, NULL);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN v_result;
END;
$$;
CREATE FUNCTION pg_temp.as_user(p_user uuid, p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_result boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  EXECUTE p_sql INTO v_result;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN v_result;
END;
$$;

DO $$
DECLARE
  admin constant uuid := '16500000-0000-4000-8000-000000000001';
  teacher constant uuid := '16500000-0000-4000-8000-000000000002';
  pending constant uuid := '16500000-0000-4000-8000-000000000003';
BEGIN
  IF NOT pg_temp.holds(teacher, 'teaching.students.list') THEN RAISE EXCEPTION 'active teacher lost its permission'; END IF;
  IF NOT pg_temp.holds(admin, 'system.users.manage') THEN RAISE EXCEPTION 'active owner lost its permission'; END IF;
  IF NOT pg_temp.as_user(admin, 'SELECT public.rbac_is_system_owner()') THEN RAISE EXCEPTION 'active owner is not an owner'; END IF;
  IF NOT pg_temp.as_user(teacher, 'SELECT public.has_active_teaching_role()') THEN RAISE EXCEPTION 'active teacher has no teaching role'; END IF;

  -- A pending account that was given a role early still holds nothing.
  IF pg_temp.holds(pending, 'teaching.students.list') THEN RAISE EXCEPTION 'pending account holds a permission'; END IF;
  IF pg_temp.as_user(pending, 'SELECT public.has_active_teaching_role()') THEN RAISE EXCEPTION 'pending account has a teaching role'; END IF;
  IF pg_temp.as_user(pending, $sql$SELECT public.has_teaching_permission_any_scope('16500000-0000-4000-8000-000000000003', 'teaching.students.access')$sql$) THEN
    RAISE EXCEPTION 'pending account may open a page';
  END IF;

  -- Disabling: the teacher by the owner, through the function the API calls.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', admin::text, true);
  PERFORM public.set_system_user_status(teacher, 'disabled', 'left the school', public.current_rbac_policy_epoch());
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  IF pg_temp.holds(teacher, 'teaching.students.list') THEN RAISE EXCEPTION 'disabled teacher kept its permission'; END IF;
  IF pg_temp.as_user(teacher, 'SELECT public.has_active_teaching_role()') THEN RAISE EXCEPTION 'disabled teacher kept its teaching role'; END IF;
  IF pg_temp.as_user(teacher, $sql$SELECT public.has_teaching_permission('16500000-0000-4000-8000-000000000002', 'teaching.students.list', NULL, NULL, NULL)$sql$) THEN
    RAISE EXCEPTION 'disabled teacher kept has_teaching_permission';
  END IF;
  IF (SELECT revoked_at FROM public.web_extension_tokens WHERE id = '16500000-0000-4000-8000-0000000000e1') IS NULL THEN
    RAISE EXCEPTION 'disabling did not revoke the extension token';
  END IF;
  IF (SELECT revoked_at FROM public.web_extension_tokens WHERE id = '16500000-0000-4000-8000-0000000000e2') IS NOT NULL THEN
    RAISE EXCEPTION 'another account lost its extension token';
  END IF;
  IF (SELECT count(*) FROM public.user_role_assignments WHERE user_id = teacher) <> 1 THEN
    RAISE EXCEPTION 'disabling removed the role assignment';
  END IF;

  -- Enabling again restores the permission; the token stays revoked.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', admin::text, true);
  PERFORM public.set_system_user_status(teacher, 'active', NULL, public.current_rbac_policy_epoch());
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF NOT pg_temp.holds(teacher, 'teaching.students.list') THEN RAISE EXCEPTION 'enabled teacher did not regain its permission'; END IF;
  IF (SELECT revoked_at FROM public.web_extension_tokens WHERE id = '16500000-0000-4000-8000-0000000000e1') IS NULL THEN
    RAISE EXCEPTION 'enabling restored a revoked extension token';
  END IF;

  -- A disabled owner is no longer an owner, and holds no system permission.
  UPDATE public.profiles SET account_status = 'disabled', disabled_at = now(), disabled_by = teacher, disabled_reason = 'test'
  WHERE auth_user_id = admin;
  IF pg_temp.holds(admin, 'system.users.manage') THEN RAISE EXCEPTION 'disabled owner kept its permission'; END IF;
  IF pg_temp.as_user(admin, 'SELECT public.rbac_is_system_owner()') THEN RAISE EXCEPTION 'disabled owner is still an owner'; END IF;
  IF (SELECT revoked_at FROM public.web_extension_tokens WHERE id = '16500000-0000-4000-8000-0000000000e2') IS NULL THEN
    RAISE EXCEPTION 'a direct status change did not revoke the extension token';
  END IF;

  -- The service role is not an account.
  IF NOT public.has_api_permission(admin, 'system.users.manage', NULL, NULL) THEN RAISE EXCEPTION 'service role was refused'; END IF;
END;
$$;

ROLLBACK;
