-- EduLog canonical unreleased security migration chain.
--
-- 1000040-1000062 were never deployed independently. Their dependency-ordered
-- sections are consolidated here so the database receives one deterministic,
-- rerunnable security state. Do not split this file without revalidating the
-- complete chain and all downstream RLS/API contracts.


-- ==========================================================================
-- Former migration 1000040_editor_report_owner_rls_fix.sql
-- ===========================================================================

-- Editor report RLS follow-up.
--
-- 1000039 correctly separated INSERT from persisted-report visibility, but it
-- only considered class_session_teachers.  Sessions created by a teacher may
-- legitimately have no assignment row (occurrence generation already falls
-- back to class_sessions.user_id), so that owner must be part of the same
-- editor boundary.  This migration is forward-only and does not weaken the
-- report scope for arbitrary authenticated users.

CREATE OR REPLACE FUNCTION public.can_access_occurrence_report(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND (
            EXISTS (
                SELECT 1
                FROM public.occurrence_reports report
                JOIN public.enrollments enrollment
                  ON enrollment.id = report.enrollment_id
                JOIN public.class_occurrences occurrence
                  ON occurrence.id = report.class_occurrence_id
                JOIN public.class_sessions session
                  ON session.id = occurrence.class_session_id
                WHERE report.id = p_report_id
                  AND (
                      session.user_id = auth.uid()
                      OR EXISTS (
                          SELECT 1
                          FROM public.class_session_teachers assignment
                          JOIN public.teachers teacher
                            ON teacher.id = assignment.teacher_id
                          WHERE assignment.class_session_id = occurrence.class_session_id
                            AND teacher.user_id = auth.uid()
                            AND assignment.effective_from <= occurrence.occurrence_date
                            AND (
                                assignment.effective_to IS NULL
                                OR assignment.effective_to >= occurrence.occurrence_date
                            )
                      )
                  )
                  AND (
                      enrollment.class_session_id = occurrence.class_session_id
                      OR EXISTS (
                          SELECT 1
                          FROM public.get_effective_occurrence_enrollment_ids(occurrence.id) roster
                          WHERE roster.enrollment_id = report.enrollment_id
                      )
                  )
            )
            OR EXISTS (
                SELECT 1
                FROM public.resolve_user_permission(auth.uid(), 'rbac.manage', NULL, NULL) permission
                WHERE permission.is_allowed
                  AND NOT permission.is_denied
            )
        );
$$;

CREATE OR REPLACE FUNCTION public.can_create_occurrence_report(
    p_enrollment_id uuid,
    p_class_occurrence_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH context AS (
        SELECT
            occurrence.id,
            occurrence.class_session_id,
            occurrence.occurrence_date,
            enrollment.id AS enrollment_id
        FROM public.class_occurrences occurrence
        JOIN public.enrollments enrollment ON enrollment.id = p_enrollment_id
        WHERE occurrence.id = p_class_occurrence_id
    ), effective_roster AS (
        SELECT 1
        FROM context
        JOIN public.get_effective_occurrence_enrollment_ids(context.id) roster
          ON roster.enrollment_id = context.enrollment_id
    ), manager AS (
        SELECT 1
        FROM public.resolve_user_permission(auth.uid(), 'rbac.manage', NULL, NULL) permission
        WHERE permission.is_allowed
          AND NOT permission.is_denied
    ), actor AS (
        SELECT 1
        FROM context
        JOIN public.class_sessions session ON session.id = context.class_session_id
        WHERE session.user_id = auth.uid()
           OR EXISTS (
               SELECT 1
               FROM public.class_session_teachers assignment
               JOIN public.teachers teacher ON teacher.id = assignment.teacher_id
               WHERE assignment.class_session_id = context.class_session_id
                 AND teacher.user_id = auth.uid()
                 AND assignment.effective_from <= context.occurrence_date
                 AND (
                     assignment.effective_to IS NULL
                     OR assignment.effective_to >= context.occurrence_date
                 )
           )
    )
    SELECT
        auth.uid() IS NOT NULL
        AND EXISTS (SELECT 1 FROM context)
        AND (
            EXISTS (SELECT 1 FROM manager)
            OR (
                EXISTS (SELECT 1 FROM effective_roster)
                AND EXISTS (SELECT 1 FROM actor)
            )
        );
$$;

REVOKE ALL ON FUNCTION public.can_access_occurrence_report(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_create_occurrence_report(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_occurrence_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_occurrence_report(uuid, uuid) TO authenticated;

-- Keep INSERT key-based and make the report scope explicit for every other
-- operation.  In particular, do not regress to a broad policy whose INSERT
-- checks can_access_occurrence_report only after the row exists.
DROP POLICY IF EXISTS "Report editor read is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor insert is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor update is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor delete is scoped" ON public.occurrence_reports;

CREATE POLICY "Report editor read is scoped" ON public.occurrence_reports
    FOR SELECT TO authenticated
    USING (public.can_access_occurrence_report(id));

CREATE POLICY "Report editor insert is scoped" ON public.occurrence_reports
    FOR INSERT TO authenticated
    WITH CHECK (public.can_create_occurrence_report(enrollment_id, class_occurrence_id));

CREATE POLICY "Report editor update is scoped" ON public.occurrence_reports
    FOR UPDATE TO authenticated
    USING (public.can_access_occurrence_report(id))
    WITH CHECK (public.can_access_occurrence_report(id));

CREATE POLICY "Report editor delete is scoped" ON public.occurrence_reports
    FOR DELETE TO authenticated
    USING (public.can_access_occurrence_report(id));

-- Ensure legacy report policies cannot remain permissive if 1000039 was skipped.
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor access is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.report_versions;
DROP POLICY IF EXISTS "Report version access is scoped" ON public.report_versions;
CREATE POLICY "Report version access is scoped" ON public.report_versions
    FOR ALL TO authenticated
    USING (public.can_access_occurrence_report(occurrence_report_id))
    WITH CHECK (public.can_access_occurrence_report(occurrence_report_id));
DROP POLICY IF EXISTS "Allow read/write via functions or owners" ON public.report_collab_docs;
DROP POLICY IF EXISTS "Report collaboration access is scoped" ON public.report_collab_docs;
CREATE POLICY "Report collaboration access is scoped" ON public.report_collab_docs
    FOR ALL TO authenticated
    USING (public.can_access_occurrence_report(occurrence_report_id))
    WITH CHECK (public.can_access_occurrence_report(occurrence_report_id));

-- ==========================================================================
-- Former migration 1000041_editor_rbac_rpc_guard.sql
-- ===========================================================================

-- Editor RBAC RPC guard and execute boundary.
--
-- This section is consolidated into the unreleased 1000040 migration and
-- depends on the editor RBAC boundary from 1000038. It keeps the scoped
-- role_permission_policies RLS policy fail-closed while making the RPC reject
-- non-admin callers before attempting DELETE/INSERT.

CREATE OR REPLACE FUNCTION public.replace_role_permission_policies(
    p_permission_key text,
    p_scope_type text,
    p_scope_id uuid,
    p_policies jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_permission_id uuid;
BEGIN
    IF NOT public.can_manage_editor_rbac() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'RBAC_MANAGE_REQUIRED';
    END IF;

    IF p_scope_type NOT IN ('system', 'classroom', 'class_session')
       OR (p_scope_type = 'system' AND p_scope_id IS NOT NULL)
       OR (p_scope_type <> 'system' AND p_scope_id IS NULL) THEN
        RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
    END IF;

    SELECT id INTO v_permission_id
    FROM public.permissions
    WHERE key = p_permission_key;

    IF v_permission_id IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_PERMISSION';
    END IF;

    DELETE FROM public.role_permission_policies
    WHERE permission_id = v_permission_id
      AND scope_type = p_scope_type
      AND scope_id IS NOT DISTINCT FROM p_scope_id;

    INSERT INTO public.role_permission_policies (role_id, permission_id, scope_type, scope_id, effect)
    SELECT (item->>'role_id')::uuid,
           v_permission_id,
           p_scope_type,
           p_scope_id,
           item->>'effect'
    FROM jsonb_array_elements(COALESCE(p_policies, '[]'::jsonb)) item
    WHERE item->>'effect' IN ('allow', 'deny');
END;
$$;

REVOKE ALL ON FUNCTION public.replace_role_permission_policies(text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_role_permission_policies(text, text, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_role_permission_policies(text, text, uuid, jsonb) TO authenticated;

-- ==========================================================================
-- Former migration 1000041a_has_api_permission_compatibility.sql
-- ===========================================================================

-- Compatibility prerequisite for the historical 1000042 API RBAC grants.
-- 1000044 replaces this fail-closed shim with the canonical evaluator.

DO $$
BEGIN
  IF to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL THEN
    CREATE FUNCTION public.has_api_permission(
      p_user_id uuid,
      p_permission_key text,
      p_classroom_id uuid,
      p_class_session_id uuid
    )
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $function$
      SELECT false;
    $function$;
  END IF;
END;
$$;

-- ==========================================================================
-- Former migration 1000042_api_rbac_rest_foundation.sql
-- ===========================================================================

-- Versioned REST/RBAC foundation. Safe to apply after the preceding section.
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

-- ==========================================================================
-- Former migration 1000043_teaching_scope_reconciliation.sql
-- ===========================================================================

-- EduLog final reconciliation layer.
-- Keep 1000001-1000042 immutable; this migration repairs partial deployments,
-- introduces the teaching domain, and makes core RLS fail closed.

DO $$
BEGIN
  IF to_regclass('public.roles') IS NULL
     OR to_regclass('public.permissions') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.occurrence_reports') IS NULL THEN
    RAISE EXCEPTION 'EduLog prerequisite migration chain is incomplete; expected 1000001-1000042 objects';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.teachings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_quarantine boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT teachings_name_not_blank CHECK (length(btrim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS teachings_owner_unique ON public.teachings(owner_user_id) WHERE owner_user_id IS NOT NULL AND is_quarantine = false;
CREATE UNIQUE INDEX IF NOT EXISTS teachings_quarantine_unique ON public.teachings(is_quarantine) WHERE is_quarantine = true;

CREATE TABLE IF NOT EXISTS public.teaching_members (
  teaching_id uuid NOT NULL REFERENCES public.teachings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (teaching_id, user_id),
  CONSTRAINT teaching_member_date_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS teaching_id uuid REFERENCES public.teachings(id);
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS teaching_id uuid REFERENCES public.teachings(id);
ALTER TABLE public.class_sessions ADD COLUMN IF NOT EXISTS teaching_id uuid REFERENCES public.teachings(id);
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS teaching_id uuid REFERENCES public.teachings(id);

CREATE INDEX IF NOT EXISTS classrooms_teaching_idx ON public.classrooms(teaching_id);
CREATE INDEX IF NOT EXISTS courses_teaching_idx ON public.courses(teaching_id);
CREATE INDEX IF NOT EXISTS class_sessions_teaching_idx ON public.class_sessions(teaching_id);
CREATE INDEX IF NOT EXISTS teaching_members_user_idx ON public.teaching_members(user_id, status);

INSERT INTO public.teachings(name, owner_user_id)
SELECT 'Legacy teaching ' || left(owner_user_id::text, 8), owner_user_id
FROM (
  SELECT user_id AS owner_user_id FROM public.classrooms WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM public.courses WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM public.class_sessions WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM public.students WHERE user_id IS NOT NULL
) owners
ON CONFLICT DO NOTHING;

INSERT INTO public.teachings(name, is_quarantine)
VALUES ('Legacy quarantine (admin only)', true)
ON CONFLICT DO NOTHING;

UPDATE public.classrooms classroom
SET teaching_id = teaching.id
FROM public.teachings teaching
WHERE classroom.teaching_id IS NULL
  AND teaching.owner_user_id IS NOT DISTINCT FROM classroom.user_id
  AND teaching.is_quarantine = false;
UPDATE public.courses course
SET teaching_id = teaching.id
FROM public.teachings teaching
WHERE course.teaching_id IS NULL
  AND teaching.owner_user_id IS NOT DISTINCT FROM course.user_id
  AND teaching.is_quarantine = false;
WITH resolved_sessions AS (
  SELECT
    session.id,
    COALESCE(
      classroom.teaching_id,
      (
        SELECT course.teaching_id
        FROM public.courses course
        WHERE course.id = ANY(session.course_ids)
        ORDER BY course.teaching_id NULLS LAST
        LIMIT 1
      ),
      (SELECT id FROM public.teachings WHERE is_quarantine = true)
    ) AS resolved_teaching_id
  FROM public.class_sessions session
  LEFT JOIN public.classrooms classroom
    ON classroom.id IS NOT DISTINCT FROM session.classroom_id
  WHERE session.teaching_id IS NULL
)
UPDATE public.class_sessions target
SET teaching_id = resolved.resolved_teaching_id
FROM resolved_sessions resolved
WHERE target.id = resolved.id;

UPDATE public.classrooms
SET teaching_id = (SELECT id FROM public.teachings WHERE is_quarantine = true)
WHERE teaching_id IS NULL;
UPDATE public.courses
SET teaching_id = (SELECT id FROM public.teachings WHERE is_quarantine = true)
WHERE teaching_id IS NULL;
UPDATE public.class_sessions
SET teaching_id = (SELECT id FROM public.teachings WHERE is_quarantine = true)
WHERE teaching_id IS NULL;

INSERT INTO public.roles(code, name, description, is_system, sort_order)
VALUES ('teaching_owner', 'Teaching owner', 'Full management access within an owned teaching', true, 5)
ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES ('teaching.members.manage', 'Manage teaching members', 'Manage membership within a teaching', 'teaching', 'members', 'manage')
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
CROSS JOIN public.permissions permission
WHERE owner_role.code = 'teaching_owner' AND permission.domain = 'teaching'
ON CONFLICT DO NOTHING;
INSERT INTO public.teaching_members(teaching_id, user_id, role_id)
SELECT teaching.id, teaching.owner_user_id, role.id
FROM public.teachings teaching
JOIN public.roles role ON role.code = 'teaching_owner'
WHERE teaching.owner_user_id IS NOT NULL AND teaching.is_quarantine = false
ON CONFLICT (teaching_id, user_id) DO UPDATE SET role_id = COALESCE(teaching_members.role_id, EXCLUDED.role_id), status = 'active';

INSERT INTO public.roles(code, name, description, is_system, sort_order)
VALUES ('teaching_owner', 'Teaching owner', 'Full management access within an owned teaching', true, 5)
ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES ('teaching.members.manage', 'Manage teaching members', 'Manage membership within a teaching', 'teaching', 'members', 'manage')
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
CROSS JOIN public.permissions permission
WHERE owner_role.code = 'teaching_owner' AND permission.domain = 'teaching'
ON CONFLICT DO NOTHING;
WITH teacher_memberships AS (
  SELECT DISTINCT ON (session.teaching_id, teacher.user_id)
    session.teaching_id,
    teacher.user_id,
    assignment.role_id
  FROM public.class_session_teachers assignment
  JOIN public.class_sessions session
    ON session.id = assignment.class_session_id
  JOIN public.teachers teacher
    ON teacher.id = assignment.teacher_id
  WHERE teacher.user_id IS NOT NULL
    AND session.teaching_id IS NOT NULL
  ORDER BY
    session.teaching_id,
    teacher.user_id,
    (assignment.role_id IS NULL),
    assignment.effective_from DESC,
    assignment.created_at DESC,
    assignment.id
)
INSERT INTO public.teaching_members(teaching_id, user_id, role_id)
SELECT teaching_id, user_id, role_id
FROM teacher_memberships
ON CONFLICT (teaching_id, user_id) DO UPDATE
SET role_id = COALESCE(teaching_members.role_id, EXCLUDED.role_id),
    status = 'active';

DO $$
BEGIN
  ALTER TABLE public.role_permission_policies DROP CONSTRAINT IF EXISTS role_permission_policies_scope_type_check;
  ALTER TABLE public.role_permission_policies DROP CONSTRAINT IF EXISTS role_permission_policy_scope_shape;
  ALTER TABLE public.role_permission_policies DROP CONSTRAINT IF EXISTS role_permission_policies_scope_shape;
  ALTER TABLE public.role_permission_policies ADD CONSTRAINT role_permission_policies_scope_type_check CHECK (
    scope_type IN ('system', 'teaching', 'classroom', 'class_session')
  );
  ALTER TABLE public.role_permission_policies ADD CONSTRAINT role_permission_policy_scope_shape CHECK (
    (scope_type = 'system' AND scope_id IS NULL)
    OR (scope_type IN ('teaching', 'classroom', 'class_session') AND scope_id IS NOT NULL)
  );
  ALTER TABLE public.user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignments_scope_type_check;
  ALTER TABLE public.user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignment_scope_shape;
  ALTER TABLE public.user_role_assignments ADD CONSTRAINT user_role_assignments_scope_type_check CHECK (
    scope_type IN ('system', 'teaching', 'classroom', 'class_session')
  );
  ALTER TABLE public.user_role_assignments ADD CONSTRAINT user_role_assignment_scope_shape CHECK (
    (scope_type = 'system' AND scope_id IS NULL)
    OR (scope_type IN ('teaching', 'classroom', 'class_session') AND scope_id IS NOT NULL)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_teaching_member(p_teaching_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.teaching_members member
    WHERE member.teaching_id = p_teaching_id
      AND member.user_id = p_user_id
      AND member.status = 'active'
      AND member.effective_from <= CURRENT_DATE
      AND (member.effective_to IS NULL OR member.effective_to >= CURRENT_DATE)
  );
$$;

CREATE OR REPLACE FUNCTION public.resolve_teaching_permission(
  p_user_id uuid, p_permission_key text, p_teaching_id uuid,
  p_classroom_id uuid DEFAULT NULL, p_class_session_id uuid DEFAULT NULL,
  p_effective_date date DEFAULT CURRENT_DATE
) RETURNS TABLE(is_allowed boolean, is_denied boolean, policy_configured boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH RECURSIVE assigned_roles AS (
  SELECT assignment.role_id
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
  SELECT member.role_id FROM public.teaching_members member
  WHERE member.teaching_id = p_teaching_id AND member.user_id = p_user_id AND member.status = 'active'
), role_tree(role_id) AS (
  SELECT role_id FROM assigned_roles WHERE role_id IS NOT NULL
  UNION
  SELECT inheritance.parent_role_id
  FROM public.role_inheritance inheritance JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect, policy.scope_type
  FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  WHERE policy.role_id IN (SELECT role_id FROM role_tree)
    AND permission.key = p_permission_key
    AND (
      policy.scope_type = 'system'
      OR (policy.scope_type = 'teaching' AND policy.scope_id = p_teaching_id)
      OR (policy.scope_type = 'classroom' AND policy.scope_id = p_classroom_id)
      OR (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
    )
)
SELECT COALESCE(bool_or(matched.effect = 'allow'), false) AND NOT COALESCE(bool_or(matched.effect = 'deny'), false),
       COALESCE(bool_or(matched.effect = 'deny'), false),
       EXISTS (SELECT 1 FROM matched)
FROM matched;
$$;

CREATE OR REPLACE FUNCTION public.has_teaching_permission(p_user_id uuid, p_permission_key text, p_teaching_id uuid, p_classroom_id uuid DEFAULT NULL, p_class_session_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.role() = 'service_role' OR auth.uid() = p_user_id
    THEN COALESCE((SELECT is_allowed AND NOT is_denied FROM public.resolve_teaching_permission(p_user_id, p_permission_key, p_teaching_id, p_classroom_id, p_class_session_id) LIMIT 1), false)
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_teaching(p_teaching_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_teaching_member(p_teaching_id)
    AND (p_permission_key IS NULL OR public.has_teaching_permission(auth.uid(), p_permission_key, p_teaching_id));
$$;

CREATE OR REPLACE FUNCTION public.can_teaching_action(p_teaching_id uuid, p_resource text, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access_teaching(p_teaching_id, 'teaching.' || p_resource || '.' || p_action)
      OR public.can_access_teaching(p_teaching_id, 'teaching.' || p_resource || '.manage');
$$;
CREATE OR REPLACE FUNCTION public.can_access_classroom(p_classroom_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.classrooms classroom WHERE classroom.id = p_classroom_id AND public.can_access_teaching(classroom.teaching_id, p_permission_key));
$$;

CREATE OR REPLACE FUNCTION public.can_access_class_session(p_class_session_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.class_sessions session WHERE session.id = p_class_session_id AND public.can_access_teaching(session.teaching_id, p_permission_key));
$$;

CREATE OR REPLACE FUNCTION public.can_access_student(p_student_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id = p_student_id AND (
      student.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.enrollments enrollment JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id WHERE enrollment.student_id = student.id AND public.can_access_teaching(classroom.teaching_id, p_permission_key))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_enrollment(p_enrollment_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.enrollments enrollment
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    WHERE enrollment.id = p_enrollment_id
      AND public.can_access_teaching(COALESCE(session.teaching_id, classroom.teaching_id), p_permission_key)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_report(p_report_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.occurrence_reports report
    JOIN public.class_occurrences occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.class_sessions session ON session.id = occurrence.class_session_id
    WHERE report.id = p_report_id AND public.can_access_teaching(session.teaching_id, p_permission_key)
  ) OR public.can_access_occurrence_report(p_report_id);
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['students','student_contacts','student_schools','student_credentials','teachers','courses','lessons','classrooms','classroom_schedules','class_sessions','class_session_teachers','holidays','enrollments','class_occurrences','report_templates','student_suspensions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.%I', table_name);
  END LOOP;
END;
$$;

ALTER TABLE public.teachings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Teaching members can read teachings" ON public.teachings;
CREATE POLICY "Teaching members can read teachings" ON public.teachings FOR SELECT TO authenticated USING (public.can_access_teaching(id));
DROP POLICY IF EXISTS "Teaching owners manage teachings" ON public.teachings;
CREATE POLICY "Teaching owners manage teachings" ON public.teachings FOR ALL TO authenticated USING (owner_user_id = auth.uid() OR public.has_teaching_permission(auth.uid(), 'system.roles.manage', id)) WITH CHECK (owner_user_id = auth.uid() OR public.has_teaching_permission(auth.uid(), 'system.roles.manage', id));
DROP POLICY IF EXISTS "Teaching members can read membership" ON public.teaching_members;
CREATE POLICY "Teaching members can read membership" ON public.teaching_members FOR SELECT TO authenticated USING (public.can_access_teaching(teaching_id));
DROP POLICY IF EXISTS "Teaching managers manage membership" ON public.teaching_members;
CREATE POLICY "Teaching managers manage membership" ON public.teaching_members FOR ALL TO authenticated USING (public.has_teaching_permission(auth.uid(), 'teaching.members.manage', teaching_id)) WITH CHECK (public.has_teaching_permission(auth.uid(), 'teaching.members.manage', teaching_id));

DROP POLICY IF EXISTS "Teaching scoped classrooms" ON public.classrooms;
DROP POLICY IF EXISTS "Teaching classrooms read" ON public.classrooms;
DROP POLICY IF EXISTS "Teaching classrooms write" ON public.classrooms;
CREATE POLICY "Teaching classrooms read" ON public.classrooms FOR SELECT TO authenticated USING (public.can_teaching_action(teaching_id, 'classrooms', 'read') OR public.can_teaching_action(teaching_id, 'classrooms', 'list'));
CREATE POLICY "Teaching classrooms write" ON public.classrooms FOR INSERT TO authenticated WITH CHECK (public.can_teaching_action(teaching_id, 'classrooms', 'create'));
CREATE POLICY "Teaching classrooms update" ON public.classrooms FOR UPDATE TO authenticated USING (public.can_teaching_action(teaching_id, 'classrooms', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'classrooms', 'update'));
CREATE POLICY "Teaching classrooms delete" ON public.classrooms FOR DELETE TO authenticated USING (public.can_teaching_action(teaching_id, 'classrooms', 'delete'));

DROP POLICY IF EXISTS "Teaching scoped courses" ON public.courses;
DROP POLICY IF EXISTS "Teaching courses read" ON public.courses;
DROP POLICY IF EXISTS "Teaching courses write" ON public.courses;
CREATE POLICY "Teaching courses read" ON public.courses FOR SELECT TO authenticated USING (public.can_teaching_action(teaching_id, 'courses', 'read') OR public.can_teaching_action(teaching_id, 'courses', 'list'));
CREATE POLICY "Teaching courses write" ON public.courses FOR INSERT TO authenticated WITH CHECK (public.can_teaching_action(teaching_id, 'courses', 'create'));
CREATE POLICY "Teaching courses update" ON public.courses FOR UPDATE TO authenticated USING (public.can_teaching_action(teaching_id, 'courses', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'courses', 'update'));
CREATE POLICY "Teaching courses delete" ON public.courses FOR DELETE TO authenticated USING (public.can_teaching_action(teaching_id, 'courses', 'delete'));

DROP POLICY IF EXISTS "Teaching scoped sessions" ON public.class_sessions;
DROP POLICY IF EXISTS "Teaching sessions read" ON public.class_sessions;
DROP POLICY IF EXISTS "Teaching sessions write" ON public.class_sessions;
CREATE POLICY "Teaching sessions read" ON public.class_sessions FOR SELECT TO authenticated USING (public.can_teaching_action(teaching_id, 'class_sessions', 'read') OR public.can_teaching_action(teaching_id, 'class_sessions', 'list'));
CREATE POLICY "Teaching sessions write" ON public.class_sessions FOR INSERT TO authenticated WITH CHECK (public.can_teaching_action(teaching_id, 'class_sessions', 'create'));
CREATE POLICY "Teaching sessions update" ON public.class_sessions FOR UPDATE TO authenticated USING (public.can_teaching_action(teaching_id, 'class_sessions', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'class_sessions', 'update'));
CREATE POLICY "Teaching sessions delete" ON public.class_sessions FOR DELETE TO authenticated USING (public.can_teaching_action(teaching_id, 'class_sessions', 'delete'));
DROP POLICY IF EXISTS "Teaching scoped lessons" ON public.lessons;
CREATE POLICY "Teaching scoped lessons" ON public.lessons FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_access_teaching(course.teaching_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_access_teaching(course.teaching_id)));
DROP POLICY IF EXISTS "Teaching scoped session teachers" ON public.class_session_teachers;
CREATE POLICY "Teaching scoped session teachers" ON public.class_session_teachers FOR ALL TO authenticated USING (public.can_access_class_session(class_session_id)) WITH CHECK (public.can_access_class_session(class_session_id));
DROP POLICY IF EXISTS "Teaching scoped enrollments" ON public.enrollments;
CREATE POLICY "Teaching scoped enrollments" ON public.enrollments FOR ALL TO authenticated USING (public.can_access_enrollment(id)) WITH CHECK (public.can_access_enrollment(id));
DROP POLICY IF EXISTS "Teaching scoped occurrences" ON public.class_occurrences;
CREATE POLICY "Teaching scoped occurrences" ON public.class_occurrences FOR ALL TO authenticated USING (public.can_access_class_session(class_session_id)) WITH CHECK (public.can_access_class_session(class_session_id));
DROP POLICY IF EXISTS "Teaching scoped reports" ON public.occurrence_reports;
CREATE POLICY "Teaching scoped reports" ON public.occurrence_reports FOR ALL TO authenticated USING (public.can_access_report(id)) WITH CHECK (public.can_access_report(id));

REVOKE ALL ON FUNCTION public.is_teaching_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_teaching_permission(uuid, text, uuid, uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_teaching_permission(uuid, text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_teaching(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_classroom(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_class_session(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_student(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_enrollment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_report(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_teaching_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_teaching_permission(uuid, text, uuid, uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_teaching_permission(uuid, text, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_teaching(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_classroom(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_class_session(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_student(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_enrollment(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_report(uuid, text) TO authenticated, service_role;

-- The canonical permissions must also be attached after the catalogue insert.
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
CROSS JOIN public.permissions permission
WHERE owner_role.code = 'teaching_owner' AND permission.domain = 'teaching'
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "Teaching scoped report templates" ON public.report_templates;
CREATE POLICY "Teaching scoped report templates" ON public.report_templates FOR ALL TO authenticated
  USING (public.can_access_teaching(teaching_id, 'teaching.templates.read') OR instructor_id = auth.uid())
  WITH CHECK (public.can_access_teaching(teaching_id, 'teaching.templates.update') OR instructor_id = auth.uid());

DROP POLICY IF EXISTS "Teaching scoped teachers" ON public.teachers;
CREATE POLICY "Teaching scoped teachers" ON public.teachers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.class_session_teachers assignment
    JOIN public.class_sessions session ON session.id = assignment.class_session_id
    WHERE assignment.teacher_id = teachers.id AND public.can_access_class_session(session.id, 'teaching.teachers.read')
  ));
CREATE POLICY "Teaching teachers manage" ON public.teachers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Teaching teachers update" ON public.teachers FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Teaching teachers delete" ON public.teachers FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Teaching scoped credentials" ON public.student_credentials;
CREATE POLICY "Teaching scoped credentials" ON public.student_credentials FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.can_access_student(student_id, 'teaching.students.manage'))
  WITH CHECK (user_id = auth.uid() OR public.can_access_student(student_id, 'teaching.students.manage'));

DO $$
DECLARE policy_name text;
BEGIN
  FOREACH policy_name IN ARRAY ARRAY[
    'Enable all access for authenticated users',
    'Allow all authenticated users',
    'Authenticated users can access all rows'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.report_templates', policy_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.student_credentials', policy_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.teacher_credentials', policy_name);
  END LOOP;
END;
$$;


-- Canonical permission catalogue and final consistency gate.
INSERT INTO public.permissions(key, name, description, domain, resource, action)
SELECT format('teaching.%s.%s', resource_name, action_name),
       initcap(action_name) || ' ' || replace(resource_name, '_', ' '),
       'Canonical teaching-domain permission', 'teaching', resource_name, action_name
FROM unnest(ARRAY['teachings','members','courses','lessons','classrooms','class_sessions','students','enrollments','occurrences','reports','templates','holidays']) AS resources(resource_name)
CROSS JOIN unnest(ARRAY['create','read','update','delete','list','manage']) AS actions(action_name)
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
CROSS JOIN public.permissions permission
WHERE owner_role.code = 'teaching_owner' AND permission.domain = 'teaching'
ON CONFLICT DO NOTHING;


DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.classrooms WHERE teaching_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.courses WHERE teaching_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.class_sessions WHERE teaching_id IS NULL) THEN
    RAISE EXCEPTION '1000043 teaching backfill incomplete: unscoped core rows remain';
  END IF;
END;
$$;


-- Defined after can_access_teaching so PostgreSQL validates dependencies in order.

GRANT EXECUTE ON FUNCTION public.can_teaching_action(uuid, text, text) TO authenticated, service_role;

-- Remove the remaining historical broad policies after scoped replacements have
-- been installed. Existing editor-scoped policies remain in place.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['class_occurrences','occurrence_reports','report_versions','documents'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.%I', table_name);
  END LOOP;
END;
$$;
INSERT INTO public.permissions(key, name, description, domain, resource, action)
SELECT format('teaching.report-templates.%s', action_name),
       initcap(action_name) || ' report templates',
       'Canonical API alias for report templates', 'teaching', 'report-templates', action_name
FROM unnest(ARRAY['create','read','update','delete','list','manage']) AS actions(action_name)
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
CROSS JOIN public.permissions permission
WHERE owner_role.code = 'teaching_owner' AND permission.key LIKE 'teaching.report-templates.%'
ON CONFLICT DO NOTHING;

-- ==========================================================================
-- Former migration 1000044_rbac_epoch_and_api_contract.sql
-- ===========================================================================

-- Forward-only hardening for the 1000043 teaching reconciliation.
-- This migration deliberately redefines missing API/RBAC primitives rather
-- than changing deployed history.

DO $$
BEGIN
  IF to_regclass('public.teachings') IS NULL
     OR to_regclass('public.teaching_members') IS NULL
     OR to_regclass('public.role_inheritance') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR to_regprocedure('public.resolve_teaching_permission(uuid,text,uuid,uuid,uuid,date)') IS NULL
     OR to_regprocedure('public.resolve_user_permission(uuid,text,uuid,uuid,date)') IS NULL THEN
    RAISE EXCEPTION '1000044 prerequisites missing; apply migrations through 1000043 first';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.rbac_policy_epoch (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  epoch bigint NOT NULL DEFAULT 1 CHECK (epoch > 0),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
INSERT INTO public.rbac_policy_epoch(singleton, epoch)
VALUES (true, 1)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bump_rbac_policy_epoch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.rbac_policy_epoch
  SET epoch = epoch + 1, updated_at = timezone('utc'::text, now())
  WHERE singleton = true;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_role_inheritance_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role_id = NEW.parent_role_id THEN
    RAISE EXCEPTION 'RBAC_ROLE_INHERITANCE_CYCLE';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors(role_id) AS (
      SELECT NEW.parent_role_id
      UNION
      SELECT inheritance.parent_role_id
      FROM public.role_inheritance inheritance
      JOIN ancestors ancestor ON ancestor.role_id = inheritance.role_id
      WHERE NOT (TG_OP = 'UPDATE' AND inheritance.role_id = OLD.role_id AND inheritance.parent_role_id = OLD.parent_role_id)
    )
    SELECT 1 FROM ancestors WHERE role_id = NEW.role_id
  ) THEN
    RAISE EXCEPTION 'RBAC_ROLE_INHERITANCE_CYCLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS role_inheritance_cycle_guard ON public.role_inheritance;
CREATE TRIGGER role_inheritance_cycle_guard
BEFORE INSERT OR UPDATE ON public.role_inheritance
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_inheritance_cycle();

DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'roles', 'role_inheritance', 'role_permission_policies',
    'user_role_assignments', 'teaching_members'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'rbac_policy_epoch_' || target_table, target_table);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bump_rbac_policy_epoch()',
      'rbac_policy_epoch_' || target_table, target_table
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_api_permission(
  p_user_id uuid,
  p_permission_key text,
  p_classroom_id uuid DEFAULT NULL,
  p_class_session_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.role() = 'service_role'
    OR (
      auth.uid() = p_user_id AND (
        p_permission_key = 'teaching.teachings.create'
        OR EXISTS (
          SELECT 1 FROM public.resolve_user_permission(
            p_user_id, p_permission_key, p_classroom_id, p_class_session_id
          ) legacy WHERE legacy.is_allowed AND NOT legacy.is_denied
        )
        OR EXISTS (
          SELECT 1
          FROM public.teachings teaching
          WHERE public.has_teaching_permission(
            p_user_id,
            p_permission_key,
            teaching.id,
            p_classroom_id,
            p_class_session_id
          )
        )
      )
    );
$$;

REVOKE ALL ON TABLE public.rbac_policy_epoch FROM PUBLIC, anon;
GRANT SELECT ON public.rbac_policy_epoch TO authenticated;
REVOKE ALL ON FUNCTION public.bump_rbac_policy_epoch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_role_inheritance_cycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provision_teaching_owner_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_user_id IS NOT NULL AND NOT NEW.is_quarantine THEN
    INSERT INTO public.teaching_members(teaching_id, user_id, role_id, status)
    SELECT NEW.id, NEW.owner_user_id, role.id, 'active'
    FROM public.roles role
    WHERE role.code = 'teaching_owner'
    ON CONFLICT (teaching_id, user_id) DO UPDATE SET
      role_id = EXCLUDED.role_id,
      status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teaching_owner_membership_provision ON public.teachings;
CREATE TRIGGER teaching_owner_membership_provision
AFTER INSERT OR UPDATE OF owner_user_id, is_quarantine ON public.teachings
FOR EACH ROW EXECUTE FUNCTION public.provision_teaching_owner_member();

REVOKE ALL ON FUNCTION public.provision_teaching_owner_member() FROM PUBLIC;

DO $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT * FROM (VALUES
      ('teachings', 'Teaching owners create teachings'),
      ('teachings', 'Teaching owners update teachings'),
      ('teachings', 'Teaching owners delete teachings'),
      ('teaching_members', 'Teaching managers create membership'),
      ('teaching_members', 'Teaching managers update membership'),
      ('teaching_members', 'Teaching managers delete membership'),
      ('lessons', 'Teaching lessons read'),
      ('lessons', 'Teaching lessons create'),
      ('lessons', 'Teaching lessons update'),
      ('lessons', 'Teaching lessons delete'),
      ('class_session_teachers', 'Teaching session teachers read'),
      ('class_session_teachers', 'Teaching session teachers create'),
      ('class_session_teachers', 'Teaching session teachers update'),
      ('class_session_teachers', 'Teaching session teachers delete'),
      ('enrollments', 'Teaching enrollments read'),
      ('enrollments', 'Teaching enrollments create'),
      ('enrollments', 'Teaching enrollments update'),
      ('enrollments', 'Teaching enrollments delete'),
      ('class_occurrences', 'Teaching occurrences read'),
      ('class_occurrences', 'Teaching occurrences create'),
      ('class_occurrences', 'Teaching occurrences update'),
      ('class_occurrences', 'Teaching occurrences delete'),
      ('occurrence_reports', 'Teaching reports read'),
      ('occurrence_reports', 'Teaching reports create'),
      ('occurrence_reports', 'Teaching reports update'),
      ('occurrence_reports', 'Teaching reports delete'),
      ('report_templates', 'Teaching templates read'),
      ('report_templates', 'Teaching templates create'),
      ('report_templates', 'Teaching templates update'),
      ('report_templates', 'Teaching templates delete'),
      ('student_credentials', 'Teaching credentials read'),
      ('student_credentials', 'Teaching credentials create'),
      ('student_credentials', 'Teaching credentials update'),
      ('student_credentials', 'Teaching credentials delete')
    ) AS policies(table_name, policy_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', candidate.policy_name, candidate.table_name);
  END LOOP;
END;
$$;

-- Leave no 1000043 policy names behind so that the immutable reconciliation
-- script can be replayed; canonical replacements below retain the same scope.
DO $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT * FROM (VALUES
      ('teachings', 'Teaching members can read teachings'),
      ('teachings', 'Teaching owners manage teachings'),
      ('teaching_members', 'Teaching members can read membership'),
      ('teaching_members', 'Teaching managers manage membership'),
      ('classrooms', 'Teaching classrooms read'),
      ('classrooms', 'Teaching classrooms write'),
      ('classrooms', 'Teaching classrooms update'),
      ('classrooms', 'Teaching classrooms delete'),
      ('courses', 'Teaching courses read'),
      ('courses', 'Teaching courses write'),
      ('courses', 'Teaching courses update'),
      ('courses', 'Teaching courses delete'),
      ('class_sessions', 'Teaching sessions read'),
      ('class_sessions', 'Teaching sessions write'),
      ('class_sessions', 'Teaching sessions update'),
      ('class_sessions', 'Teaching sessions delete'),
      ('lessons', 'Teaching scoped lessons'),
      ('class_session_teachers', 'Teaching scoped session teachers'),
      ('enrollments', 'Teaching scoped enrollments'),
      ('class_occurrences', 'Teaching scoped occurrences'),
      ('occurrence_reports', 'Teaching scoped reports'),
      ('report_templates', 'Teaching scoped report templates'),
      ('teachers', 'Teaching scoped teachers'),
      ('teachers', 'Teaching teachers manage'),
      ('teachers', 'Teaching teachers update'),
      ('teachers', 'Teaching teachers delete'),
      ('student_credentials', 'Teaching scoped credentials'),
      ('teachings', 'Canonical teachings read'),
      ('teaching_members', 'Canonical teaching members read'),
      ('classrooms', 'Canonical classrooms read'),
      ('classrooms', 'Canonical classrooms create'),
      ('classrooms', 'Canonical classrooms update'),
      ('classrooms', 'Canonical classrooms delete'),
      ('courses', 'Canonical courses read'),
      ('courses', 'Canonical courses create'),
      ('courses', 'Canonical courses update'),
      ('courses', 'Canonical courses delete'),
      ('class_sessions', 'Canonical sessions read'),
      ('class_sessions', 'Canonical sessions create'),
      ('class_sessions', 'Canonical sessions update'),
      ('class_sessions', 'Canonical sessions delete'),
      ('teachers', 'Canonical teachers read'),
      ('teachers', 'Canonical teachers create'),
      ('teachers', 'Canonical teachers update'),
      ('teachers', 'Canonical teachers delete')
    ) AS policies(table_name, policy_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', candidate.policy_name, candidate.table_name);
  END LOOP;
END;
$$;

-- Retain the historical audit visibility rule while making auth.uid() an
-- initplan expression rather than a per-row function call.
DROP POLICY IF EXISTS "Users read own audit events" ON public.audit_events;
CREATE POLICY "Users read own audit events" ON public.audit_events FOR SELECT TO authenticated
  USING (actor_user_id = (select auth.uid()) OR public.can_manage_editor_rbac());
-- Action-specific RLS policies replace the remaining FOR ALL variants.
DROP POLICY IF EXISTS "Teaching owners manage teachings" ON public.teachings;
CREATE POLICY "Teaching owners create teachings" ON public.teachings FOR INSERT TO authenticated WITH CHECK (owner_user_id = (select auth.uid()) AND is_quarantine = false);
CREATE POLICY "Teaching owners update teachings" ON public.teachings FOR UPDATE TO authenticated USING (owner_user_id = (select auth.uid())) WITH CHECK (owner_user_id = (select auth.uid()) AND is_quarantine = false);
CREATE POLICY "Teaching owners delete teachings" ON public.teachings FOR DELETE TO authenticated USING (owner_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Teaching managers manage membership" ON public.teaching_members;
CREATE POLICY "Teaching managers create membership" ON public.teaching_members FOR INSERT TO authenticated WITH CHECK (public.can_teaching_action(teaching_id, 'members', 'manage'));
CREATE POLICY "Teaching managers update membership" ON public.teaching_members FOR UPDATE TO authenticated USING (public.can_teaching_action(teaching_id, 'members', 'manage')) WITH CHECK (public.can_teaching_action(teaching_id, 'members', 'manage'));
CREATE POLICY "Teaching managers delete membership" ON public.teaching_members FOR DELETE TO authenticated USING (public.can_teaching_action(teaching_id, 'members', 'manage'));

DROP POLICY IF EXISTS "Teaching scoped lessons" ON public.lessons;
CREATE POLICY "Teaching lessons read" ON public.lessons FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND (public.can_teaching_action(course.teaching_id, 'lessons', 'read') OR public.can_teaching_action(course.teaching_id, 'lessons', 'list'))));
CREATE POLICY "Teaching lessons create" ON public.lessons FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_teaching_action(course.teaching_id, 'lessons', 'create')));
CREATE POLICY "Teaching lessons update" ON public.lessons FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_teaching_action(course.teaching_id, 'lessons', 'update'))) WITH CHECK (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_teaching_action(course.teaching_id, 'lessons', 'update')));
CREATE POLICY "Teaching lessons delete" ON public.lessons FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_teaching_action(course.teaching_id, 'lessons', 'delete')));

DROP POLICY IF EXISTS "Teaching scoped session teachers" ON public.class_session_teachers;
CREATE POLICY "Teaching session teachers read" ON public.class_session_teachers FOR SELECT TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.class_sessions.read') OR public.can_access_class_session(class_session_id, 'teaching.class_sessions.list'));
CREATE POLICY "Teaching session teachers create" ON public.class_session_teachers FOR INSERT TO authenticated WITH CHECK (public.can_access_class_session(class_session_id, 'teaching.class_sessions.update'));
CREATE POLICY "Teaching session teachers update" ON public.class_session_teachers FOR UPDATE TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.class_sessions.update')) WITH CHECK (public.can_access_class_session(class_session_id, 'teaching.class_sessions.update'));
CREATE POLICY "Teaching session teachers delete" ON public.class_session_teachers FOR DELETE TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.class_sessions.update'));

DROP POLICY IF EXISTS "Teaching scoped enrollments" ON public.enrollments;
CREATE POLICY "Teaching enrollments read" ON public.enrollments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.classrooms classroom WHERE classroom.id = enrollments.classroom_id AND (public.can_teaching_action(classroom.teaching_id, 'enrollments', 'read') OR public.can_teaching_action(classroom.teaching_id, 'enrollments', 'list'))) OR EXISTS (SELECT 1 FROM public.class_sessions session WHERE session.id = enrollments.class_session_id AND (public.can_teaching_action(session.teaching_id, 'enrollments', 'read') OR public.can_teaching_action(session.teaching_id, 'enrollments', 'list'))));
CREATE POLICY "Teaching enrollments create" ON public.enrollments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms classroom WHERE classroom.id = enrollments.classroom_id AND public.can_teaching_action(classroom.teaching_id, 'enrollments', 'create')) OR EXISTS (SELECT 1 FROM public.class_sessions session WHERE session.id = enrollments.class_session_id AND public.can_teaching_action(session.teaching_id, 'enrollments', 'create')));
CREATE POLICY "Teaching enrollments update" ON public.enrollments FOR UPDATE TO authenticated USING (public.can_access_enrollment(id, 'teaching.enrollments.update')) WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms classroom WHERE classroom.id = enrollments.classroom_id AND public.can_teaching_action(classroom.teaching_id, 'enrollments', 'update')) OR EXISTS (SELECT 1 FROM public.class_sessions session WHERE session.id = enrollments.class_session_id AND public.can_teaching_action(session.teaching_id, 'enrollments', 'update')));
CREATE POLICY "Teaching enrollments delete" ON public.enrollments FOR DELETE TO authenticated USING (public.can_access_enrollment(id, 'teaching.enrollments.delete'));

DROP POLICY IF EXISTS "Teaching scoped occurrences" ON public.class_occurrences;
CREATE POLICY "Teaching occurrences read" ON public.class_occurrences FOR SELECT TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.occurrences.read') OR public.can_access_class_session(class_session_id, 'teaching.occurrences.list'));
CREATE POLICY "Teaching occurrences create" ON public.class_occurrences FOR INSERT TO authenticated WITH CHECK (public.can_access_class_session(class_session_id, 'teaching.occurrences.create'));
CREATE POLICY "Teaching occurrences update" ON public.class_occurrences FOR UPDATE TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.occurrences.update')) WITH CHECK (public.can_access_class_session(class_session_id, 'teaching.occurrences.update'));
CREATE POLICY "Teaching occurrences delete" ON public.class_occurrences FOR DELETE TO authenticated USING (public.can_access_class_session(class_session_id, 'teaching.occurrences.delete'));

DROP POLICY IF EXISTS "Teaching scoped reports" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor read is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor insert is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor update is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Report editor delete is scoped" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Teaching reports read" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Teaching reports create" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Teaching reports update" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Teaching reports delete" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Canonical reports read" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Canonical reports create" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Canonical reports update" ON public.occurrence_reports;
DROP POLICY IF EXISTS "Canonical reports delete" ON public.occurrence_reports;

CREATE POLICY "Canonical reports read" ON public.occurrence_reports FOR SELECT TO authenticated
  USING (
    public.can_access_occurrence_report(id)
    OR public.can_access_report(id, 'teaching.reports.read')
    OR public.can_access_report(id, 'teaching.reports.list')
  );
CREATE POLICY "Canonical reports create" ON public.occurrence_reports FOR INSERT TO authenticated
  WITH CHECK (
    public.can_create_occurrence_report(enrollment_id, class_occurrence_id)
    OR EXISTS (
      SELECT 1
      FROM public.class_occurrences occurrence
      JOIN public.class_sessions session ON session.id = occurrence.class_session_id
      WHERE occurrence.id = occurrence_reports.class_occurrence_id
        AND public.can_teaching_action(session.teaching_id, 'reports', 'create')
    )
  );
CREATE POLICY "Canonical reports update" ON public.occurrence_reports FOR UPDATE TO authenticated
  USING (
    public.can_access_occurrence_report(id)
    OR public.can_access_report(id, 'teaching.reports.update')
  )
  WITH CHECK (
    public.can_access_occurrence_report(id)
    OR EXISTS (
      SELECT 1
      FROM public.class_occurrences occurrence
      JOIN public.class_sessions session ON session.id = occurrence.class_session_id
      WHERE occurrence.id = occurrence_reports.class_occurrence_id
        AND public.can_teaching_action(session.teaching_id, 'reports', 'update')
    )
  );
CREATE POLICY "Canonical reports delete" ON public.occurrence_reports FOR DELETE TO authenticated
  USING (
    public.can_access_occurrence_report(id)
    OR public.can_access_report(id, 'teaching.reports.delete')
  );

DROP POLICY IF EXISTS "Teaching scoped report templates" ON public.report_templates;
CREATE POLICY "Teaching templates read" ON public.report_templates FOR SELECT TO authenticated USING (public.can_teaching_action(teaching_id, 'templates', 'read') OR public.can_teaching_action(teaching_id, 'templates', 'list') OR instructor_id = (select auth.uid()));
CREATE POLICY "Teaching templates create" ON public.report_templates FOR INSERT TO authenticated WITH CHECK (public.can_teaching_action(teaching_id, 'templates', 'create') OR instructor_id = (select auth.uid()));
CREATE POLICY "Teaching templates update" ON public.report_templates FOR UPDATE TO authenticated USING (public.can_teaching_action(teaching_id, 'templates', 'update') OR instructor_id = (select auth.uid())) WITH CHECK (public.can_teaching_action(teaching_id, 'templates', 'update') OR instructor_id = (select auth.uid()));
CREATE POLICY "Teaching templates delete" ON public.report_templates FOR DELETE TO authenticated USING (public.can_teaching_action(teaching_id, 'templates', 'delete') OR instructor_id = (select auth.uid()));

DROP POLICY IF EXISTS "Teaching scoped credentials" ON public.student_credentials;
CREATE POLICY "Teaching credentials read" ON public.student_credentials FOR SELECT TO authenticated USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Teaching credentials create" ON public.student_credentials FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.create'));
CREATE POLICY "Teaching credentials update" ON public.student_credentials FOR UPDATE TO authenticated USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update')) WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Teaching credentials delete" ON public.student_credentials FOR DELETE TO authenticated USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.delete'));

-- Canonical policy names intentionally differ from 1000043's names.  That
-- lets an administrator replay the immutable reconciliation migration, then
-- reapply 1000044 to return to this final state.
CREATE POLICY "Canonical teachings read" ON public.teachings FOR SELECT TO authenticated
  USING (public.can_access_teaching(id));
CREATE POLICY "Canonical teaching members read" ON public.teaching_members FOR SELECT TO authenticated
  USING (public.can_access_teaching(teaching_id));

CREATE POLICY "Canonical classrooms read" ON public.classrooms FOR SELECT TO authenticated
  USING (public.can_teaching_action(teaching_id, 'classrooms', 'read') OR public.can_teaching_action(teaching_id, 'classrooms', 'list'));
CREATE POLICY "Canonical classrooms create" ON public.classrooms FOR INSERT TO authenticated
  WITH CHECK (public.can_teaching_action(teaching_id, 'classrooms', 'create'));
CREATE POLICY "Canonical classrooms update" ON public.classrooms FOR UPDATE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'classrooms', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'classrooms', 'update'));
CREATE POLICY "Canonical classrooms delete" ON public.classrooms FOR DELETE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'classrooms', 'delete'));

CREATE POLICY "Canonical courses read" ON public.courses FOR SELECT TO authenticated
  USING (public.can_teaching_action(teaching_id, 'courses', 'read') OR public.can_teaching_action(teaching_id, 'courses', 'list'));
CREATE POLICY "Canonical courses create" ON public.courses FOR INSERT TO authenticated
  WITH CHECK (public.can_teaching_action(teaching_id, 'courses', 'create'));
CREATE POLICY "Canonical courses update" ON public.courses FOR UPDATE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'courses', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'courses', 'update'));
CREATE POLICY "Canonical courses delete" ON public.courses FOR DELETE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'courses', 'delete'));

CREATE POLICY "Canonical sessions read" ON public.class_sessions FOR SELECT TO authenticated
  USING (public.can_teaching_action(teaching_id, 'class_sessions', 'read') OR public.can_teaching_action(teaching_id, 'class_sessions', 'list'));
CREATE POLICY "Canonical sessions create" ON public.class_sessions FOR INSERT TO authenticated
  WITH CHECK (public.can_teaching_action(teaching_id, 'class_sessions', 'create'));
CREATE POLICY "Canonical sessions update" ON public.class_sessions FOR UPDATE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'class_sessions', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'class_sessions', 'update'));
CREATE POLICY "Canonical sessions delete" ON public.class_sessions FOR DELETE TO authenticated
  USING (public.can_teaching_action(teaching_id, 'class_sessions', 'delete'));

CREATE POLICY "Canonical teachers read" ON public.teachers FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR EXISTS (SELECT 1 FROM public.class_session_teachers assignment JOIN public.class_sessions session ON session.id = assignment.class_session_id WHERE assignment.teacher_id = teachers.id AND public.can_access_class_session(session.id, 'teaching.teachers.read')));
CREATE POLICY "Canonical teachers create" ON public.teachers FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Canonical teachers update" ON public.teachers FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Canonical teachers delete" ON public.teachers FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

-- ==========================================================================
-- Former migration 1000045_missing_core_rls_hardening.sql
-- ===========================================================================

-- Forward-only hardening for tables whose legacy policies were removed by
-- 1000043/1000044 but did not yet have canonical replacements.
-- Never rewrite an applied migration; rerun this file safely instead.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.student_contacts') IS NULL
     OR to_regclass('public.student_schools') IS NULL
     OR to_regclass('public.student_credentials') IS NULL
     OR to_regclass('public.teacher_credentials') IS NULL
     OR to_regclass('public.classroom_schedules') IS NULL
     OR to_regclass('public.student_suspensions') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_classroom(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_enrollment(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_class_session(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000045 prerequisites missing; apply migrations through 1000044 first';
  END IF;
END;
$$;

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'students', 'student_contacts', 'student_schools', 'student_credentials',
    'teacher_credentials', 'classroom_schedules', 'student_suspensions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Enable all access for authenticated users', target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow all authenticated users', target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Authenticated users can access all rows', target_table);
  END LOOP;
END;
$$;

DO $$
DECLARE
  policy_name text;
  policy_table text;
BEGIN
  FOR policy_name, policy_table IN
    SELECT name, table_name
    FROM (VALUES
      ('Canonical students read', 'students'),
      ('Canonical students create', 'students'),
      ('Canonical students update', 'students'),
      ('Canonical students delete', 'students'),
      ('Canonical student contacts read', 'student_contacts'),
      ('Canonical student contacts create', 'student_contacts'),
      ('Canonical student contacts update', 'student_contacts'),
      ('Canonical student contacts delete', 'student_contacts'),
      ('Canonical student schools read', 'student_schools'),
      ('Canonical student schools create', 'student_schools'),
      ('Canonical student schools update', 'student_schools'),
      ('Canonical student schools delete', 'student_schools'),
      ('Canonical teacher credentials read', 'teacher_credentials'),
      ('Canonical teacher credentials create', 'teacher_credentials'),
      ('Canonical teacher credentials update', 'teacher_credentials'),
      ('Canonical teacher credentials delete', 'teacher_credentials'),
      ('Canonical classroom schedules read', 'classroom_schedules'),
      ('Canonical classroom schedules create', 'classroom_schedules'),
      ('Canonical classroom schedules update', 'classroom_schedules'),
      ('Canonical classroom schedules delete', 'classroom_schedules'),
      ('Canonical student suspensions read', 'student_suspensions'),
      ('Canonical student suspensions create', 'student_suspensions'),
      ('Canonical student suspensions update', 'student_suspensions'),
      ('Canonical student suspensions delete', 'student_suspensions')
    ) AS policies(name, table_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, policy_table);
  END LOOP;
END;
$$;
CREATE POLICY "Canonical students read" ON public.students FOR SELECT TO authenticated
  USING (public.can_access_student(id, 'teaching.students.read') OR user_id = (select auth.uid()));
CREATE POLICY "Canonical students create" ON public.students FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Canonical students update" ON public.students FOR UPDATE TO authenticated
  USING (public.can_access_student(id, 'teaching.students.update') OR user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(id, 'teaching.students.update'));
CREATE POLICY "Canonical students delete" ON public.students FOR DELETE TO authenticated
  USING (public.can_access_student(id, 'teaching.students.delete') OR user_id = (select auth.uid()));

CREATE POLICY "Canonical student contacts read" ON public.student_contacts FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Canonical student contacts create" ON public.student_contacts FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student contacts update" ON public.student_contacts FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'))
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student contacts delete" ON public.student_contacts FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));

CREATE POLICY "Canonical student schools read" ON public.student_schools FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Canonical student schools create" ON public.student_schools FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student schools update" ON public.student_schools FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'))
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student schools delete" ON public.student_schools FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));

CREATE POLICY "Canonical teacher credentials read" ON public.teacher_credentials FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.class_session_teachers assignment
      JOIN public.class_sessions session ON session.id = assignment.class_session_id
      WHERE assignment.teacher_id = teacher_credentials.teacher_id
        AND public.can_access_class_session(session.id, 'teaching.teachers.read')
    )
  );
CREATE POLICY "Canonical teacher credentials create" ON public.teacher_credentials FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Canonical teacher credentials update" ON public.teacher_credentials FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Canonical teacher credentials delete" ON public.teacher_credentials FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "Canonical classroom schedules read" ON public.classroom_schedules FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_classroom(classroom_id, 'teaching.classrooms.read'));
CREATE POLICY "Canonical classroom schedules create" ON public.classroom_schedules FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));
CREATE POLICY "Canonical classroom schedules update" ON public.classroom_schedules FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_classroom(classroom_id, 'teaching.classrooms.update'))
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));
CREATE POLICY "Canonical classroom schedules delete" ON public.classroom_schedules FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));

