-- Make scoped RBAC policy replacement atomic when the caller is editing the
-- very permission that authorizes that replacement. The RPC validates the
-- caller and scope before entering its SECURITY DEFINER write section; direct
-- table access remains protected by the canonical RLS policies.

DO $$
BEGIN
  IF to_regclass('public.role_permission_policies') IS NULL
     OR to_regclass('public.permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.teachings') IS NULL
     OR to_regprocedure('public.rbac_scope_exists(text,uuid)') IS NULL
     OR to_regprocedure('public.has_system_permission(uuid,text)') IS NULL
     OR to_regprocedure('public.has_teaching_permission(uuid,text,uuid,uuid,uuid,date)') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000066 prerequisites missing; apply migrations through 1000065 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_role_permission_policies(
  p_permission_key text,
  p_scope_type text,
  p_scope_id uuid,
  p_policies jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_permission_id uuid;
  v_allowed boolean := false;
  v_user_id uuid := auth.uid();
  v_policies jsonb := COALESCE(p_policies, '[]'::jsonb);
BEGIN
  IF p_permission_key IS NULL OR length(p_permission_key) > 128 THEN
    RAISE EXCEPTION 'INVALID_PERMISSION_KEY';
  END IF;
  -- Fail closed before privilege checks or writes. rbac_scope_exists itself
  -- reveals only whether this caller may manage the exact requested scope.
  IF p_scope_type NOT IN ('system', 'teaching', 'classroom', 'class_session')
     OR (p_scope_type = 'system' AND p_scope_id IS NOT NULL)
     OR (p_scope_type <> 'system' AND p_scope_id IS NULL)
     OR NOT public.rbac_scope_exists(p_scope_type, p_scope_id) THEN
    RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
  END IF;

  -- Policy changes are low-volume administrative writes. A single transaction
  -- lock prevents concurrent replacements from invalidating the authorization
  -- basis between the scope check and the atomic rewrite.
  PERFORM pg_advisory_xact_lock(10066, 1);
  IF NOT public.rbac_scope_exists(p_scope_type, p_scope_id) THEN
    RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
  END IF;

  v_allowed := public.has_system_permission(v_user_id, 'system.roles.manage');
  IF NOT v_allowed AND p_scope_type = 'teaching' THEN
    v_allowed := public.has_teaching_permission(v_user_id, 'teaching.members.manage', p_scope_id, NULL, NULL);
  ELSIF NOT v_allowed AND p_scope_type = 'classroom' THEN
    v_allowed := public.has_api_permission(v_user_id, 'teaching.members.manage', p_scope_id, NULL);
  ELSIF NOT v_allowed AND p_scope_type = 'class_session' THEN
    v_allowed := public.has_api_permission(v_user_id, 'teaching.members.manage', NULL, p_scope_id);
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;

  IF jsonb_typeof(v_policies) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_POLICY_PAYLOAD';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_policies) AS item(value)
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
       OR (value - 'role_id' - 'effect') <> '{}'::jsonb
       OR NOT (value ? 'role_id')
       OR NOT (value ? 'effect')
       OR (value->>'role_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR value->>'effect' NOT IN ('allow', 'deny')
  ) THEN
    RAISE EXCEPTION 'INVALID_POLICY_PAYLOAD';
  END IF;
  IF EXISTS (
    SELECT value->>'role_id'
    FROM jsonb_array_elements(v_policies) AS item(value)
    GROUP BY value->>'role_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_POLICY_ROLE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_policies) AS item(value)
    LEFT JOIN public.roles role ON role.id = (value->>'role_id')::uuid
    WHERE role.id IS NULL
  ) THEN
    RAISE EXCEPTION 'UNKNOWN_ROLE';
  END IF;

  SELECT permission.id INTO v_permission_id
  FROM public.permissions permission
  WHERE permission.key = p_permission_key;
  IF v_permission_id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_PERMISSION';
  END IF;

  -- Definer rights avoid RLS invalidating the already-checked authorization
  -- halfway through the replacement. The transaction lock serializes callers.
  DELETE FROM public.role_permission_policies policy
  WHERE policy.permission_id = v_permission_id
    AND policy.scope_type = p_scope_type
    AND policy.scope_id IS NOT DISTINCT FROM p_scope_id;

  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT (item.value->>'role_id')::uuid,
         v_permission_id,
         p_scope_type,
         p_scope_id,
         item.value->>'effect'
  FROM jsonb_array_elements(v_policies) AS item(value);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_role_permission_policies(text,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_role_permission_policies(text,text,uuid,jsonb) TO authenticated, service_role;
