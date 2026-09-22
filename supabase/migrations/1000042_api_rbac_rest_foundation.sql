-- Versioned REST/RBAC foundation. Safe to apply after 1000041.
-- This migration is additive and keeps legacy role/permission keys working.

ALTER TABLE public.permissions
  ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS resource text,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.permissions
  DROP CONSTRAINT IF EXISTS permissions_domain_check,
  ADD CONSTRAINT permissions_domain_check CHECK (domain IN ('system', 'teaching'));

ALTER TABLE public.permissions
  DROP CONSTRAINT IF EXISTS permissions_action_check,
  ADD CONSTRAINT permissions_action_check CHECK (action IS NULL OR length(btrim(action)) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS permissions_domain_resource_action_unique ON public.permissions(domain, resource, action) WHERE resource IS NOT NULL AND action IS NOT NULL;

UPDATE public.permissions
SET domain = CASE WHEN key LIKE 'reports.%' OR key LIKE 'teaching.%' THEN 'teaching' ELSE 'system' END,
    resource = COALESCE(resource, split_part(key, '.', 1)),
    action = COALESCE(action, NULLIF(split_part(key, '.', 2), ''))
WHERE resource IS NULL OR action IS NULL;

CREATE TABLE IF NOT EXISTS public.role_inheritance (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  parent_role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (role_id, parent_role_id),
  CONSTRAINT role_inheritance_no_self CHECK (role_id <> parent_role_id)
);

CREATE TABLE IF NOT EXISTS public.api_idempotency_keys (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  method text NOT NULL,
  route text NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()) + interval '24 hours',
  PRIMARY KEY (user_id, idempotency_key),
  CONSTRAINT api_idempotency_key_shape CHECK (length(idempotency_key) BETWEEN 8 AND 128)
);

CREATE INDEX IF NOT EXISTS api_idempotency_expiry_idx ON public.api_idempotency_keys(expires_at);
ALTER TABLE public.api_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_idempotency_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_idempotency_keys TO service_role;
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  domain text NOT NULL CHECK (domain IN ('system', 'teaching')),
  resource text NOT NULL,
  resource_id uuid,
  scope_id uuid,
  request_id text,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS audit_events_actor_created_idx ON public.audit_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_resource_created_idx ON public.audit_events(resource, resource_id, created_at DESC);

ALTER TABLE public.role_inheritance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "RBAC administrators manage role inheritance" ON public.role_inheritance;
CREATE POLICY "RBAC administrators manage role inheritance" ON public.role_inheritance FOR ALL TO authenticated USING (public.can_manage_editor_rbac()) WITH CHECK (public.can_manage_editor_rbac());
DROP POLICY IF EXISTS "Users read own audit events" ON public.audit_events;
CREATE POLICY "Users read own audit events" ON public.audit_events FOR SELECT TO authenticated USING (actor_user_id = auth.uid() OR public.can_manage_editor_rbac());

DROP POLICY IF EXISTS "Authenticated users can create custom roles" ON public.roles;
DROP POLICY IF EXISTS "Authenticated users can update custom roles" ON public.roles;
DROP POLICY IF EXISTS "Authenticated users can delete custom roles" ON public.roles;
DROP POLICY IF EXISTS "RBAC administrators can create custom roles" ON public.roles;
DROP POLICY IF EXISTS "RBAC administrators can update custom roles" ON public.roles;
DROP POLICY IF EXISTS "RBAC administrators can delete custom roles" ON public.roles;
CREATE POLICY "RBAC administrators can create custom roles" ON public.roles FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_editor_rbac() AND is_system = false);
CREATE POLICY "RBAC administrators can update custom roles" ON public.roles FOR UPDATE TO authenticated
  USING (public.can_manage_editor_rbac() AND is_system = false)
  WITH CHECK (public.can_manage_editor_rbac() AND is_system = false);
CREATE POLICY "RBAC administrators can delete custom roles" ON public.roles FOR DELETE TO authenticated
  USING (public.can_manage_editor_rbac() AND is_system = false);

REVOKE INSERT, UPDATE, DELETE ON public.audit_events FROM anon, authenticated;
GRANT SELECT ON public.audit_events, public.role_inheritance TO authenticated;
GRANT INSERT ON public.audit_events TO service_role;

INSERT INTO public.permissions (key, name, description, domain, resource, action) VALUES
  ('system.users.list', '列出使用者', '查詢系統使用者', 'system', 'users', 'list'),
  ('system.roles.manage', '管理角色', '建立與修改角色及角色繼承', 'system', 'roles', 'manage'),
  ('system.permissions.read', '讀取權限', '讀取可用權限定義', 'system', 'permissions', 'read'),
  ('system.audit.list', '讀取稽核事件', '讀取系統稽核事件', 'system', 'audit', 'list'),
  ('teaching.classrooms.list', '列出教室', '列出可存取教室', 'teaching', 'classrooms', 'list'),
  ('teaching.classrooms.manage', '管理教室', '管理教室資料', 'teaching', 'classrooms', 'manage'),
  ('teaching.class_sessions.list', '列出課堂', '列出可存取課堂', 'teaching', 'class_sessions', 'list'),
  ('teaching.students.list', '列出學生', '列出可存取學生', 'teaching', 'students', 'list'),
  ('teaching.reports.read', '讀取報告', '讀取可存取報告', 'teaching', 'reports', 'read'),
  ('teaching.reports.manage', '管理報告', '建立與修改報告', 'teaching', 'reports', 'manage')
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action, name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO public.permissions (key, name, description, domain, resource, action)
SELECT 'teaching.' || item.resource || '.' || item.action,
       initcap(replace(item.resource || ' ' || item.action, '_', ' ')),
       'REST API permission for ' || item.resource || ' ' || item.action,
       'teaching', item.resource, item.action
FROM (VALUES
  ('classrooms', 'create'), ('classrooms', 'read'), ('classrooms', 'update'), ('classrooms', 'delete'),
  ('class_sessions', 'create'), ('class_sessions', 'read'), ('class_sessions', 'update'), ('class_sessions', 'delete'),
  ('students', 'create'), ('students', 'read'), ('students', 'update'), ('students', 'delete'),
  ('reports', 'list'), ('reports', 'read')
) AS item(resource, action)
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action;
CREATE OR REPLACE FUNCTION public.reserve_api_idempotency(
  p_user_id uuid, p_key text, p_method text, p_route text
) RETURNS TABLE(is_replay boolean, response_status integer, response_body jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  DELETE FROM public.api_idempotency_keys WHERE expires_at < timezone('utc'::text, now());
  INSERT INTO public.api_idempotency_keys(user_id, idempotency_key, method, route)
  VALUES (p_user_id, p_key, p_method, p_route)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING;
  RETURN QUERY
  SELECT response_status IS NOT NULL, response_status, response_body
  FROM public.api_idempotency_keys
  WHERE user_id = p_user_id AND idempotency_key = p_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_api_idempotency(
  p_user_id uuid, p_key text, p_status integer, p_body jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  UPDATE public.api_idempotency_keys
  SET response_status = p_status, response_body = p_body
  WHERE user_id = p_user_id AND idempotency_key = p_key;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_api_idempotency(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_api_idempotency(uuid, text, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_api_idempotency(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_api_idempotency(uuid, text, integer, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) TO service_role, authenticated;
