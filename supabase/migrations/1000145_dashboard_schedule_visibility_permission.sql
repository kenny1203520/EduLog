-- Dashboard "today's schedule" visibility.
-- Users allowed one of these permissions see every scheduled occurrence that
-- RLS exposes; everyone else sees only the classes they are assigned to teach
-- on that date. Teaching and system roles live in separate RBAC domains, so the
-- capability is seeded once per domain and the API accepts either.

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL THEN
    RAISE EXCEPTION '1000145 prerequisites missing; apply migrations through 1000144 first';
  END IF;
END;
$$;

INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES
  ('teaching.dashboard.schedule.all', '查看所有今日課表', '允許在儀表板今日課表中查看所有課程，而非僅限自己授課的課程', 'teaching', 'dashboard', 'schedule_all'),
  ('system.dashboard.schedule.all', '查看所有今日課表', '允許系統角色在儀表板今日課表中查看所有課程', 'system', 'dashboard', 'schedule_all')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles role
JOIN public.permissions permission
  ON permission.domain = role.domain
 AND permission.key IN ('teaching.dashboard.schedule.all', 'system.dashboard.schedule.all')
WHERE role.is_builtin
  AND (
    (role.domain = 'system' AND role.code IN ('system_owner', 'system_admin'))
    OR (role.domain = 'teaching' AND role.code IN ('teaching_owner', 'teaching_manager'))
  )
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
