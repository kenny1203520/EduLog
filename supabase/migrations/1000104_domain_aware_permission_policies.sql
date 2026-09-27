-- Keep permission-policy authorization aligned with the permission and role
-- domain. A platform teaching policy is stored at scope_type='system', but it
-- is still governed by teaching.roles.manage.

CREATE OR REPLACE FUNCTION public.rbac_scope_exists(p_scope_type text, p_scope_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE p_scope_type
    WHEN 'system' THEN
      p_scope_id IS NULL
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, NULL)
      )
    WHEN 'teaching' THEN
      EXISTS (SELECT 1 FROM public.teachings WHERE id = p_scope_id)
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, NULL)
        OR public.has_teaching_permission(auth.uid(), 'teaching.members.manage', p_scope_id, NULL, NULL)
      )
    WHEN 'classroom' THEN
      EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_scope_id)
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL)
        OR public.has_api_permission(auth.uid(), 'teaching.members.manage', p_scope_id, NULL)
      )
    WHEN 'class_session' THEN
      EXISTS (SELECT 1 FROM public.class_sessions WHERE id = p_scope_id)
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, p_scope_id)
        OR public.has_api_permission(auth.uid(), 'teaching.members.manage', NULL, p_scope_id)
      )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.replace_role_permission_policies(
  p_permission_key text,
  p_scope_type text,
  p_scope_id uuid,
  p_policies jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_permission public.permissions;
  v_allowed boolean := false;
  v_user_id uuid := auth.uid();
  v_policies jsonb := COALESCE(p_policies, '[]'::jsonb);
BEGIN
  IF p_permission_key IS NULL OR length(p_permission_key) > 128 THEN
    RAISE EXCEPTION 'INVALID_PERMISSION_KEY';
  END IF;
  IF p_scope_type NOT IN ('system', 'classroom', 'class_session')
     OR (p_scope_type = 'system' AND p_scope_id IS NOT NULL)
     OR (p_scope_type <> 'system' AND p_scope_id IS NULL)
     OR NOT public.rbac_scope_exists(p_scope_type, p_scope_id) THEN
    RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
  END IF;

  PERFORM pg_advisory_xact_lock(10066, 1);
  IF NOT public.rbac_scope_exists(p_scope_type, p_scope_id) THEN
    RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
  END IF;

  SELECT * INTO v_permission
  FROM public.permissions
  WHERE key = p_permission_key;
  IF v_permission.id IS NULL OR v_permission.domain NOT IN ('system', 'teaching') THEN
    RAISE EXCEPTION 'UNKNOWN_PERMISSION';
  END IF;
  IF (v_permission.domain = 'system' AND p_scope_type <> 'system') THEN
    RAISE EXCEPTION 'RBAC_SCOPE_DOMAIN_MISMATCH';
  END IF;

  IF v_permission.domain = 'system' THEN
    v_allowed := public.has_system_permission(v_user_id, 'system.roles.manage');
  ELSIF p_scope_type = 'system' THEN
    v_allowed := public.has_api_permission(v_user_id, 'teaching.roles.manage', NULL, NULL);
  ELSIF p_scope_type = 'classroom' THEN
    v_allowed := public.has_api_permission(v_user_id, 'teaching.roles.manage', p_scope_id, NULL);
  ELSE
    v_allowed := public.has_api_permission(v_user_id, 'teaching.roles.manage', NULL, p_scope_id);
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;

  IF jsonb_typeof(v_policies) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_POLICY_PAYLOAD';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_policies) AS item(value)
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
    WHERE role.id IS NULL OR role.domain <> v_permission.domain
  ) THEN
    RAISE EXCEPTION 'RBAC_DOMAIN_MISMATCH';
  END IF;

  DELETE FROM public.role_permission_policies policy
  WHERE policy.permission_id = v_permission.id
    AND policy.scope_type = p_scope_type
    AND policy.scope_id IS NOT DISTINCT FROM p_scope_id;

  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT (item.value->>'role_id')::uuid,
         v_permission.id,
         p_scope_type,
         p_scope_id,
         item.value->>'effect'
  FROM jsonb_array_elements(v_policies) AS item(value);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_role_permission_policies(text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_role_permission_policies(text, text, uuid, jsonb) TO authenticated, service_role;

DROP POLICY IF EXISTS "RBAC managers can manage role policies" ON public.role_permission_policies;
DROP POLICY IF EXISTS "RBAC managers can read role policies" ON public.role_permission_policies;

CREATE POLICY "RBAC managers can read role policies"
ON public.role_permission_policies FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.roles role
    JOIN public.permissions permission ON permission.id = role_permission_policies.permission_id
    WHERE role.id = role_permission_policies.role_id
      AND role.domain = permission.domain
      AND CASE
        WHEN role.domain = 'system' AND role_permission_policies.scope_type = 'system'
          THEN public.has_system_permission((select auth.uid()), 'system.roles.read')
            OR public.has_system_permission((select auth.uid()), 'system.roles.manage')
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'system'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.read', NULL, NULL)
            OR public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'classroom'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.read', role_permission_policies.scope_id, NULL)
            OR public.has_api_permission((select auth.uid()), 'teaching.roles.manage', role_permission_policies.scope_id, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'class_session'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.read', NULL, role_permission_policies.scope_id)
            OR public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, role_permission_policies.scope_id)
        ELSE false
      END
  )
);

CREATE POLICY "RBAC managers can manage role policies"
ON public.role_permission_policies FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.roles role
    JOIN public.permissions permission ON permission.id = role_permission_policies.permission_id
    WHERE role.id = role_permission_policies.role_id
      AND role.domain = permission.domain
      AND CASE
        WHEN role.domain = 'system' AND role_permission_policies.scope_type = 'system'
          THEN public.has_system_permission((select auth.uid()), 'system.roles.manage')
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'system'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'classroom'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', role_permission_policies.scope_id, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'class_session'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, role_permission_policies.scope_id)
        ELSE false
      END
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roles role
    JOIN public.permissions permission ON permission.id = role_permission_policies.permission_id
    WHERE role.id = role_permission_policies.role_id
      AND role.domain = permission.domain
      AND CASE
        WHEN role.domain = 'system' AND role_permission_policies.scope_type = 'system'
          THEN public.has_system_permission((select auth.uid()), 'system.roles.manage')
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'system'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'classroom'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', role_permission_policies.scope_id, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'class_session'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, role_permission_policies.scope_id)
        ELSE false
      END
  )
);
