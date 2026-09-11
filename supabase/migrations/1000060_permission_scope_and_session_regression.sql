-- Forward-only authorization boundary hardening.
-- Keep 1000001-1000059 immutable.  This migration closes two remaining
-- scope ambiguities: global holiday mutations are system-only, and a
-- classroom/session permission is always evaluated against that resource's
-- canonical teaching.

DO $$
BEGIN
  IF to_regclass('public.teachings') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.teaching_members') IS NULL
     OR to_regprocedure('public.has_system_permission(uuid,text)') IS NULL
     OR to_regprocedure('public.has_teaching_permission(uuid,text,uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000060 prerequisites missing; apply migrations through 1000059 first';
  END IF;
END;
$$;

-- Avoid the zero-row result of an outer FROM matched query.  A scalar
-- permission helper must return false, not NULL, when no policy matches.
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
    AND COALESCE((SELECT bool_or(matched.effect = 'allow') FROM matched), false)
    AND NOT COALESCE((SELECT bool_or(matched.effect = 'deny') FROM matched), false)
  );
$$;

-- Scoped resources never use a no-scope shortcut.  The join conditions bind
-- both IDs to one teaching before the canonical teaching resolver is called.
CREATE OR REPLACE FUNCTION public.has_api_permission(
  p_user_id uuid,
  p_permission_key text,
  p_classroom_id uuid DEFAULT NULL,
  p_class_session_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN true
    WHEN auth.uid() IS NULL OR auth.uid() <> p_user_id THEN false
    WHEN p_classroom_id IS NOT NULL AND p_class_session_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.classrooms classroom
      JOIN public.class_sessions session
        ON session.id = p_class_session_id
       AND session.teaching_id = classroom.teaching_id
      WHERE classroom.id = p_classroom_id
        AND public.has_teaching_permission(
          p_user_id, p_permission_key, classroom.teaching_id,
          p_classroom_id, p_class_session_id
        )
    )
    WHEN p_classroom_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.classrooms classroom
      WHERE classroom.id = p_classroom_id
        AND public.has_teaching_permission(
          p_user_id, p_permission_key, classroom.teaching_id,
          p_classroom_id, NULL
        )
    )
    WHEN p_class_session_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.class_sessions session
      WHERE session.id = p_class_session_id
        AND public.has_teaching_permission(
          p_user_id, p_permission_key, session.teaching_id,
          NULL, p_class_session_id
        )
    )
    WHEN p_permission_key LIKE 'system.%' THEN public.has_system_permission(p_user_id, p_permission_key)
    WHEN p_permission_key IN (
      'teaching.holidays.read',
      'teaching.holidays.list'
    ) THEN public.has_system_permission(p_user_id, p_permission_key)
    WHEN p_permission_key IN (
      'teaching.holidays.create',
      'teaching.holidays.update',
      'teaching.holidays.delete'
    ) THEN public.has_system_permission(p_user_id, p_permission_key)
    WHEN p_permission_key = 'teaching.teachings.create' THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.teaching_members member
      WHERE member.user_id = p_user_id
        AND member.status = 'active'
        AND member.effective_from <= CURRENT_DATE
        AND (member.effective_to IS NULL OR member.effective_to >= CURRENT_DATE)
        AND public.has_teaching_permission(
          p_user_id, p_permission_key, member.teaching_id, NULL, NULL
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.has_system_permission(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_system_permission(uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_api_permission(uuid,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_api_permission(uuid,text,uuid,uuid) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.role_permission_policies policy
    JOIN public.permissions permission ON permission.id = policy.permission_id
    WHERE policy.scope_type = 'system'
      AND permission.key IN (
        'teaching.holidays.create',
        'teaching.holidays.update',
        'teaching.holidays.delete'
      )
  ) THEN
    -- System-scoped holiday permissions remain valid for the global row.  A
    -- teaching-only membership is intentionally not sufficient because the
    -- no-scope branch above is system-only for these mutation actions.
    NULL;
  END IF;
END;
$$;
