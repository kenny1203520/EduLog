-- Rebuild the RBAC catalogue into strict system and teaching domains.
-- Business data and memberships are preserved; legacy policy configuration is
-- intentionally reset once. Re-running this migration is non-destructive.

DO $$
BEGIN
  IF to_regclass('public.roles') IS NULL
     OR to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL
     OR to_regclass('public.role_inheritance') IS NULL
     OR to_regclass('public.teaching_members') IS NULL THEN
    RAISE EXCEPTION '1000081 prerequisites missing; apply migrations through 1000080 first';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.rbac_domain_rebuild_state (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
REVOKE ALL ON public.rbac_domain_rebuild_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rbac_domain_rebuild_state TO service_role;

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS teaching_id uuid REFERENCES public.teachings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_builtin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false;

UPDATE public.roles
SET domain = COALESCE(domain, 'teaching'),
    is_builtin = CASE WHEN code IS NOT NULL THEN true ELSE is_builtin END,
    is_system = CASE WHEN code IS NOT NULL THEN true ELSE is_system END
WHERE domain IS NULL OR (code IS NOT NULL AND NOT is_builtin);

ALTER TABLE public.roles ALTER COLUMN domain SET DEFAULT 'teaching';
ALTER TABLE public.roles ALTER COLUMN domain SET NOT NULL;
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_domain_check;
ALTER TABLE public.roles ADD CONSTRAINT roles_domain_check CHECK (domain IN ('system', 'teaching'));
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_domain_teaching_shape;
ALTER TABLE public.roles ADD CONSTRAINT roles_domain_teaching_shape CHECK (
  (domain = 'system' AND teaching_id IS NULL)
  OR (domain = 'teaching' AND (is_builtin OR teaching_id IS NOT NULL))
);
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_protected_builtin;
ALTER TABLE public.roles ADD CONSTRAINT roles_protected_builtin CHECK (NOT is_protected OR is_builtin);

DROP INDEX IF EXISTS public.roles_code_unique;
DROP INDEX IF EXISTS public.roles_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS roles_domain_code_unique
  ON public.roles(domain, (COALESCE(teaching_id, '00000000-0000-0000-0000-000000000000'::uuid)), code)
  WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roles_domain_name_unique
  ON public.roles(domain, (COALESCE(teaching_id, '00000000-0000-0000-0000-000000000000'::uuid)), (lower(btrim(name))));
CREATE INDEX IF NOT EXISTS roles_domain_teaching_idx ON public.roles(domain, teaching_id, sort_order, name);

INSERT INTO public.roles(code, name, description, is_system, sort_order, domain, teaching_id, is_builtin, is_protected)
VALUES
  ('system_owner', 'System Owner', 'Protected owner of the EduLog system', true, 10, 'system', NULL, true, true),
  ('system_admin', 'System Administrator', 'Manages system configuration without ownership transfer', true, 20, 'system', NULL, true, false),
  ('user_manager', 'User Manager', 'Manages users and system role assignments', true, 30, 'system', NULL, true, false),
  ('auditor', 'Auditor', 'Reads audit events and system metadata', true, 40, 'system', NULL, true, false),
  ('teaching_owner', 'Teaching Owner', 'Protected owner of a teaching workspace', true, 100, 'teaching', NULL, true, true),
  ('teaching_manager', 'Teaching Manager', 'Manages a teaching workspace, members, roles and resources', true, 110, 'teaching', NULL, true, false),
  ('teacher', 'Teacher', 'Creates and maintains teaching records', true, 120, 'teaching', NULL, true, false),
  ('assistant', 'Assistant', 'Supports teaching operations with limited write access', true, 130, 'teaching', NULL, true, false),
  ('viewer', 'Viewer', 'Read-only teaching workspace access', true, 140, 'teaching', NULL, true, false)
ON CONFLICT DO NOTHING;

UPDATE public.roles role
SET name = manifest.name,
    description = manifest.description,
    is_system = true,
    sort_order = manifest.sort_order,
    domain = manifest.domain,
    teaching_id = NULL,
    is_builtin = true,
    is_protected = manifest.is_protected
FROM (VALUES
  ('system_owner', 'System Owner', 'Protected owner of the EduLog system', 10, 'system', true),
  ('system_admin', 'System Administrator', 'Manages system configuration without ownership transfer', 20, 'system', false),
  ('user_manager', 'User Manager', 'Manages users and system role assignments', 30, 'system', false),
  ('auditor', 'Auditor', 'Reads audit events and system metadata', 40, 'system', false),
  ('teaching_owner', 'Teaching Owner', 'Protected owner of a teaching workspace', 100, 'teaching', true),
  ('teaching_manager', 'Teaching Manager', 'Manages a teaching workspace, members, roles and resources', 110, 'teaching', false),
  ('teacher', 'Teacher', 'Creates and maintains teaching records', 120, 'teaching', false),
  ('assistant', 'Assistant', 'Supports teaching operations with limited write access', 130, 'teaching', false),
  ('viewer', 'Viewer', 'Read-only teaching workspace access', 140, 'teaching', false)
) AS manifest(code, name, description, sort_order, domain, is_protected)
WHERE role.code = manifest.code;

-- Capture effective legacy system managers before the one-time reset. The CI
-- migration chain runs each file with psql autocommit, so preserve this
-- session-local snapshot until the reset block has consumed it.
CREATE TEMP TABLE IF NOT EXISTS rbac_legacy_system_managers(user_id uuid PRIMARY KEY) ON COMMIT PRESERVE ROWS;
TRUNCATE rbac_legacy_system_managers;
INSERT INTO rbac_legacy_system_managers(user_id)
WITH RECURSIVE assigned AS (
  SELECT assignment.user_id, assignment.role_id
  FROM public.user_role_assignments assignment
  WHERE assignment.scope_type = 'system'
    AND assignment.effective_from <= CURRENT_DATE
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
), role_tree(user_id, role_id) AS (
  SELECT user_id, role_id FROM assigned
  UNION
  SELECT tree.user_id, inheritance.parent_role_id
  FROM role_tree tree
  JOIN public.role_inheritance inheritance ON inheritance.role_id = tree.role_id
), decisions AS (
  SELECT tree.user_id,
         bool_or(policy.effect = 'allow') AS has_allow,
         bool_or(policy.effect = 'deny') AS has_deny
  FROM role_tree tree
  JOIN public.role_permission_policies policy ON policy.role_id = tree.role_id AND policy.scope_type = 'system'
  JOIN public.permissions permission ON permission.id = policy.permission_id
  WHERE permission.key IN ('system.roles.manage', 'rbac.manage')
  GROUP BY tree.user_id
)
SELECT user_id FROM decisions WHERE has_allow AND NOT has_deny
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_already_applied boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.rbac_domain_rebuild_state WHERE version = 1) INTO v_already_applied;
  IF NOT v_already_applied THEN
    DELETE FROM public.role_permission_policies;
    DELETE FROM public.role_inheritance;
    DELETE FROM public.user_role_assignments;

    UPDATE public.teaching_members member
    SET role_id = CASE
      WHEN teaching.owner_user_id = member.user_id THEN (SELECT id FROM public.roles WHERE code = 'teaching_owner' AND domain = 'teaching' AND is_builtin)
      WHEN (SELECT legacy.code FROM public.roles legacy WHERE legacy.id = member.role_id) IN ('instructor', 'learning_coach') THEN (SELECT id FROM public.roles WHERE code = 'teaching_manager' AND domain = 'teaching' AND is_builtin)
      WHEN (SELECT legacy.code FROM public.roles legacy WHERE legacy.id = member.role_id) IN ('assistant_instructor', 'coach', 'trainee_assistant', 'trainee_tutor') THEN (SELECT id FROM public.roles WHERE code = 'assistant' AND domain = 'teaching' AND is_builtin)
      ELSE (SELECT id FROM public.roles WHERE code = 'teacher' AND domain = 'teaching' AND is_builtin)
    END
    FROM public.teachings teaching
    WHERE teaching.id = member.teaching_id;

    UPDATE public.class_session_teachers
    SET role_id = (SELECT id FROM public.roles WHERE code = 'teacher' AND domain = 'teaching' AND is_builtin);

    DELETE FROM public.roles
    WHERE NOT (is_builtin AND code IN (
      'system_owner', 'system_admin', 'user_manager', 'auditor',
      'teaching_owner', 'teaching_manager', 'teacher', 'assistant', 'viewer'
    ));

    INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from)
    SELECT manager.user_id, role.id, 'system', NULL, CURRENT_DATE
    FROM rbac_legacy_system_managers manager
    CROSS JOIN public.roles role
    WHERE role.code = 'system_owner' AND role.domain = 'system'
    ON CONFLICT DO NOTHING;

    INSERT INTO public.rbac_domain_rebuild_state(version, summary)
    VALUES (1, jsonb_build_object(
      'legacy_system_managers', (SELECT count(*) FROM rbac_legacy_system_managers),
      'teaching_members', (SELECT count(*) FROM public.teaching_members),
      'class_session_teachers', (SELECT count(*) FROM public.class_session_teachers)
    ));
  END IF;
