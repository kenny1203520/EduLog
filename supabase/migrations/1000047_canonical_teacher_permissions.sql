-- Forward-only completion of the canonical teaching permission catalogue.
-- 1000043 intentionally remains immutable, but its original resource list
-- omitted teachers even though the scoped teacher RLS policies and API route
-- require teaching.teachers.* permission keys.

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR to_regclass('public.teaching_members') IS NULL
     OR to_regclass('public.teachers') IS NULL
     OR to_regprocedure('public.has_teaching_permission(uuid,text,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000047 prerequisites missing; apply migrations through 1000046 first';
  END IF;
END;
$$;

INSERT INTO public.permissions(key, name, description, domain, resource, action)
SELECT
  format('teaching.teachers.%s', action_name),
  initcap(action_name) || ' teachers',
  'Canonical teaching-domain teacher permission',
  'teaching',
  'teachers',
  action_name
FROM unnest(ARRAY['create', 'read', 'update', 'delete', 'list', 'manage']) AS actions(action_name)
ON CONFLICT (key) DO UPDATE
SET domain = EXCLUDED.domain,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action;

-- A teaching member role is evaluated only in the requested teaching by
-- resolve_teaching_permission. The system-scoped policy therefore grants the
-- teaching_owner role its authority without becoming a cross-teaching bypass.
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
JOIN public.permissions permission
  ON permission.key LIKE 'teaching.teachers.%'
WHERE owner_role.code = 'teaching_owner'
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.permissions
      WHERE domain = 'teaching' AND resource = 'teachers'
        AND action IN ('create', 'read', 'update', 'delete', 'list', 'manage')) <> 6 THEN
    RAISE EXCEPTION '1000047 canonical teacher permission catalogue is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.roles role
    JOIN public.role_permission_policies policy ON policy.role_id = role.id
    JOIN public.permissions permission ON permission.id = policy.permission_id
    WHERE role.code = 'teaching_owner'
      AND permission.key = 'teaching.teachers.list'
      AND policy.effect = 'allow'
  ) THEN
    RAISE EXCEPTION '1000047 teaching_owner teacher-list policy is missing';
  END IF;
END;
$$;