CREATE POLICY "Canonical student suspensions read" ON public.student_suspensions FOR SELECT TO authenticated
  USING (public.can_access_enrollment(enrollment_id, 'teaching.students.read'));
CREATE POLICY "Canonical student suspensions create" ON public.student_suspensions FOR INSERT TO authenticated
  WITH CHECK (public.can_access_enrollment(enrollment_id, 'teaching.students.update'));
CREATE POLICY "Canonical student suspensions update" ON public.student_suspensions FOR UPDATE TO authenticated
  USING (public.can_access_enrollment(enrollment_id, 'teaching.students.update'))
  WITH CHECK (public.can_access_enrollment(enrollment_id, 'teaching.students.update'));
CREATE POLICY "Canonical student suspensions delete" ON public.student_suspensions FOR DELETE TO authenticated
  USING (public.can_access_enrollment(enrollment_id, 'teaching.students.update'));

REVOKE ALL ON FUNCTION public.can_access_student(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_classroom(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_enrollment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_student(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_classroom(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_enrollment(uuid, text) TO authenticated, service_role;

DO $$
DECLARE
  forbidden_count integer;
BEGIN
  SELECT count(*) INTO forbidden_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('students', 'student_contacts', 'student_schools', 'student_credentials', 'teacher_credentials', 'classroom_schedules', 'student_suspensions')
    AND cmd = 'ALL'
    AND roles @> ARRAY['authenticated'::name];
  IF forbidden_count <> 0 THEN
    RAISE EXCEPTION '1000045 authenticated-wide policies remain: %', forbidden_count;
  END IF;
END;
$$;

-- ==========================================================================
-- Former migration 1000046_api_rate_limit_shared_store.sql
-- ===========================================================================

-- EduLog API shared rate-limit store.
-- This is a forward-only migration. The application stores only a digest of
-- user/IP/route identity in bucket_key; raw client IPs never reach this table.

CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages api rate limit buckets" ON public.api_rate_limit_buckets;
REVOKE ALL ON TABLE public.api_rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_rate_limit_buckets TO service_role;

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
) RETURNS TABLE(allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_reset timestamptz;
BEGIN
  IF p_bucket_key IS NULL OR length(trim(p_bucket_key)) < 16
     OR p_limit IS NULL OR p_limit < 1
     OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.api_rate_limit_buckets(bucket_key, window_started_at, request_count, reset_at, updated_at)
  VALUES (p_bucket_key, v_now, 1, v_now + make_interval(secs => p_window_seconds), v_now)
  ON CONFLICT (bucket_key) DO UPDATE
  SET window_started_at = CASE
        WHEN api_rate_limit_buckets.reset_at <= v_now THEN v_now
        ELSE api_rate_limit_buckets.window_started_at
      END,
      request_count = CASE
        WHEN api_rate_limit_buckets.reset_at <= v_now THEN 1
        ELSE api_rate_limit_buckets.request_count + 1
      END,
      reset_at = CASE
        WHEN api_rate_limit_buckets.reset_at <= v_now
          THEN v_now + make_interval(secs => p_window_seconds)
        ELSE api_rate_limit_buckets.reset_at
      END,
      updated_at = v_now
  RETURNING public.api_rate_limit_buckets.request_count, public.api_rate_limit_buckets.reset_at INTO v_count, v_reset;

  RETURN QUERY
  SELECT v_count <= p_limit,
         GREATEST(p_limit - v_count, 0),
         v_reset;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role;

COMMENT ON TABLE public.api_rate_limit_buckets IS 'Hashed API rate-limit buckets; raw IP addresses must never be stored.';

-- ==========================================================================
-- Former migration 1000047_canonical_teacher_permissions.sql
-- ===========================================================================

-- Forward-only completion of the canonical teaching permission catalogue.
-- The former 1000043 resource list
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

-- ==========================================================================
-- Former migration 1000048_student_scope_course_fallback.sql
-- ===========================================================================

-- Forward-only fix for student scope resolution.
-- Enrollment consistency intentionally clears classroom_id when no class session
-- is present, so student authorization must fall back to course.teaching_id.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.can_access_teaching(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000048 prerequisites missing; apply migrations through 1000047 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_student(
  p_student_id uuid,
  p_permission_key text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students student
    WHERE student.id = p_student_id
      AND (
        student.user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.enrollments enrollment
          LEFT JOIN public.classrooms classroom
            ON classroom.id = enrollment.classroom_id
          LEFT JOIN public.class_sessions session
            ON session.id = enrollment.class_session_id
          LEFT JOIN public.courses course
            ON course.id = enrollment.course_id
          WHERE enrollment.student_id = student.id
            AND public.can_access_teaching(
              COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
              p_permission_key
            )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_student(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_student(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_access_student(uuid, text)
  IS 'Authorizes a student through ownership or session/classroom/course teaching scope.';

-- ==========================================================================
-- Former migration 1000049_holiday_scope_rls_hardening.sql
-- ===========================================================================

-- EduLog forward-only holiday scope hardening.
-- Migrations through 1000039 are immutable history. This section removes the legacy
-- authenticated-wide holiday policy and requires every holiday to reference
-- at least one classroom/session visible to the acting user. Empty-scope
-- global holidays use a canonical global teaching.holidays.* permission.

DO $$
BEGIN
  IF to_regclass('public.holidays') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.can_access_classroom(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_class_session(uuid,text)') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'holidays'
         AND column_name = 'classroom_ids'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'holidays'
         AND column_name = 'class_session_ids'
     ) THEN
    RAISE EXCEPTION '1000049 prerequisites missing; apply migrations through 1000048 first';
  END IF;
END;
$$;

-- Reconcile the legacy API permission wrapper before using it in RLS. A
-- scoped request must resolve its classroom/session to one teaching before
-- evaluating the permission. The previous implementation evaluated the
-- supplied scope against every teaching, which could authorize a resource
-- from a different teaching when a user had a similarly named permission.
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
), matched(effect) AS (
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
    AND COALESCE(bool_or(matched.effect = 'allow'), false)
    AND NOT COALESCE(bool_or(matched.effect = 'deny'), false)
  )
FROM matched;
$$;

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
    WHEN p_permission_key IN (
      'teaching.holidays.create',
      'teaching.holidays.update',
      'teaching.holidays.delete'
    ) THEN public.has_system_permission(p_user_id, p_permission_key)
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

REVOKE ALL ON FUNCTION public.has_system_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_system_permission(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.holidays;
DROP POLICY IF EXISTS "Allow all authenticated users" ON public.holidays;
DROP POLICY IF EXISTS "Authenticated users can access all rows" ON public.holidays;
DROP POLICY IF EXISTS "Canonical holidays read" ON public.holidays;
DROP POLICY IF EXISTS "Canonical holidays create" ON public.holidays;
DROP POLICY IF EXISTS "Canonical holidays update" ON public.holidays;
DROP POLICY IF EXISTS "Canonical holidays delete" ON public.holidays;

CREATE POLICY "Canonical holidays read" ON public.holidays
FOR SELECT TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission(auth.uid(), 'teaching.holidays.read', NULL, NULL)
  )
  OR (
  (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
    WHERE NOT public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.read')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
    WHERE NOT public.can_access_class_session(scoped_session_id, 'teaching.holidays.read')
  )
  )
);

CREATE POLICY "Canonical holidays create" ON public.holidays
FOR INSERT TO authenticated
WITH CHECK (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission(auth.uid(), 'teaching.holidays.create', NULL, NULL)
  )
  OR (
  (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
    WHERE NOT public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.create')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
    WHERE NOT public.can_access_class_session(scoped_session_id, 'teaching.holidays.create')
  )
  )
);

CREATE POLICY "Canonical holidays update" ON public.holidays
FOR UPDATE TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission(auth.uid(), 'teaching.holidays.update', NULL, NULL)
  )
  OR (
  (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
    WHERE NOT public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.update')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
    WHERE NOT public.can_access_class_session(scoped_session_id, 'teaching.holidays.update')
  )
  )
)
WITH CHECK (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission(auth.uid(), 'teaching.holidays.update', NULL, NULL)
  )
  OR (
  (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
    WHERE NOT public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.update')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
    WHERE NOT public.can_access_class_session(scoped_session_id, 'teaching.holidays.update')
  )
  )
);

CREATE POLICY "Canonical holidays delete" ON public.holidays
FOR DELETE TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND public.has_api_permission(auth.uid(), 'teaching.holidays.delete', NULL, NULL)
  )
  OR (
  (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
    WHERE NOT public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.delete')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
    WHERE NOT public.can_access_class_session(scoped_session_id, 'teaching.holidays.delete')
  )
  )
);

DO $$
DECLARE
  wide_policy_count integer;
BEGIN
  SELECT count(*)
  INTO wide_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'holidays'
    AND cmd = 'ALL'
    AND roles @> ARRAY['authenticated'::name];
  IF wide_policy_count <> 0 THEN
    RAISE EXCEPTION '1000049 authenticated-wide holiday policy remains: %', wide_policy_count;
  END IF;
END;
$$;

-- ==========================================================================
-- Former migration 1000050_scope_integrity_and_session_rpc.sql
-- ===========================================================================

-- Scope integrity fixes after the immutable 1000039 history.
-- 1000049 remains the holiday policy migration; this migration hardens the
-- shared permission boundary and the legacy session save RPC.

DO $$
BEGIN
  IF to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.has_teaching_permission(uuid,text,uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.has_system_permission(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000050 prerequisites missing; apply migrations through 1000049 first';
  END IF;
END;
$$;

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
    WHEN public.has_system_permission(p_user_id, p_permission_key) THEN true
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

REVOKE ALL ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_api_permission(uuid, text, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_class_session_with_schedule(
  p_session jsonb,
  p_rules jsonb,
  p_session_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_classroom_id uuid := NULLIF(p_session->>'classroom_id', '')::uuid;
  v_course_ids uuid[] := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(p_session->'course_ids', '[]'::jsonb))
  )::uuid[];
  v_classroom_teaching_id uuid;
  v_course_teaching_id uuid;
  v_existing_teaching_id uuid;
  v_course_count integer;
  v_course_teaching_count integer;
  v_session_type text := COALESCE(NULLIF(p_session->>'session_type', ''), 'regular');
  v_schedule_mode text := COALESCE(NULLIF(p_session->>'schedule_mode', ''), 'weekly');
  v_start_date date := NULLIF(p_session->>'start_date', '')::date;
  v_end_date date := NULLIF(p_session->>'end_date', '')::date;
  v_teaching_id uuid;
  v_first_rule record;
  v_permission_key text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF jsonb_typeof(COALESCE(p_rules, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Schedule rules must be a JSON array';
  END IF;
  IF v_session_type NOT IN ('regular', 'camp')
     OR v_schedule_mode NOT IN ('weekly', 'monthly', 'specific_dates')
     OR (v_session_type = 'camp' AND v_schedule_mode <> 'specific_dates')
     OR (v_session_type = 'regular' AND v_schedule_mode = 'specific_dates') THEN
    RAISE EXCEPTION 'Invalid session type and schedule mode combination';
  END IF;
  IF v_session_type = 'regular' AND v_start_date IS NULL THEN
    RAISE EXCEPTION 'Regular sessions require a start date';
  END IF;
  IF v_session_type = 'regular' AND jsonb_array_length(COALESCE(p_rules, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Regular sessions require at least one schedule rule';
  END IF;
  IF v_start_date IS NOT NULL AND v_end_date IS NOT NULL AND v_start_date > v_end_date THEN
    RAISE EXCEPTION 'Start date must not be after end date';
  END IF;

  IF v_classroom_id IS NOT NULL THEN
    SELECT classroom.teaching_id INTO v_classroom_teaching_id
    FROM public.classrooms classroom
    WHERE classroom.id = v_classroom_id;
    IF v_classroom_teaching_id IS NULL THEN
      RAISE EXCEPTION 'Classroom scope is invalid';
    END IF;
  END IF;

  SELECT count(*), count(DISTINCT course.teaching_id),
         (array_agg(course.teaching_id ORDER BY course.teaching_id))[1]
    INTO v_course_count, v_course_teaching_count, v_course_teaching_id
  FROM public.courses course
  WHERE course.id = ANY(v_course_ids);
  IF v_course_count <> COALESCE(cardinality(v_course_ids), 0)
     OR v_course_teaching_count > 1 THEN
    RAISE EXCEPTION 'Course references must belong to one teaching';
  END IF;
  IF v_classroom_teaching_id IS NOT NULL
     AND v_course_teaching_id IS NOT NULL
     AND v_classroom_teaching_id <> v_course_teaching_id THEN
    RAISE EXCEPTION 'Classroom and course references must belong to one teaching';
  END IF;
  v_teaching_id := COALESCE(v_classroom_teaching_id, v_course_teaching_id);
  IF v_teaching_id IS NULL THEN
    RAISE EXCEPTION 'A classroom or course teaching scope is required';
  END IF;

  v_permission_key := CASE WHEN p_session_id IS NULL
    THEN 'teaching.class_sessions.create'
    ELSE 'teaching.class_sessions.update' END;
  IF NOT public.has_teaching_permission(
    auth.uid(), v_permission_key, v_teaching_id, v_classroom_id, p_session_id
  ) THEN
    RAISE EXCEPTION 'Class session permission denied';
  END IF;

  IF p_session_id IS NULL THEN
    INSERT INTO public.class_sessions (
      name, classroom_id, course_ids, capacity, lesson_number,
      external_link, start_date, end_date, time_zone,
      session_type, schedule_mode, teaching_id, user_id
    ) VALUES (
      p_session->>'name', v_classroom_id, v_course_ids,
      COALESCE(NULLIF(p_session->>'capacity', '')::integer, 10),
      NULLIF(p_session->>'lesson_number', '')::integer,
      NULLIF(p_session->>'external_link', ''), v_start_date, v_end_date,
      COALESCE(NULLIF(p_session->>'time_zone', ''), 'Asia/Taipei'),
      v_session_type, v_schedule_mode, v_teaching_id, auth.uid()
    ) RETURNING id INTO v_session_id;
  ELSE
    SELECT session.teaching_id INTO v_existing_teaching_id
    FROM public.class_sessions session
    WHERE session.id = p_session_id;
    IF v_existing_teaching_id IS NULL THEN
      RAISE EXCEPTION 'Class session not found';
    END IF;
    IF v_existing_teaching_id <> v_teaching_id THEN
      RAISE EXCEPTION 'Class session teaching scope cannot change';
    END IF;
    UPDATE public.class_sessions SET
      name = p_session->>'name', classroom_id = v_classroom_id,
      course_ids = v_course_ids,
      capacity = COALESCE(NULLIF(p_session->>'capacity', '')::integer, 10),
      lesson_number = NULLIF(p_session->>'lesson_number', '')::integer,
      external_link = NULLIF(p_session->>'external_link', ''),
      start_date = v_start_date, end_date = v_end_date,
      time_zone = COALESCE(NULLIF(p_session->>'time_zone', ''), 'Asia/Taipei'),
      session_type = v_session_type, schedule_mode = v_schedule_mode,
      teaching_id = v_teaching_id
    WHERE id = p_session_id
    RETURNING id INTO v_session_id;
  END IF;

  DELETE FROM public.class_session_schedule_rules
  WHERE class_session_id = v_session_id;
  INSERT INTO public.class_session_schedule_rules (
    class_session_id, schedule_kind, day_of_week, day_of_month,
    occurrence_date, start_time, end_time
  )
  SELECT v_session_id, rule.schedule_kind, rule.day_of_week,
         rule.day_of_month, rule.occurrence_date, rule.start_time, rule.end_time
  FROM jsonb_to_recordset(COALESCE(p_rules, '[]'::jsonb)) AS rule(
    schedule_kind text, day_of_week integer, day_of_month integer,
    occurrence_date date, start_time time, end_time time
  );

  IF EXISTS (
    SELECT 1 FROM public.class_session_schedule_rules
    WHERE class_session_id = v_session_id AND schedule_kind <> v_schedule_mode
  ) THEN
    RAISE EXCEPTION 'Schedule rule kind must match session schedule mode';
  END IF;
  IF v_session_type = 'camp' AND v_start_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.class_session_schedule_rules
    WHERE class_session_id = v_session_id AND occurrence_date < v_start_date
  ) THEN
    RAISE EXCEPTION 'Camp schedule date is before the start date';
  END IF;
  IF v_session_type = 'camp' AND v_end_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.class_session_schedule_rules
    WHERE class_session_id = v_session_id AND occurrence_date > v_end_date
  ) THEN
    RAISE EXCEPTION 'Camp schedule date is after the end date';
  END IF;
  SELECT * INTO v_first_rule
  FROM public.class_session_schedule_rules
  WHERE class_session_id = v_session_id
  ORDER BY COALESCE(day_of_week, day_of_month, EXTRACT(DOY FROM occurrence_date)::integer), start_time
  LIMIT 1;
  IF v_first_rule IS NOT NULL THEN
    UPDATE public.class_sessions SET
      day_of_week = CASE
        WHEN v_first_rule.schedule_kind = 'weekly' THEN v_first_rule.day_of_week
        WHEN v_first_rule.schedule_kind = 'specific_dates' THEN EXTRACT(DOW FROM v_first_rule.occurrence_date)::integer
        ELSE NULL END,
      start_time = v_first_rule.start_time,
      end_time = v_first_rule.end_time
    WHERE id = v_session_id;
  END IF;
  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_class_session_with_schedule(jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_class_session_with_schedule(jsonb, jsonb, uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'public.has_api_permission(uuid,text,uuid,uuid)'::regprocedure
  ) THEN
    RAISE EXCEPTION '1000050 failed to install scoped permission resolver';
  END IF;
END;
$$;

-- ==========================================================================
-- Former migration 1000051_child_scope_write_hardening.sql
-- ===========================================================================

-- Forward-only child-scope hardening.  Child rows must be authorized through
-- their actual parent; an arbitrary user_id on the child is not a scope.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.student_contacts') IS NULL
     OR to_regclass('public.student_schools') IS NULL
     OR to_regclass('public.student_credentials') IS NULL
     OR to_regclass('public.teachers') IS NULL
     OR to_regclass('public.teacher_credentials') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.classroom_schedules') IS NULL
     OR to_regclass('public.class_session_teachers') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_classroom(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_class_session(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000051 prerequisites missing; apply migrations through 1000050 first';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Canonical student contacts read" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts create" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts update" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts delete" ON public.student_contacts;
CREATE POLICY "Canonical student contacts read" ON public.student_contacts FOR SELECT TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Canonical student contacts create" ON public.student_contacts FOR INSERT TO authenticated
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student contacts update" ON public.student_contacts FOR UPDATE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'))
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student contacts delete" ON public.student_contacts FOR DELETE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'));

DROP POLICY IF EXISTS "Canonical student schools read" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools create" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools update" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools delete" ON public.student_schools;
CREATE POLICY "Canonical student schools read" ON public.student_schools FOR SELECT TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Canonical student schools create" ON public.student_schools FOR INSERT TO authenticated
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student schools update" ON public.student_schools FOR UPDATE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'))
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student schools delete" ON public.student_schools FOR DELETE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'));

DROP POLICY IF EXISTS "Canonical student credentials read" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials create" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials update" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials delete" ON public.student_credentials;
DROP POLICY IF EXISTS "Teaching credentials read" ON public.student_credentials;
DROP POLICY IF EXISTS "Teaching credentials create" ON public.student_credentials;
DROP POLICY IF EXISTS "Teaching credentials update" ON public.student_credentials;
DROP POLICY IF EXISTS "Teaching credentials delete" ON public.student_credentials;
CREATE POLICY "Canonical student credentials read" ON public.student_credentials FOR SELECT TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Canonical student credentials create" ON public.student_credentials FOR INSERT TO authenticated
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student credentials update" ON public.student_credentials FOR UPDATE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'))
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student credentials delete" ON public.student_credentials FOR DELETE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'));

DROP POLICY IF EXISTS "Canonical teacher credentials read" ON public.teacher_credentials;
DROP POLICY IF EXISTS "Canonical teacher credentials create" ON public.teacher_credentials;
DROP POLICY IF EXISTS "Canonical teacher credentials update" ON public.teacher_credentials;
DROP POLICY IF EXISTS "Canonical teacher credentials delete" ON public.teacher_credentials;
CREATE POLICY "Canonical teacher credentials read" ON public.teacher_credentials FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teachers teacher
      WHERE teacher.id = teacher_credentials.teacher_id
        AND (
          teacher.user_id = (select auth.uid())
          OR EXISTS (
            SELECT 1
            FROM public.class_session_teachers assignment
            JOIN public.class_sessions session ON session.id = assignment.class_session_id
            WHERE assignment.teacher_id = teacher.id
              AND public.can_access_class_session(session.id, 'teaching.teachers.read')
          )
        )
    )
  );
CREATE POLICY "Canonical teacher credentials create" ON public.teacher_credentials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.teachers teacher WHERE teacher.id = teacher_credentials.teacher_id AND teacher.user_id = (select auth.uid())));
CREATE POLICY "Canonical teacher credentials update" ON public.teacher_credentials FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teachers teacher WHERE teacher.id = teacher_credentials.teacher_id AND teacher.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.teachers teacher WHERE teacher.id = teacher_credentials.teacher_id AND teacher.user_id = (select auth.uid())));
CREATE POLICY "Canonical teacher credentials delete" ON public.teacher_credentials FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teachers teacher WHERE teacher.id = teacher_credentials.teacher_id AND teacher.user_id = (select auth.uid())));

