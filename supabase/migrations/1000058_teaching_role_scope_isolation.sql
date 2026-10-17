-- Forward-only RBAC scope isolation.
-- A role assigned through teaching_members must not inherit a system-scoped
-- teaching permission. System-scoped policies apply only to system-scoped role
-- assignments; scoped role policies apply to their explicit scope.

DO $$
BEGIN
  IF to_regclass('public.teachings') IS NULL
     OR to_regclass('public.teaching_members') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR to_regclass('public.role_inheritance') IS NULL
     OR to_regprocedure('public.resolve_teaching_permission(uuid,text,uuid,uuid,uuid,date)') IS NULL THEN
    RAISE EXCEPTION '1000058 prerequisites missing; apply migrations through 1000057 first';
  END IF;
END;
$$;

-- Move the reconciliation role's teaching permissions out of the global
-- policy scope. Existing teachings receive explicit policies, and the trigger
-- below provisions the same policies for future teachings.
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT policy.role_id, policy.permission_id, 'teaching', teaching.id, policy.effect
FROM public.role_permission_policies policy
JOIN public.roles role ON role.id = policy.role_id AND role.code = 'teaching_owner'
JOIN public.permissions permission ON permission.id = policy.permission_id AND permission.domain = 'teaching'
CROSS JOIN public.teachings teaching
WHERE policy.scope_type = 'system'
ON CONFLICT DO NOTHING;

DELETE FROM public.role_permission_policies policy
USING public.roles role, public.permissions permission
WHERE policy.role_id = role.id
  AND policy.permission_id = permission.id
  AND role.code = 'teaching_owner'
  AND permission.domain = 'teaching'
  AND policy.scope_type = 'system';

CREATE OR REPLACE FUNCTION public.ensure_teaching_owner_policies()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT role.id, permission.id, 'teaching', NEW.id, 'allow'
  FROM public.roles role
  CROSS JOIN public.permissions permission
  WHERE role.code = 'teaching_owner'
    AND permission.domain = 'teaching'
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_teaching_owner_policies ON public.teachings;
CREATE TRIGGER ensure_teaching_owner_policies
AFTER INSERT ON public.teachings
FOR EACH ROW EXECUTE FUNCTION public.ensure_teaching_owner_policies();

CREATE OR REPLACE FUNCTION public.resolve_teaching_permission(
  p_user_id uuid, p_permission_key text, p_teaching_id uuid,
  p_classroom_id uuid DEFAULT NULL, p_class_session_id uuid DEFAULT NULL,
  p_effective_date date DEFAULT CURRENT_DATE
) RETURNS TABLE(is_allowed boolean, is_denied boolean, policy_configured boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH RECURSIVE assigned_roles(role_id, source_scope_type, source_scope_id) AS (
  SELECT assignment.role_id, assignment.scope_type, assignment.scope_id
  FROM public.user_role_assignments assignment
  WHERE assignment.user_id = p_user_id
    AND assignment.effective_from <= p_effective_date
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_effective_date)
    AND (
      assignment.scope_type = 'system'
      OR (assignment.scope_type = 'teaching' AND assignment.scope_id = p_teaching_id)
      OR (assignment.scope_type = 'classroom' AND assignment.scope_id = p_classroom_id)
      OR (assignment.scope_type = 'class_session' AND assignment.scope_id = p_class_session_id)
    )
  UNION
  SELECT member.role_id, 'teaching', member.teaching_id
  FROM public.teaching_members member
  WHERE member.teaching_id = p_teaching_id
    AND member.user_id = p_user_id
    AND member.status = 'active'
    AND member.effective_from <= p_effective_date
    AND (member.effective_to IS NULL OR member.effective_to >= p_effective_date)
), role_tree(role_id, source_scope_type, source_scope_id) AS (
  SELECT role_id, source_scope_type, source_scope_id FROM assigned_roles WHERE role_id IS NOT NULL
  UNION
  SELECT inheritance.parent_role_id, child.source_scope_type, child.source_scope_id
  FROM public.role_inheritance inheritance
  JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect
  FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  JOIN role_tree role ON role.role_id = policy.role_id
  WHERE permission.key = p_permission_key
    AND (
      (policy.scope_type = 'system' AND role.source_scope_type = 'system')
      OR (policy.scope_type = 'teaching' AND (
        role.source_scope_type = 'system'
        OR (role.source_scope_type = 'teaching' AND role.source_scope_id = p_teaching_id)
        OR (role.source_scope_type = 'classroom' AND role.source_scope_id = p_classroom_id)
        OR (role.source_scope_type = 'class_session' AND role.source_scope_id = p_class_session_id)
      ))
      OR (policy.scope_type = 'classroom' AND policy.scope_id = p_classroom_id)
      OR (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
    )
)
SELECT
  COALESCE(bool_or(matched.effect = 'allow'), false)
    AND NOT COALESCE(bool_or(matched.effect = 'deny'), false),
  COALESCE(bool_or(matched.effect = 'deny'), false),
  EXISTS (SELECT 1 FROM matched)
FROM matched;
$$;

REVOKE ALL ON FUNCTION public.ensure_teaching_owner_policies() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_teaching_permission(uuid,text,uuid,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_teaching_permission(uuid,text,uuid,uuid,uuid,date) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.role_permission_policies policy
    JOIN public.roles role ON role.id = policy.role_id
    JOIN public.permissions permission ON permission.id = policy.permission_id
    WHERE role.code = 'teaching_owner'
      AND permission.domain = 'teaching'
      AND policy.scope_type = 'system'
  ) THEN
    RAISE EXCEPTION '1000058 teaching_owner teaching policy remains system-scoped';
  END IF;
END;
$$;
