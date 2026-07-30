-- Generic scoped RBAC foundation and incomplete-report notification policies.
-- This migration intentionally preserves role UUIDs and class teacher assignments
-- created by 1000026 while remaining safe when the legacy tables are absent.

DO $$
BEGIN
    IF to_regclass('public.roles') IS NULL AND to_regclass('public.teacher_role_types') IS NOT NULL THEN
        ALTER TABLE public.teacher_role_types RENAME TO roles;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text,
    name text NOT NULL,
    description text,
    is_system boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 100,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT roles_name_not_blank CHECK (length(btrim(name)) > 0)
);

ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS description text;
CREATE UNIQUE INDEX IF NOT EXISTS roles_code_unique ON public.roles (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roles_name_unique ON public.roles (lower(btrim(name)));

INSERT INTO public.roles (code, name, is_system, sort_order) VALUES
    ('instructor', '講師', true, 10),
    ('assistant_instructor', '助教', true, 20),
    ('trainee_instructor', '實習講師', true, 30),
    ('trainee_assistant', '實習助教', true, 40),
    ('teacher', '老師', true, 50),
    ('learning_coach', '學習教練', true, 60),
    ('coach', '教練', true, 70),
    ('trainee_teacher', '實習教師', true, 80),
    ('trainee_tutor', '實習老師', true, 90),
    ('trainee_learning_coach', '實習學習教練', true, 100),
    ('trainee_coach', '實習教練', true, 110)
ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE
SET name = EXCLUDED.name,
    is_system = EXCLUDED.is_system,
    sort_order = EXCLUDED.sort_order;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'class_session_teachers' AND column_name = 'role_type_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'class_session_teachers' AND column_name = 'role_id'
    ) THEN
        ALTER TABLE public.class_session_teachers RENAME COLUMN role_type_id TO role_id;
    END IF;
END $$;

ALTER TABLE public.class_session_teachers ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id);
UPDATE public.class_session_teachers
SET role_id = (SELECT id FROM public.roles WHERE code = 'teacher')
WHERE role_id IS NULL;
ALTER TABLE public.class_session_teachers ALTER COLUMN role_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_class_session_teachers_role_id ON public.class_session_teachers(role_id);

DROP TRIGGER IF EXISTS set_class_session_teacher_default_role ON public.class_session_teachers;
DROP FUNCTION IF EXISTS public.set_default_teacher_role_type();
CREATE OR REPLACE FUNCTION public.set_default_class_session_role()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.role_id IS NULL THEN
        SELECT id INTO NEW.role_id FROM public.roles WHERE code = 'teacher';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER set_class_session_teacher_default_role
    BEFORE INSERT ON public.class_session_teachers
    FOR EACH ROW EXECUTE PROCEDURE public.set_default_class_session_role();

CREATE TABLE IF NOT EXISTS public.permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text NOT NULL UNIQUE,
    name text NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT permissions_key_not_blank CHECK (length(btrim(key)) > 0)
);

INSERT INTO public.permissions (key, name, description) VALUES
    ('reports.incomplete.receive', '接收未完成報告通知', '允許使用者接收其作用域內的未完成報告通知'),
    ('rbac.manage', '管理角色與權限', '保留供後續管理角色、權限與指派使用')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS public.role_permission_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    scope_type text NOT NULL CHECK (scope_type IN ('system', 'classroom', 'class_session')),
    scope_id uuid,
    effect text NOT NULL CHECK (effect IN ('allow', 'deny')),
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT role_permission_policy_scope_shape CHECK (
        (scope_type = 'system' AND scope_id IS NULL)
        OR (scope_type IN ('classroom', 'class_session') AND scope_id IS NOT NULL)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS role_permission_policies_system_unique
    ON public.role_permission_policies(role_id, permission_id) WHERE scope_type = 'system';
CREATE UNIQUE INDEX IF NOT EXISTS role_permission_policies_scoped_unique
    ON public.role_permission_policies(role_id, permission_id, scope_type, scope_id)
    WHERE scope_type <> 'system';
CREATE INDEX IF NOT EXISTS idx_role_permission_policies_resolution
    ON public.role_permission_policies(permission_id, scope_type, scope_id, role_id);

CREATE TABLE IF NOT EXISTS public.user_role_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    scope_type text NOT NULL CHECK (scope_type IN ('system', 'classroom', 'class_session')),
    scope_id uuid,
    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    effective_to date,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT user_role_assignment_scope_shape CHECK (
        (scope_type = 'system' AND scope_id IS NULL)
        OR (scope_type IN ('classroom', 'class_session') AND scope_id IS NOT NULL)
    ),
    CONSTRAINT user_role_assignment_date_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS user_role_assignments_unique
    ON public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from)
    NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_resolution
    ON public.user_role_assignments(user_id, scope_type, scope_id, effective_from, effective_to);