DROP POLICY IF EXISTS "Canonical classroom schedules read" ON public.classroom_schedules;
DROP POLICY IF EXISTS "Canonical classroom schedules create" ON public.classroom_schedules;
DROP POLICY IF EXISTS "Canonical classroom schedules update" ON public.classroom_schedules;
DROP POLICY IF EXISTS "Canonical classroom schedules delete" ON public.classroom_schedules;
CREATE POLICY "Canonical classroom schedules read" ON public.classroom_schedules FOR SELECT TO authenticated
  USING (public.can_access_classroom(classroom_id, 'teaching.classrooms.read'));
CREATE POLICY "Canonical classroom schedules create" ON public.classroom_schedules FOR INSERT TO authenticated
  WITH CHECK (public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));
CREATE POLICY "Canonical classroom schedules update" ON public.classroom_schedules FOR UPDATE TO authenticated
  USING (public.can_access_classroom(classroom_id, 'teaching.classrooms.update'))
  WITH CHECK (public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));
CREATE POLICY "Canonical classroom schedules delete" ON public.classroom_schedules FOR DELETE TO authenticated
  USING (public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('student_contacts', 'student_schools', 'student_credentials', 'teacher_credentials', 'classroom_schedules')
      AND cmd = 'ALL'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    RAISE EXCEPTION '1000051 authenticated-wide child policies remain';
  END IF;
END;
$$;

-- ==========================================================================
-- Former migration 1000052_transfer_scope_authorization.sql
-- ===========================================================================

-- Forward-only authorization preflight for transfer cancellation.
-- The mutating cancellation RPC remains the final authority; this helper
-- prevents an idempotency replay from being reserved before authorization.

DO $$
BEGIN
  IF to_regclass('public.single_lesson_transfers') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.class_occurrences') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000052 prerequisites missing; apply migrations through 1000051 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_single_lesson_transfer(
  p_transfer_id uuid,
  p_permission_key text DEFAULT 'teaching.enrollments.update'
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN true
    WHEN auth.uid() IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.single_lesson_transfers transfer
      JOIN public.enrollments enrollment ON enrollment.id = transfer.enrollment_id
      JOIN public.class_occurrences source_occurrence ON source_occurrence.id = transfer.source_occurrence_id
      JOIN public.class_occurrences target_occurrence ON target_occurrence.id = transfer.target_occurrence_id
      WHERE transfer.id = p_transfer_id
        AND transfer.cancelled_at IS NULL
        AND (
          enrollment.user_id = auth.uid()
          OR (
            public.has_api_permission(auth.uid(), p_permission_key, NULL, source_occurrence.class_session_id)
            AND public.has_api_permission(auth.uid(), p_permission_key, NULL, target_occurrence.class_session_id)
          )
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.can_access_single_lesson_transfer(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_single_lesson_transfer(uuid, text) TO authenticated, service_role;

-- ==========================================================================
-- Former migration 1000053_enrollment_scope_and_student_guard.sql
-- ===========================================================================

-- Forward-only enrollment scope hardening.
-- Enrollment access must resolve through session, classroom, or course and the
-- referenced student must already be visible to the acting user.

DO $$
BEGIN
  IF to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_teaching(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000053 prerequisites missing; apply migrations through 1000052 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_enrollment_scope(
  p_student_id uuid,
  p_course_id uuid,
  p_classroom_id uuid,
  p_class_session_id uuid,
  p_permission_key text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH input_row AS (
  SELECT p_student_id AS student_id, p_course_id AS course_id,
         p_classroom_id AS classroom_id, p_class_session_id AS session_id
), resolved AS (
  SELECT input_row.*,
         course.teaching_id AS course_teaching_id,
         classroom.teaching_id AS classroom_teaching_id,
         session.teaching_id AS session_teaching_id
  FROM input_row
  LEFT JOIN public.courses course ON course.id = input_row.course_id
  LEFT JOIN public.classrooms classroom ON classroom.id = input_row.classroom_id
  LEFT JOIN public.class_sessions session ON session.id = input_row.session_id
)
SELECT EXISTS (
  SELECT 1
  FROM resolved
  WHERE COALESCE(session_teaching_id, classroom_teaching_id, course_teaching_id) IS NOT NULL
    AND (session_teaching_id IS NULL OR session_teaching_id = COALESCE(session_teaching_id, classroom_teaching_id, course_teaching_id))
    AND (classroom_teaching_id IS NULL OR classroom_teaching_id = COALESCE(session_teaching_id, classroom_teaching_id, course_teaching_id))
    AND (course_teaching_id IS NULL OR course_teaching_id = COALESCE(session_teaching_id, classroom_teaching_id, course_teaching_id))
    AND public.can_access_student(student_id, p_permission_key)
    AND public.can_access_teaching(COALESCE(session_teaching_id, classroom_teaching_id, course_teaching_id), p_permission_key)
);
$$;

CREATE OR REPLACE FUNCTION public.can_access_enrollment(
  p_enrollment_id uuid, p_permission_key text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollments enrollment
    LEFT JOIN public.courses course ON course.id = enrollment.course_id
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    WHERE enrollment.id = p_enrollment_id
      AND public.can_access_student(enrollment.student_id, p_permission_key)
      AND public.can_access_teaching(
        COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
        p_permission_key
      )
  );
$$;

DROP POLICY IF EXISTS "Teaching scoped enrollments" ON public.enrollments;
DROP POLICY IF EXISTS "Teaching enrollments read" ON public.enrollments;
DROP POLICY IF EXISTS "Teaching enrollments create" ON public.enrollments;
DROP POLICY IF EXISTS "Teaching enrollments update" ON public.enrollments;
DROP POLICY IF EXISTS "Teaching enrollments delete" ON public.enrollments;
DROP POLICY IF EXISTS "Canonical enrollments read" ON public.enrollments;
DROP POLICY IF EXISTS "Canonical enrollments create" ON public.enrollments;
DROP POLICY IF EXISTS "Canonical enrollments update" ON public.enrollments;
DROP POLICY IF EXISTS "Canonical enrollments delete" ON public.enrollments;

CREATE POLICY "Canonical enrollments read" ON public.enrollments FOR SELECT TO authenticated
  USING (public.can_access_enrollment(id, 'teaching.enrollments.read') OR public.can_access_enrollment(id, 'teaching.enrollments.list'));
CREATE POLICY "Canonical enrollments create" ON public.enrollments FOR INSERT TO authenticated
  WITH CHECK (public.can_access_enrollment_scope(student_id, course_id, classroom_id, class_session_id, 'teaching.enrollments.create'));
CREATE POLICY "Canonical enrollments update" ON public.enrollments FOR UPDATE TO authenticated
  USING (public.can_access_enrollment(id, 'teaching.enrollments.update'))
  WITH CHECK (public.can_access_enrollment_scope(student_id, course_id, classroom_id, class_session_id, 'teaching.enrollments.update'));
CREATE POLICY "Canonical enrollments delete" ON public.enrollments FOR DELETE TO authenticated
  USING (public.can_access_enrollment(id, 'teaching.enrollments.delete'));

REVOKE ALL ON FUNCTION public.can_access_enrollment_scope(uuid, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_enrollment_scope(uuid, uuid, uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_access_enrollment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_enrollment(uuid, text) TO authenticated, service_role;

-- ==========================================================================
-- Former migration 1000054_rbac_teaching_scope_rpc.sql
-- ===========================================================================

-- Forward-only RBAC policy replacement scope expansion.

DO $$
BEGIN
  IF to_regprocedure('public.replace_role_permission_policies(text,text,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.can_manage_editor_rbac()') IS NULL
     OR to_regprocedure('public.has_teaching_permission(uuid,text,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000054 prerequisites missing; apply migrations through 1000053 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_role_permission_policies(
  p_permission_key text, p_scope_type text, p_scope_id uuid, p_policies jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_permission_id uuid;
  v_allowed boolean := false;
BEGIN
  v_allowed := public.can_manage_editor_rbac();
  IF NOT v_allowed AND p_scope_type = 'teaching' AND p_scope_id IS NOT NULL THEN
    v_allowed := public.has_teaching_permission(auth.uid(), 'teaching.members.manage', p_scope_id, NULL, NULL);
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  IF p_scope_type NOT IN ('system', 'teaching', 'classroom', 'class_session')
     OR (p_scope_type = 'system' AND p_scope_id IS NOT NULL)
     OR (p_scope_type <> 'system' AND p_scope_id IS NULL) THEN
    RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
  END IF;
  IF p_scope_type = 'teaching' AND NOT EXISTS (SELECT 1 FROM public.teachings WHERE id = p_scope_id) THEN
    RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
  END IF;
  IF p_scope_type = 'classroom' AND NOT EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_scope_id) THEN
    RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
  END IF;
  IF p_scope_type = 'class_session' AND NOT EXISTS (SELECT 1 FROM public.class_sessions WHERE id = p_scope_id) THEN
    RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
  END IF;
  SELECT id INTO v_permission_id FROM public.permissions WHERE key = p_permission_key;
  IF v_permission_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PERMISSION'; END IF;
  DELETE FROM public.role_permission_policies
  WHERE permission_id = v_permission_id AND scope_type = p_scope_type AND scope_id IS NOT DISTINCT FROM p_scope_id;
  INSERT INTO public.role_permission_policies (role_id, permission_id, scope_type, scope_id, effect)
  SELECT (item->>'role_id')::uuid, v_permission_id, p_scope_type, p_scope_id, item->>'effect'
  FROM jsonb_array_elements(COALESCE(p_policies, '[]'::jsonb)) item
  WHERE item->>'effect' IN ('allow', 'deny');
END;
$$;

REVOKE ALL ON FUNCTION public.replace_role_permission_policies(text,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_role_permission_policies(text,text,uuid,jsonb) TO authenticated;

-- ==========================================================================
-- Former migration 1000055_idempotency_route_binding.sql
-- ===========================================================================

-- Forward-only idempotency safety: a key cannot be replayed across routes or methods.

DO $$
BEGIN
  IF to_regclass('public.api_idempotency_keys') IS NULL
     OR to_regprocedure('public.reserve_api_idempotency(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '1000055 prerequisites missing; apply migrations through 1000054 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_api_idempotency(
  p_user_id uuid, p_key text, p_method text, p_route text
) RETURNS TABLE(is_replay boolean, response_status integer, response_body jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_method text;
  v_route text;
  v_status integer;
  v_body jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  DELETE FROM public.api_idempotency_keys WHERE expires_at < timezone('utc'::text, now());
  INSERT INTO public.api_idempotency_keys(user_id, idempotency_key, method, route)
  VALUES (p_user_id, p_key, p_method, p_route)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING;
  SELECT method, route, response_status, response_body
    INTO v_method, v_route, v_status, v_body
  FROM public.api_idempotency_keys
  WHERE user_id = p_user_id AND idempotency_key = p_key
  FOR UPDATE;
  IF v_method IS DISTINCT FROM p_method OR v_route IS DISTINCT FROM p_route THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IDEMPOTENCY_KEY_REUSED';
  END IF;
  RETURN QUERY SELECT v_status IS NOT NULL, v_status, v_body;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_api_idempotency(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_api_idempotency(uuid,text,text,text) TO service_role;

-- ==========================================================================
-- Former migration 1000056_canonical_rbac_policy_scope_rls.sql
-- ===========================================================================

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

-- ==========================================================================
-- Former migration 1000057_holiday_read_permission_alias.sql
-- ===========================================================================

-- Forward-only holiday read compatibility. Mutations remain system-only for
-- empty-scope global holidays; scoped rows use either read or list authority.

DO $$
BEGIN
  IF to_regclass('public.holidays') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('public.can_access_classroom(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_class_session(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000057 prerequisites missing; apply migrations through 1000056 first';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Canonical holidays read" ON public.holidays;
CREATE POLICY "Canonical holidays read" ON public.holidays
FOR SELECT TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND (
      public.has_api_permission((select auth.uid()), 'teaching.holidays.read', NULL, NULL)
      OR public.has_api_permission((select auth.uid()), 'teaching.holidays.list', NULL, NULL)
    )
  )
  OR (
    (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
      WHERE NOT (
        public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.read')
        OR public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.list')
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
      WHERE NOT (
        public.can_access_class_session(scoped_session_id, 'teaching.holidays.read')
        OR public.can_access_class_session(scoped_session_id, 'teaching.holidays.list')
      )
    )
  )
);

-- ==========================================================================
-- Former migration 1000058_teaching_role_scope_isolation.sql
-- ===========================================================================

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

-- ==========================================================================
-- Former migration 1000059_idempotency_key_contract.sql
-- ===========================================================================

-- Forward-only contract alignment for the API Idempotency-Key header.
-- The server accepts 8..255 characters; the historical database constraint
-- incorrectly stopped at 128.

DO $$
BEGIN
  IF to_regclass('public.api_idempotency_keys') IS NULL THEN
    RAISE EXCEPTION '1000059 prerequisites missing; apply migrations through 1000058 first';
  END IF;
END;
$$;

ALTER TABLE public.api_idempotency_keys
  DROP CONSTRAINT IF EXISTS api_idempotency_key_shape;
ALTER TABLE public.api_idempotency_keys
  ADD CONSTRAINT api_idempotency_key_shape CHECK (length(idempotency_key) BETWEEN 8 AND 255);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.api_idempotency_keys WHERE length(idempotency_key) NOT BETWEEN 8 AND 255
  ) THEN
    RAISE EXCEPTION '1000059 existing idempotency key violates the API length contract';
  END IF;
END;
$$;

-- ==========================================================================
-- Former migration 1000060_permission_scope_and_session_regression.sql
-- ===========================================================================

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

-- ==========================================================================
-- Former migration 1000061_scope_and_idempotency_concurrency.sql
-- ===========================================================================

-- Forward-only security corrections after 1000060.
-- This migration keeps global holiday reads compatible, binds teaching-scoped
-- policy rows to their actual teaching, makes scoped RBAC management safe for
-- least-privilege users, and serializes concurrent idempotent mutations.

DO $$
BEGIN
  IF to_regclass('public.teachings') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR to_regclass('public.api_idempotency_keys') IS NULL
     OR to_regprocedure('public.resolve_teaching_permission(uuid,text,uuid,uuid,uuid,date)') IS NULL
     OR to_regprocedure('public.replace_role_permission_policies(text,text,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION '1000061 prerequisites missing; apply migrations through 1000060 first';
  END IF;
END;
$$;

-- A no-scope holiday read is allowed when the caller has read/list authority
-- in at least one active teaching. Empty-scope mutations remain system-only.
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
        AND public.has_teaching_permission(p_user_id, p_permission_key, classroom.teaching_id, p_classroom_id, p_class_session_id)
    )
    WHEN p_classroom_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.classrooms classroom
      WHERE classroom.id = p_classroom_id
        AND public.has_teaching_permission(p_user_id, p_permission_key, classroom.teaching_id, p_classroom_id, NULL)
    )
    WHEN p_class_session_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.class_sessions session
      WHERE session.id = p_class_session_id
        AND public.has_teaching_permission(p_user_id, p_permission_key, session.teaching_id, NULL, p_class_session_id)
    )
    WHEN p_permission_key LIKE 'system.%' THEN public.has_system_permission(p_user_id, p_permission_key)
    WHEN p_permission_key IN ('teaching.holidays.read', 'teaching.holidays.list') THEN
      public.has_system_permission(p_user_id, p_permission_key)
      OR EXISTS (
        SELECT 1
        FROM public.teaching_members member
        WHERE member.user_id = p_user_id
          AND member.status = 'active'
          AND member.effective_from <= CURRENT_DATE
          AND (member.effective_to IS NULL OR member.effective_to >= CURRENT_DATE)
          AND public.has_teaching_permission(p_user_id, p_permission_key, member.teaching_id, NULL, NULL)
      )
    WHEN p_permission_key IN ('teaching.holidays.create', 'teaching.holidays.update', 'teaching.holidays.delete') THEN
      public.has_system_permission(p_user_id, p_permission_key)
    WHEN p_permission_key = 'teaching.teachings.create' THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.teaching_members member
      WHERE member.user_id = p_user_id
        AND member.status = 'active'
        AND member.effective_from <= CURRENT_DATE
        AND (member.effective_to IS NULL OR member.effective_to >= CURRENT_DATE)
        AND public.has_teaching_permission(p_user_id, p_permission_key, member.teaching_id, NULL, NULL)
    )
  END;
$$;

-- Scope existence is intentionally checked by a narrow definer helper. It
-- prevents the invoker RPC from requiring unrelated read permissions merely
-- to validate the target scope, while writes still pass through RLS.
CREATE OR REPLACE FUNCTION public.rbac_scope_exists(p_scope_type text, p_scope_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_scope_type
    -- Service-role callers are explicit management operations. Authenticated
    -- callers only receive a positive result when they can manage the same
    -- scope, so this SECURITY DEFINER helper is not an existence oracle.
    WHEN 'system' THEN
      p_scope_id IS NULL
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
      )
    WHEN 'teaching' THEN
      EXISTS (SELECT 1 FROM public.teachings WHERE id = p_scope_id)
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_teaching_permission(auth.uid(), 'teaching.members.manage', p_scope_id, NULL, NULL)
      )
    WHEN 'classroom' THEN
      EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_scope_id)
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_api_permission(auth.uid(), 'teaching.members.manage', p_scope_id, NULL)
      )
    WHEN 'class_session' THEN
      EXISTS (SELECT 1 FROM public.class_sessions WHERE id = p_scope_id)
      AND (
        auth.role() = 'service_role'
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_api_permission(auth.uid(), 'teaching.members.manage', NULL, p_scope_id)
      )
    ELSE false
  END;
$$;

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
      OR (policy.scope_type = 'teaching' AND policy.scope_id = p_teaching_id AND (
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
     OR (p_scope_type <> 'system' AND p_scope_id IS NULL)
     OR NOT public.rbac_scope_exists(p_scope_type, p_scope_id) THEN
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

REVOKE ALL ON FUNCTION public.rbac_scope_exists(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rbac_scope_exists(text, uuid) TO authenticated, service_role;

-- Reconcile holiday SELECT with both collection and item permissions. The
-- API uses `list` for collections while older callers may still hold `read`.
-- Mutation policies remain unchanged; global mutations stay system-only.
DROP POLICY IF EXISTS "Canonical holidays read" ON public.holidays;
CREATE POLICY "Canonical holidays read" ON public.holidays
FOR SELECT TO authenticated
USING (
  (
    COALESCE(cardinality(classroom_ids), 0) = 0
    AND COALESCE(cardinality(class_session_ids), 0) = 0
    AND (
      public.has_api_permission(auth.uid(), 'teaching.holidays.read', NULL, NULL)
      OR public.has_api_permission(auth.uid(), 'teaching.holidays.list', NULL, NULL)
    )
  )
  OR (
    (COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(classroom_ids, '{}'::uuid[])) AS scoped_classroom(scoped_classroom_id)
      WHERE NOT (
        public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.read')
        OR public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.list')
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(class_session_ids, '{}'::uuid[])) AS scoped_session(scoped_session_id)
      WHERE NOT (
        public.can_access_class_session(scoped_session_id, 'teaching.holidays.read')
        OR public.can_access_class_session(scoped_session_id, 'teaching.holidays.list')
      )
    )
  )
);

-- A reserved but incomplete key is a lease, not a second permission to run.
ALTER TABLE public.api_idempotency_keys
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

UPDATE public.api_idempotency_keys
SET processing_started_at = created_at
WHERE response_status IS NULL AND processing_started_at IS NULL;

CREATE OR REPLACE FUNCTION public.reserve_api_idempotency(
  p_user_id uuid, p_key text, p_method text, p_route text
) RETURNS TABLE(is_replay boolean, response_status integer, response_body jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_method text;
  v_route text;
  v_status integer;
  v_body jsonb;
  v_started timestamptz;
  v_inserted boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  DELETE FROM public.api_idempotency_keys WHERE expires_at < timezone('utc'::text, now());
  INSERT INTO public.api_idempotency_keys(user_id, idempotency_key, method, route, processing_started_at)
  VALUES (p_user_id, p_key, p_method, p_route, timezone('utc'::text, now()))
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING true INTO v_inserted;
  IF v_inserted THEN
    RETURN QUERY SELECT false, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;
  SELECT method, route, response_status, response_body, processing_started_at
    INTO v_method, v_route, v_status, v_body, v_started
  FROM public.api_idempotency_keys
  WHERE user_id = p_user_id AND idempotency_key = p_key
  FOR UPDATE;
  IF v_method IS DISTINCT FROM p_method OR v_route IS DISTINCT FROM p_route THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'IDEMPOTENCY_KEY_REUSED';
  END IF;
  IF v_status IS NOT NULL THEN
    RETURN QUERY SELECT true, v_status, v_body;
    RETURN;
  END IF;
  IF v_started IS NOT NULL AND v_started > timezone('utc'::text, now()) - interval '15 minutes' THEN
    RETURN QUERY SELECT true, 409,
      jsonb_build_object('error', jsonb_build_object(
        'code', 'IDEMPOTENCY_IN_PROGRESS',
        'message', 'An identical mutation is already being processed',
        'fields', '{}'::jsonb
      ));
    RETURN;
  END IF;
  UPDATE public.api_idempotency_keys
  SET processing_started_at = timezone('utc'::text, now())
  WHERE user_id = p_user_id AND idempotency_key = p_key;
  RETURN QUERY SELECT false, NULL::integer, NULL::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_api_idempotency(
  p_user_id uuid, p_key text, p_status integer, p_body jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  UPDATE public.api_idempotency_keys
  SET response_status = p_status, response_body = p_body, processing_started_at = NULL
  WHERE user_id = p_user_id AND idempotency_key = p_key;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_api_idempotency(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_api_idempotency(uuid,text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_api_idempotency(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_api_idempotency(uuid,text,integer,jsonb) TO service_role;

-- ==========================================================================
-- Former migration 1000062_report_lifecycle_atomicity.sql
-- ===========================================================================

-- Forward-only report lifecycle boundary.
-- Historical migrations through 1000039 are immutable. This function keeps the
-- report mutation, progress calculation, and next-report provisioning atomic.
-- This helper deliberately does not call can_access_occurrence_report(). That
-- legacy editor fallback is useful for read compatibility, but must never
-- grant a write/delete performed by this SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public.can_mutate_occurrence_report(
  p_report_id uuid,
  p_permission_key text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.occurrence_reports report
    JOIN public.class_occurrences occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.class_sessions session ON session.id = occurrence.class_session_id
    WHERE report.id = p_report_id
      AND p_permission_key IN ('teaching.reports.update', 'teaching.reports.delete')
      AND public.can_access_teaching(session.teaching_id, p_permission_key)
  );
$$;

REVOKE ALL ON FUNCTION public.can_mutate_occurrence_report(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_mutate_occurrence_report(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_occurrence_report_lifecycle(
  p_report_id uuid,
  p_expected_version integer,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_actor uuid DEFAULT auth.uid(),
  p_operation text DEFAULT 'update'
) RETURNS public.occurrence_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.occurrence_reports%ROWTYPE;
  v_report public.occurrence_reports%ROWTYPE;
  v_permission text;
  v_enrollment public.enrollments%ROWTYPE;
  v_occurrence public.class_occurrences%ROWTYPE;
  v_base_session public.class_sessions%ROWTYPE;
  v_next public.class_occurrences%ROWTYPE;
  v_next_date date;
  v_start_time time;
  v_end_time time;
  v_next_lesson integer;
  v_next_attendance_status text := 'pending';
  v_next_absence_reason text := NULL;
BEGIN
  IF p_operation NOT IN ('update', 'delete') THEN
    RAISE EXCEPTION 'INVALID_OPERATION';
  END IF;
  IF p_actor IS NULL OR auth.uid() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  v_permission := CASE WHEN p_operation = 'delete' THEN 'teaching.reports.delete' ELSE 'teaching.reports.update' END;
  IF NOT public.can_mutate_occurrence_report(p_report_id, v_permission) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT * INTO v_current
  FROM public.occurrence_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF v_current.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT';
  END IF;

  IF p_operation = 'delete' THEN
    DELETE FROM public.occurrence_reports WHERE id = p_report_id RETURNING * INTO v_report;
    SELECT * INTO v_enrollment FROM public.enrollments WHERE id = v_report.enrollment_id FOR UPDATE;
  ELSE
    IF (p_patch ? 'absence_reason')
       AND (p_patch->>'absence_reason') IN ('holiday', 'suspension')
       AND v_current.absence_reason IS DISTINCT FROM (p_patch->>'absence_reason') THEN
      RAISE EXCEPTION 'SYSTEM_MANAGED_REPORT';
    END IF;
    IF v_current.absence_reason IN ('holiday', 'suspension')
       AND ((p_patch ? 'attendance_status' AND p_patch->>'attendance_status' IS DISTINCT FROM v_current.attendance_status)
         OR (p_patch ? 'absence_reason' AND p_patch->>'absence_reason' IS DISTINCT FROM v_current.absence_reason)) THEN
      RAISE EXCEPTION 'SYSTEM_MANAGED_REPORT';
    END IF;

    UPDATE public.occurrence_reports
    SET lesson_id = CASE WHEN p_patch ? 'lesson_id' THEN NULLIF(p_patch->>'lesson_id', '')::uuid ELSE lesson_id END,
        is_completed = CASE WHEN p_patch ? 'is_completed' THEN (p_patch->>'is_completed')::boolean ELSE is_completed END,
        progress_letter = CASE WHEN p_patch ? 'progress_letter' THEN NULLIF(p_patch->>'progress_letter', '') ELSE progress_letter END,
        attendance_status = CASE WHEN p_patch ? 'attendance_status' THEN p_patch->>'attendance_status' ELSE attendance_status END,
        absence_reason = CASE WHEN p_patch ? 'absence_reason' THEN NULLIF(p_patch->>'absence_reason', '') ELSE absence_reason END,
        class_participation = CASE WHEN p_patch ? 'class_participation' THEN (p_patch->>'class_participation')::numeric ELSE class_participation END,
        classroom_behavior = CASE WHEN p_patch ? 'classroom_behavior' THEN (p_patch->>'classroom_behavior')::numeric ELSE classroom_behavior END,
        contact_notes = CASE WHEN p_patch ? 'contact_notes' THEN NULLIF(p_patch->>'contact_notes', '') ELSE contact_notes END,
        contact_notes_document = CASE WHEN p_patch ? 'contact_notes_document' THEN NULLIF(p_patch->'contact_notes_document', 'null'::jsonb) ELSE contact_notes_document END,
        class_notes = CASE WHEN p_patch ? 'class_notes' THEN NULLIF(p_patch->>'class_notes', '') ELSE class_notes END,
        class_notes_document = CASE WHEN p_patch ? 'class_notes_document' THEN NULLIF(p_patch->'class_notes_document', 'null'::jsonb) ELSE class_notes_document END,
        content = CASE WHEN p_patch ? 'content' THEN NULLIF(p_patch->>'content', '') ELSE content END,
        content_document = CASE WHEN p_patch ? 'content_document' THEN NULLIF(p_patch->'content_document', 'null'::jsonb) ELSE content_document END,
        external_link = CASE WHEN p_patch ? 'external_link' THEN NULLIF(p_patch->>'external_link', '') ELSE external_link END,
        version = version + 1,
        last_edited_by = p_actor,
        last_edited_at = timezone('utc'::text, now())
    WHERE id = p_report_id AND version = p_expected_version
    RETURNING * INTO v_report;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'VERSION_CONFLICT';
    END IF;
    SELECT * INTO v_enrollment FROM public.enrollments WHERE id = v_report.enrollment_id FOR UPDATE;
  END IF;

  IF v_enrollment.id IS NOT NULL THEN
    SELECT COALESCE(min(lesson.sequence), v_enrollment.lesson_number)
      INTO v_next_lesson
    FROM public.lessons lesson
    WHERE lesson.course_id = v_enrollment.course_id
      AND NOT EXISTS (
        SELECT 1 FROM public.occurrence_reports completed_report
        WHERE completed_report.enrollment_id = v_enrollment.id
          AND completed_report.lesson_id = lesson.id
          AND completed_report.is_completed IS TRUE
      );
    UPDATE public.enrollments
    SET lesson_number = COALESCE(v_next_lesson, lesson_number)
    WHERE id = v_enrollment.id;
  END IF;

  IF p_operation = 'update'
     AND v_enrollment.status = 'regular'
     AND (p_patch ? 'lesson_id' OR p_patch ? 'is_completed')
     AND v_report.is_completed IS TRUE
     AND v_report.lesson_id IS NOT NULL THEN
    SELECT * INTO v_occurrence FROM public.class_occurrences WHERE id = v_report.class_occurrence_id;
    IF v_occurrence.id IS NOT NULL THEN
      -- A single-lesson transfer may place the current report in a make-up
      -- session. Future reports still follow the enrollment's normal session.
      SELECT * INTO v_base_session FROM public.class_sessions WHERE id = v_enrollment.class_session_id;
      IF v_base_session.id IS NULL THEN
        RETURN v_report;
      END IF;
      SELECT * INTO v_next
      FROM public.class_occurrences occurrence
      WHERE occurrence.class_session_id = v_base_session.id
        AND occurrence.occurrence_date > v_occurrence.occurrence_date
        AND (v_base_session.end_date IS NULL OR occurrence.occurrence_date <= v_base_session.end_date)
      ORDER BY occurrence.occurrence_date
      LIMIT 1;

      IF v_next.id IS NULL THEN
        SELECT candidate::date, rule.start_time, rule.end_time
          INTO v_next_date, v_start_time, v_end_time
        FROM generate_series(
          v_occurrence.occurrence_date + 1,
          LEAST(v_occurrence.occurrence_date + 730, COALESCE(v_base_session.end_date, v_occurrence.occurrence_date + 730)),
          interval '1 day'
        ) candidate
        JOIN public.class_session_schedule_rules rule
          ON rule.class_session_id = v_base_session.id
         AND ((rule.schedule_kind = 'weekly' AND rule.day_of_week = EXTRACT(DOW FROM candidate)::integer)
           OR (rule.schedule_kind = 'monthly' AND rule.day_of_month = EXTRACT(DAY FROM candidate)::integer)
           OR (rule.schedule_kind = 'specific_dates' AND rule.occurrence_date = candidate::date))
        ORDER BY candidate
        LIMIT 1;
        IF v_next_date IS NOT NULL THEN
          INSERT INTO public.class_occurrences(class_session_id, occurrence_date, status, original_start_time, original_end_time, time_zone, is_conducted)
          SELECT v_base_session.id, v_next_date, 'scheduled', v_start_time, v_end_time, v_base_session.time_zone, true
          WHERE v_base_session.start_date IS NULL OR v_next_date >= v_base_session.start_date
          ON CONFLICT (class_session_id, occurrence_date) DO NOTHING
          RETURNING * INTO v_next;
          IF v_next.id IS NULL THEN
            SELECT * INTO v_next FROM public.class_occurrences occurrence
            WHERE occurrence.class_session_id = v_base_session.id AND occurrence.occurrence_date = v_next_date;
          END IF;
        END IF;
      END IF;

      IF v_next.id IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.student_suspensions suspension
          WHERE suspension.enrollment_id = v_enrollment.id
            AND suspension.start_date <= v_next.occurrence_date
            AND (suspension.end_date IS NULL OR suspension.end_date >= v_next.occurrence_date)
        ) THEN
          v_next_attendance_status := 'absent';
          v_next_absence_reason := 'suspension';
        ELSIF EXISTS (
          SELECT 1 FROM public.holidays holiday
          WHERE holiday.kind = 'closure'
            AND holiday.start_date <= v_next.occurrence_date
            AND holiday.end_date >= v_next.occurrence_date
            AND (
              (COALESCE(cardinality(holiday.classroom_ids), 0) = 0 AND COALESCE(cardinality(holiday.class_session_ids), 0) = 0)
              OR v_base_session.classroom_id = ANY(COALESCE(holiday.classroom_ids, '{}'::uuid[]))
              OR v_base_session.id = ANY(COALESCE(holiday.class_session_ids, '{}'::uuid[]))
            )
        ) THEN
          v_next_attendance_status := 'absent';
          v_next_absence_reason := 'holiday';
        END IF;
        INSERT INTO public.occurrence_reports(enrollment_id, class_occurrence_id, content, version, is_completed, attendance_status, absence_reason)
        VALUES (v_enrollment.id, v_next.id, '', 1, false, v_next_attendance_status, v_next_absence_reason)
        ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_occurrence_report_lifecycle(uuid, integer, jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_occurrence_report_lifecycle(uuid, integer, jsonb, uuid, text) TO authenticated, service_role;
