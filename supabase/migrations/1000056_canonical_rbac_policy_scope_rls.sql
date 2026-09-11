-- Forward-only RBAC policy-management boundary.
-- Policy replacement is executed as SECURITY INVOKER, so the table RLS
-- boundary must authorize the same system/teaching/classroom/session scopes
-- as the API and the replacement RPC.

DO $$
BEGIN
  IF to_regclass('public.role_permission_policies') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL
     OR to_regprocedure('public.has_system_permission(uuid,text)') IS NULL
     OR to_regprocedure('public.has_teaching_permission(uuid,text,uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000056 prerequisites missing; apply migrations through 1000055 first';
  END IF;
END;
$$;

-- Canonical system permissions are aliases for the historical RBAC admin
-- capability. Copying the existing system-scoped decisions preserves already
-- deployed administrators while giving the API one permission vocabulary.
INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES
  ('system.roles.manage', 'Manage system roles', 'Manage system RBAC roles and scoped policies', 'system', 'roles', 'manage'),
  ('system.permissions.read', 'Read system permissions', 'Read the canonical permission catalogue', 'system', 'permissions', 'read'),
  ('system.audit.list', 'List audit events', 'Read audit events visible to the system administrator', 'system', 'audit', 'list'),
  ('system.users.list', 'List users', 'List users for system administration', 'system', 'users', 'list')
ON CONFLICT (key) DO UPDATE
SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT legacy.role_id, canonical.id, 'system', NULL, legacy.effect
FROM public.role_permission_policies legacy
JOIN public.permissions historical ON historical.id = legacy.permission_id
JOIN public.permissions canonical ON canonical.key IN (
  CASE historical.key
    WHEN 'rbac.manage' THEN 'system.roles.manage'
    WHEN 'permissions.read' THEN 'system.permissions.read'
    WHEN 'audit.read' THEN 'system.audit.list'
    WHEN 'users.read' THEN 'system.users.list'
  END
)
WHERE legacy.scope_type = 'system'
  AND historical.key IN ('rbac.manage', 'permissions.read', 'audit.read', 'users.read')
ON CONFLICT DO NOTHING;

-- The historical implementation returned zero rows when no policy matched.
-- A scalar permission helper must return false, never NULL/no-row, so every
-- system authorization branch fails closed.
CREATE OR REPLACE FUNCTION public.has_system_permission(
  p_user_id uuid,
  p_permission_key text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH RECURSIVE assigned_roles(role_id) AS (
  SELECT assignment.role_id
  FROM public.user_role_assignments assignment
  WHERE assignment.user_id = p_user_id
    AND assignment.scope_type = 'system'
    AND assignment.effective_from <= CURRENT_DATE
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
), role_tree(role_id) AS (
  SELECT role_id FROM assigned_roles
  UNION
  SELECT inheritance.parent_role_id
  FROM public.role_inheritance inheritance
  JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect
  FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  WHERE policy.role_id IN (SELECT role_id FROM role_tree)
    AND policy.scope_type = 'system'
    AND permission.key = p_permission_key
)
SELECT auth.role() = 'service_role'
  OR (
    auth.uid() = p_user_id
    AND COALESCE((SELECT bool_or(effect = 'allow') FROM matched), false)
    AND NOT COALESCE((SELECT bool_or(effect = 'deny') FROM matched), false)
  );
$$;

-- Make the historical helper a compatibility alias of the canonical system
-- permission. It remains available to old policies, but no longer defines a
-- second authorization rule.
CREATE OR REPLACE FUNCTION public.can_manage_editor_rbac()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_system_permission(auth.uid(), 'system.roles.manage');
$$;

REVOKE ALL ON FUNCTION public.can_manage_editor_rbac() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_editor_rbac() TO authenticated;

DROP POLICY IF EXISTS "Editor admins can manage role policies" ON public.role_permission_policies;
DROP POLICY IF EXISTS "RBAC managers can manage role policies" ON public.role_permission_policies;
CREATE POLICY "RBAC managers can manage role policies"
ON public.role_permission_policies FOR ALL TO authenticated
USING (
  CASE scope_type
    WHEN 'system' THEN public.has_system_permission((select auth.uid()), 'system.roles.manage')
    WHEN 'teaching' THEN public.has_teaching_permission((select auth.uid()), 'teaching.members.manage', scope_id, NULL, NULL)
    WHEN 'classroom' THEN public.has_api_permission((select auth.uid()), 'teaching.members.manage', scope_id, NULL)
    WHEN 'class_session' THEN public.has_api_permission((select auth.uid()), 'teaching.members.manage', NULL, scope_id)
    ELSE false
  END
)
WITH CHECK (
  CASE scope_type
    WHEN 'system' THEN public.has_system_permission((select auth.uid()), 'system.roles.manage')
    WHEN 'teaching' THEN public.has_teaching_permission((select auth.uid()), 'teaching.members.manage', scope_id, NULL, NULL)
    WHEN 'classroom' THEN public.has_api_permission((select auth.uid()), 'teaching.members.manage', scope_id, NULL)
    WHEN 'class_session' THEN public.has_api_permission((select auth.uid()), 'teaching.members.manage', NULL, scope_id)
    ELSE false
  END
);

DROP POLICY IF EXISTS "Editor admins can manage role assignments" ON public.user_role_assignments;
DROP POLICY IF EXISTS "RBAC managers can manage role assignments" ON public.user_role_assignments;
CREATE POLICY "RBAC managers can manage role assignments"
ON public.user_role_assignments FOR ALL TO authenticated
USING (
  CASE scope_type
    WHEN 'system' THEN public.has_system_permission((select auth.uid()), 'system.roles.manage')
    WHEN 'teaching' THEN public.has_teaching_permission((select auth.uid()), 'teaching.members.manage', scope_id, NULL, NULL)
    WHEN 'classroom' THEN public.has_api_permission((select auth.uid()), 'teaching.members.manage', scope_id, NULL)
    WHEN 'class_session' THEN public.has_api_permission((select auth.uid()), 'teaching.members.manage', NULL, scope_id)
    ELSE false
  END
)
WITH CHECK (
  CASE scope_type
    WHEN 'system' THEN public.has_system_permission((select auth.uid()), 'system.roles.manage')
    WHEN 'teaching' THEN public.has_teaching_permission((select auth.uid()), 'teaching.members.manage', scope_id, NULL, NULL)
    WHEN 'classroom' THEN public.has_api_permission((select auth.uid()), 'teaching.members.manage', scope_id, NULL)
    WHEN 'class_session' THEN public.has_api_permission((select auth.uid()), 'teaching.members.manage', NULL, scope_id)
    ELSE false
  END
);

-- Keep the RPC guard in lockstep with the table policy. The RPC is invoker
-- security by design; RLS below remains the final write boundary.
CREATE OR REPLACE FUNCTION public.replace_role_permission_policies(
  p_permission_key text, p_scope_type text, p_scope_id uuid, p_policies jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_permission_id uuid;
  v_allowed boolean := false;
BEGIN
  IF p_scope_type NOT IN ('system', 'teaching', 'classroom', 'class_session')
     OR (p_scope_type = 'system' AND p_scope_id IS NOT NULL)
     OR (p_scope_type <> 'system' AND p_scope_id IS NULL) THEN
    RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
  END IF;
  v_allowed := public.has_system_permission(auth.uid(), 'system.roles.manage');
  IF NOT v_allowed AND p_scope_type = 'teaching' THEN
    v_allowed := public.has_teaching_permission(auth.uid(), 'teaching.members.manage', p_scope_id, NULL, NULL);
  ELSIF NOT v_allowed AND p_scope_type = 'classroom' THEN
    v_allowed := public.has_api_permission(auth.uid(), 'teaching.members.manage', p_scope_id, NULL);
  ELSIF NOT v_allowed AND p_scope_type = 'class_session' THEN
    v_allowed := public.has_api_permission(auth.uid(), 'teaching.members.manage', NULL, p_scope_id);
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED'; END IF;
  IF p_scope_type = 'teaching' AND NOT EXISTS (SELECT 1 FROM public.teachings WHERE id = p_scope_id) THEN RAISE EXCEPTION 'INVALID_POLICY_SCOPE'; END IF;
  IF p_scope_type = 'classroom' AND NOT EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_scope_id) THEN RAISE EXCEPTION 'INVALID_POLICY_SCOPE'; END IF;
  IF p_scope_type = 'class_session' AND NOT EXISTS (SELECT 1 FROM public.class_sessions WHERE id = p_scope_id) THEN RAISE EXCEPTION 'INVALID_POLICY_SCOPE'; END IF;
  SELECT id INTO v_permission_id FROM public.permissions WHERE key = p_permission_key;
  IF v_permission_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PERMISSION'; END IF;
  DELETE FROM public.role_permission_policies
  WHERE permission_id = v_permission_id AND scope_type = p_scope_type AND scope_id IS NOT DISTINCT FROM p_scope_id;
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT (item->>'role_id')::uuid, v_permission_id, p_scope_type, p_scope_id, item->>'effect'
  FROM jsonb_array_elements(COALESCE(p_policies, '[]'::jsonb)) item
  WHERE item->>'effect' IN ('allow', 'deny');
END;
$$;

REVOKE ALL ON FUNCTION public.replace_role_permission_policies(text,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_role_permission_policies(text,text,uuid,jsonb) TO authenticated;

-- Audit visibility uses the same canonical system boundary. The actor-owned
-- read path remains available for a user's own audit records.
DROP POLICY IF EXISTS "Users read own audit events" ON public.audit_events;
CREATE POLICY "Users read own audit events" ON public.audit_events FOR SELECT TO authenticated
USING (actor_user_id = (select auth.uid()) OR public.has_system_permission((select auth.uid()), 'system.audit.list'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('role_permission_policies', 'user_role_assignments')
      AND policyname IN ('Editor admins can manage role policies', 'Editor admins can manage role assignments')
  ) THEN
    RAISE EXCEPTION '1000056 legacy RBAC policy remains';
  END IF;
END;
$$;