DO $$
BEGIN
    IF to_regclass('public.incomplete_report_notification_rules') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'incomplete_report_notification_rules'
             AND column_name = 'role_type_id'
       ) THEN
        INSERT INTO public.role_permission_policies (role_id, permission_id, scope_type, scope_id, effect)
        SELECT legacy.role_type_id,
               permission.id,
               CASE legacy.scope_type WHEN 'global' THEN 'system' ELSE legacy.scope_type END,
               CASE legacy.scope_type
                   WHEN 'classroom' THEN legacy.classroom_id
                   WHEN 'class_session' THEN legacy.class_session_id
                   ELSE NULL
               END,
               'allow'
        FROM public.incomplete_report_notification_rules legacy
        CROSS JOIN public.permissions permission
        WHERE permission.key = 'reports.incomplete.receive'
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

DROP TABLE IF EXISTS public.incomplete_report_notification_rules;
DROP VIEW IF EXISTS public.teacher_role_types;
CREATE VIEW public.teacher_role_types AS SELECT * FROM public.roles;
CREATE VIEW public.incomplete_report_notification_rules AS
SELECT policy.id,
       CASE policy.scope_type WHEN 'system' THEN 'global' ELSE policy.scope_type END AS scope_type,
       CASE WHEN policy.scope_type = 'classroom' THEN policy.scope_id END AS classroom_id,
       CASE WHEN policy.scope_type = 'class_session' THEN policy.scope_id END AS class_session_id,
       policy.role_id AS role_type_id,
       policy.created_at,
       policy.updated_at
FROM public.role_permission_policies policy
JOIN public.permissions permission ON permission.id = policy.permission_id
WHERE permission.key = 'reports.incomplete.receive' AND policy.effect = 'allow';

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_role_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read teacher roles" ON public.roles;
DROP POLICY IF EXISTS "Authenticated users can create custom teacher roles" ON public.roles;
DROP POLICY IF EXISTS "Authenticated users can update custom teacher roles" ON public.roles;
DROP POLICY IF EXISTS "Authenticated users can delete custom teacher roles" ON public.roles;
CREATE POLICY "Authenticated users can read roles" ON public.roles FOR SELECT
    USING ((SELECT auth.role()) = 'authenticated');
CREATE POLICY "Authenticated users can create custom roles" ON public.roles FOR INSERT
    WITH CHECK ((SELECT auth.role()) = 'authenticated' AND is_system = false);
CREATE POLICY "Authenticated users can update custom roles" ON public.roles FOR UPDATE
    USING ((SELECT auth.role()) = 'authenticated' AND is_system = false)
    WITH CHECK ((SELECT auth.role()) = 'authenticated' AND is_system = false);
CREATE POLICY "Authenticated users can delete custom roles" ON public.roles FOR DELETE
    USING ((SELECT auth.role()) = 'authenticated' AND is_system = false);
CREATE POLICY "Authenticated users can read permissions" ON public.permissions FOR SELECT
    USING ((SELECT auth.role()) = 'authenticated');
CREATE POLICY "Authenticated users can manage role policies" ON public.role_permission_policies FOR ALL
    USING ((SELECT auth.role()) = 'authenticated') WITH CHECK ((SELECT auth.role()) = 'authenticated');
CREATE POLICY "Authenticated users can manage role assignments" ON public.user_role_assignments FOR ALL
    USING ((SELECT auth.role()) = 'authenticated') WITH CHECK ((SELECT auth.role()) = 'authenticated');