END;
$$;

ALTER TABLE public.teaching_members ALTER COLUMN role_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.rbac_scope_teaching_id(p_scope_type text, p_scope_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE p_scope_type
    WHEN 'teaching' THEN p_scope_id
    WHEN 'classroom' THEN (SELECT teaching_id FROM public.classrooms WHERE id=p_scope_id)
    WHEN 'class_session' THEN (SELECT teaching_id FROM public.class_sessions WHERE id=p_scope_id)
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.validate_teaching_member_role_domain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_owner_id uuid;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id=NEW.role_id;
  SELECT owner_user_id INTO v_owner_id FROM public.teachings WHERE id=NEW.teaching_id;
  IF v_role.id IS NULL OR v_role.domain <> 'teaching'
     OR (NOT v_role.is_builtin AND v_role.teaching_id <> NEW.teaching_id) THEN
    RAISE EXCEPTION 'RBAC_CROSS_TEACHING_ROLE';
  END IF;
  IF NEW.user_id = v_owner_id AND v_role.code <> 'teaching_owner' THEN
    RAISE EXCEPTION 'PROTECTED_TEACHING_OWNER';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS teaching_member_role_domain_guard ON public.teaching_members;
CREATE TRIGGER teaching_member_role_domain_guard BEFORE INSERT OR UPDATE ON public.teaching_members
FOR EACH ROW EXECUTE FUNCTION public.validate_teaching_member_role_domain();

CREATE OR REPLACE FUNCTION public.validate_class_session_teacher_role_domain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_teaching_id uuid;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id=NEW.role_id;
  SELECT teaching_id INTO v_teaching_id FROM public.class_sessions WHERE id=NEW.class_session_id;
  IF v_role.id IS NULL OR v_role.domain <> 'teaching'
     OR (NOT v_role.is_builtin AND v_role.teaching_id <> v_teaching_id) THEN
    RAISE EXCEPTION 'RBAC_CROSS_TEACHING_ROLE';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS class_session_teacher_role_domain_guard ON public.class_session_teachers;
CREATE TRIGGER class_session_teacher_role_domain_guard BEFORE INSERT OR UPDATE ON public.class_session_teachers
FOR EACH ROW EXECUTE FUNCTION public.validate_class_session_teacher_role_domain();

CREATE OR REPLACE FUNCTION public.validate_user_role_assignment_domain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_teaching_id uuid;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id=NEW.role_id;
  v_teaching_id := public.rbac_scope_teaching_id(NEW.scope_type, NEW.scope_id);
  IF v_role.id IS NULL
     OR (NEW.scope_type='system' AND v_role.domain <> 'system')
     OR (NEW.scope_type<>'system' AND v_role.domain <> 'teaching')
     OR (NOT v_role.is_builtin AND v_role.teaching_id IS DISTINCT FROM v_teaching_id) THEN
    RAISE EXCEPTION 'RBAC_ASSIGNMENT_DOMAIN_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS user_role_assignment_domain_guard ON public.user_role_assignments;
CREATE TRIGGER user_role_assignment_domain_guard BEFORE INSERT OR UPDATE ON public.user_role_assignments
FOR EACH ROW EXECUTE FUNCTION public.validate_user_role_assignment_domain();

-- Canonical permission manifest. Permission definitions are migration-owned.
INSERT INTO public.permissions(key, name, description, domain, resource, action)
SELECT format('system.%s.%s', resource_name, action_name),
       initcap(replace(resource_name, '_', ' ')) || ' ' || action_name,
       'Canonical system-domain permission', 'system', resource_name, action_name
FROM unnest(ARRAY['users','roles','role_assignments','permissions','settings','audit']) resource_name
CROSS JOIN unnest(ARRAY['list','read','create','update','delete','manage']) action_name
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource,
  action = EXCLUDED.action, name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO public.permissions(key, name, description, domain, resource, action)
SELECT format('teaching.%s.%s', resource_name, action_name),
       initcap(replace(resource_name, '_', ' ')) || ' ' || action_name,
       'Canonical teaching-domain permission', 'teaching', resource_name, action_name
FROM unnest(ARRAY[
  'teachings','members','roles','role_assignments','permissions','courses','lessons','classrooms',
  'class_sessions','students','teachers','enrollments','occurrences','reports','templates','holidays'
]) resource_name
CROSS JOIN unnest(ARRAY['list','read','create','update','delete','manage']) action_name
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource,
  action = EXCLUDED.action, name = EXCLUDED.name, description = EXCLUDED.description;

UPDATE public.permissions
SET domain = 'teaching', resource = 'reports', action = 'receive_notifications'
WHERE key = 'reports.incomplete.receive';

-- Drop legacy policies before installing strict domain validation.
DELETE FROM public.role_permission_policies policy
USING public.roles role, public.permissions permission
WHERE policy.role_id = role.id AND policy.permission_id = permission.id
  AND role.domain <> permission.domain;

CREATE OR REPLACE FUNCTION public.validate_rbac_role_policy_domain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_permission public.permissions;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id = NEW.role_id;
  SELECT * INTO v_permission FROM public.permissions WHERE id = NEW.permission_id;
  IF v_role.id IS NULL OR v_permission.id IS NULL OR v_role.domain <> v_permission.domain THEN
    RAISE EXCEPTION 'RBAC_DOMAIN_MISMATCH';
  END IF;
  IF (v_role.domain = 'system' AND (NEW.scope_type <> 'system' OR NEW.scope_id IS NOT NULL))
     OR (v_role.domain = 'teaching' AND (NEW.scope_type = 'system' OR NEW.scope_id IS NULL)) THEN
    RAISE EXCEPTION 'RBAC_SCOPE_DOMAIN_MISMATCH';
  END IF;
  IF v_role.domain = 'teaching' AND v_role.teaching_id IS NOT NULL AND NEW.scope_type = 'teaching' AND NEW.scope_id <> v_role.teaching_id THEN
    RAISE EXCEPTION 'RBAC_CROSS_TEACHING_ROLE';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS role_permission_policy_domain_guard ON public.role_permission_policies;
CREATE TRIGGER role_permission_policy_domain_guard
BEFORE INSERT OR UPDATE ON public.role_permission_policies
FOR EACH ROW EXECUTE FUNCTION public.validate_rbac_role_policy_domain();

CREATE OR REPLACE FUNCTION public.validate_rbac_role_inheritance_domain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_child public.roles; v_parent public.roles;
BEGIN
  SELECT * INTO v_child FROM public.roles WHERE id = NEW.role_id;
  SELECT * INTO v_parent FROM public.roles WHERE id = NEW.parent_role_id;
  IF v_child.id IS NULL OR v_parent.id IS NULL OR v_child.domain <> v_parent.domain THEN
    RAISE EXCEPTION 'RBAC_INHERITANCE_DOMAIN_MISMATCH';
  END IF;
  IF v_child.domain = 'teaching' AND NOT v_child.is_builtin
     AND NOT (v_parent.is_builtin OR v_parent.teaching_id = v_child.teaching_id) THEN
    RAISE EXCEPTION 'RBAC_CROSS_TEACHING_INHERITANCE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS role_inheritance_single_parent ON public.role_inheritance(role_id);
DROP TRIGGER IF EXISTS role_inheritance_domain_guard ON public.role_inheritance;
CREATE TRIGGER role_inheritance_domain_guard
BEFORE INSERT OR UPDATE ON public.role_inheritance
FOR EACH ROW EXECUTE FUNCTION public.validate_rbac_role_inheritance_domain();

-- Seed deterministic built-in policy templates at their valid scopes.
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles role CROSS JOIN public.permissions permission
WHERE role.domain = 'system' AND role.is_builtin AND permission.domain = 'system'
  AND (
    role.code IN ('system_owner', 'system_admin')
    OR (role.code = 'user_manager' AND permission.resource IN ('users', 'role_assignments'))
    OR (role.code = 'auditor' AND permission.resource = 'audit' AND permission.action IN ('list','read'))
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role.id, permission.id, 'teaching', teaching.id, 'allow'
FROM public.roles role CROSS JOIN public.permissions permission CROSS JOIN public.teachings teaching
WHERE role.domain = 'teaching' AND role.is_builtin AND permission.domain = 'teaching'
  AND (
    role.code = 'teaching_owner'
    OR (role.code = 'teaching_manager' AND permission.action NOT IN ('read_sensitive', 'update_sensitive'))
    OR (role.code = 'teacher' AND permission.resource IN ('teachings','courses','lessons','classrooms','class_sessions','students','teachers','enrollments','occurrences','reports','templates','holidays') AND permission.action IN ('list','read','create','update'))
    OR (role.code = 'assistant' AND permission.resource IN ('teachings','courses','lessons','classrooms','class_sessions','students','teachers','enrollments','occurrences','reports','holidays') AND permission.action IN ('list','read','update'))
    OR (role.code = 'viewer' AND permission.action IN ('list','read'))
  )
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_teaching_owner_policies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT role.id, permission.id, 'teaching', NEW.id, 'allow'
  FROM public.roles role CROSS JOIN public.permissions permission
  WHERE role.domain = 'teaching' AND role.is_builtin AND permission.domain = 'teaching'
    AND (
      role.code = 'teaching_owner'
      OR (role.code = 'teaching_manager' AND permission.action NOT IN ('read_sensitive', 'update_sensitive'))
      OR (role.code = 'teacher' AND permission.resource IN ('teachings','courses','lessons','classrooms','class_sessions','students','teachers','enrollments','occurrences','reports','templates','holidays') AND permission.action IN ('list','read','create','update'))
      OR (role.code = 'assistant' AND permission.resource IN ('teachings','courses','lessons','classrooms','class_sessions','students','teachers','enrollments','occurrences','reports','holidays') AND permission.action IN ('list','read','update'))
      OR (role.code = 'viewer' AND permission.action IN ('list','read'))
    )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- Strict role visibility: built-in templates, system administrators, or roles
-- belonging to a teaching the caller can manage.
DROP POLICY IF EXISTS "Authenticated users can read roles" ON public.roles;
DROP POLICY IF EXISTS "Authenticated users can create custom roles" ON public.roles;
DROP POLICY IF EXISTS "Authenticated users can update custom roles" ON public.roles;
DROP POLICY IF EXISTS "Authenticated users can delete custom roles" ON public.roles;
DROP POLICY IF EXISTS "RBAC administrators can create custom roles" ON public.roles;
DROP POLICY IF EXISTS "RBAC administrators can update custom roles" ON public.roles;
DROP POLICY IF EXISTS "RBAC administrators can delete custom roles" ON public.roles;
DROP POLICY IF EXISTS "RBAC roles are visible in authorized domains" ON public.roles;
CREATE POLICY "RBAC roles are visible in authorized domains" ON public.roles FOR SELECT TO authenticated
USING (
  is_builtin
  OR public.has_system_permission((select auth.uid()), 'system.roles.read')
  OR (domain = 'teaching' AND teaching_id IS NOT NULL AND public.has_teaching_permission((select auth.uid()), 'teaching.roles.read', teaching_id, NULL, NULL))
);

REVOKE ALL ON FUNCTION public.validate_rbac_role_policy_domain() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_rbac_role_inheritance_domain() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rbac_scope_teaching_id(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_teaching_member_role_domain() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_class_session_teacher_role_domain() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_user_role_assignment_domain() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