DROP TRIGGER IF EXISTS update_teacher_role_types_updated_at ON public.roles;
DROP TRIGGER IF EXISTS update_roles_updated_at ON public.roles;
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON public.roles
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_permissions_updated_at BEFORE UPDATE ON public.permissions
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_role_permission_policies_updated_at BEFORE UPDATE ON public.role_permission_policies
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_user_role_assignments_updated_at BEFORE UPDATE ON public.user_role_assignments
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE OR REPLACE FUNCTION public.replace_role_permission_policies(
    p_permission_key text,
    p_scope_type text,
    p_scope_id uuid,
    p_policies jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_permission_id uuid;
BEGIN
    IF p_scope_type NOT IN ('system', 'classroom', 'class_session')
       OR (p_scope_type = 'system' AND p_scope_id IS NOT NULL)
       OR (p_scope_type <> 'system' AND p_scope_id IS NULL) THEN
        RAISE EXCEPTION 'INVALID_POLICY_SCOPE';
    END IF;

    SELECT id INTO v_permission_id FROM public.permissions WHERE key = p_permission_key;
    IF v_permission_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PERMISSION'; END IF;

    DELETE FROM public.role_permission_policies
    WHERE permission_id = v_permission_id
      AND scope_type = p_scope_type
      AND scope_id IS NOT DISTINCT FROM p_scope_id;

    INSERT INTO public.role_permission_policies (role_id, permission_id, scope_type, scope_id, effect)
    SELECT (item->>'role_id')::uuid, v_permission_id, p_scope_type, p_scope_id, item->>'effect'
    FROM jsonb_array_elements(COALESCE(p_policies, '[]'::jsonb)) item
    WHERE item->>'effect' IN ('allow', 'deny');
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_user_permission(
    p_user_id uuid,
    p_permission_key text,
    p_classroom_id uuid DEFAULT NULL,
    p_class_session_id uuid DEFAULT NULL,
    p_effective_date date DEFAULT CURRENT_DATE
) RETURNS TABLE (is_allowed boolean, is_denied boolean, policy_configured boolean)
LANGUAGE sql STABLE
SET search_path = public
AS $$
WITH target_permission AS (
    SELECT id FROM public.permissions WHERE key = p_permission_key
), assigned_roles AS (
    SELECT assignment.role_id
    FROM public.user_role_assignments assignment
    WHERE assignment.user_id = p_user_id
      AND assignment.effective_from <= p_effective_date
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_effective_date)
      AND (
          assignment.scope_type = 'system'
          OR (assignment.scope_type = 'classroom' AND assignment.scope_id = p_classroom_id)
          OR (assignment.scope_type = 'class_session' AND assignment.scope_id = p_class_session_id)
      )
    UNION
    SELECT class_teacher.role_id
    FROM public.class_session_teachers class_teacher
    JOIN public.teachers teacher ON teacher.id = class_teacher.teacher_id
    WHERE teacher.user_id = p_user_id
      AND class_teacher.class_session_id = p_class_session_id
      AND class_teacher.effective_from <= p_effective_date
      AND (class_teacher.effective_to IS NULL OR class_teacher.effective_to >= p_effective_date)
), effective_role_policies AS (
    SELECT assigned.role_id, resolved.effect
    FROM assigned_roles assigned
    LEFT JOIN LATERAL (
        SELECT policy.effect
        FROM public.role_permission_policies policy
        JOIN target_permission permission ON permission.id = policy.permission_id
        WHERE policy.role_id = assigned.role_id
          AND (
              (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
              OR (policy.scope_type = 'classroom' AND policy.scope_id = p_classroom_id)
              OR policy.scope_type = 'system'
          )
        ORDER BY CASE policy.scope_type WHEN 'class_session' THEN 3 WHEN 'classroom' THEN 2 ELSE 1 END DESC
        LIMIT 1
    ) resolved ON true
), matching_policies AS (
    SELECT EXISTS (
        SELECT 1
        FROM public.role_permission_policies policy
        JOIN target_permission permission ON permission.id = policy.permission_id
        WHERE policy.scope_type = 'system'
           OR (policy.scope_type = 'classroom' AND policy.scope_id = p_classroom_id)
           OR (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
    ) AS configured
)
SELECT
    COALESCE(bool_or(effect = 'allow'), false) AND NOT COALESCE(bool_or(effect = 'deny'), false),
    COALESCE(bool_or(effect = 'deny'), false),
    (SELECT configured FROM matching_policies)
FROM effective_role_policies;
$$;

GRANT SELECT ON public.roles, public.permissions, public.role_permission_policies, public.user_role_assignments TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.roles, public.role_permission_policies, public.user_role_assignments TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_role_permission_policies(text, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_user_permission(uuid, text, uuid, uuid, date) TO authenticated, service_role;
