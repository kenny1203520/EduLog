-- Promote teaching-domain roles to the platform root and add explicit,
-- date-bounded exclusions at classroom and class-session scopes.
-- The historical workspace rows are copied to protected archives before the
-- workspace-scoped tables are retired by the application/API migration.

CREATE TABLE IF NOT EXISTS public.teachings_legacy_archive AS
SELECT teaching.*, timezone('utc'::text, now()) AS archived_at
FROM public.teachings teaching;
CREATE TABLE IF NOT EXISTS public.teaching_members_legacy_archive AS
SELECT member.*, timezone('utc'::text, now()) AS archived_at
FROM public.teaching_members member;
ALTER TABLE public.teachings_legacy_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_members_legacy_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teachings_legacy_archive, public.teaching_members_legacy_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.teachings_legacy_archive, public.teaching_members_legacy_archive TO service_role;

-- The former tables remain only as compatibility/history storage while old
-- teaching_id foreign keys are retired in later schema work. No client may
-- read or mutate them through PostgREST, and writes are rejected even through
-- definer functions so they cannot become a second source of role grants.
CREATE OR REPLACE FUNCTION public.reject_archived_teaching_workspace_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'TEACHING_WORKSPACES_ARCHIVED';
END;
$$;
DROP TRIGGER IF EXISTS archived_teachings_legacy_archive_read_only ON public.teachings_legacy_archive;
CREATE TRIGGER archived_teachings_legacy_archive_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.teachings_legacy_archive
FOR EACH ROW EXECUTE FUNCTION public.reject_archived_teaching_workspace_write();
DROP TRIGGER IF EXISTS archived_teaching_members_legacy_archive_read_only ON public.teaching_members_legacy_archive;
CREATE TRIGGER archived_teaching_members_legacy_archive_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.teaching_members_legacy_archive
FOR EACH ROW EXECUTE FUNCTION public.reject_archived_teaching_workspace_write();
DROP TRIGGER IF EXISTS archived_teachings_read_only ON public.teachings;
CREATE TRIGGER archived_teachings_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.teachings
FOR EACH ROW EXECUTE FUNCTION public.reject_archived_teaching_workspace_write();
DROP TRIGGER IF EXISTS archived_teaching_members_read_only ON public.teaching_members;
CREATE TRIGGER archived_teaching_members_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.teaching_members
FOR EACH ROW EXECUTE FUNCTION public.reject_archived_teaching_workspace_write();
REVOKE ALL ON public.teachings, public.teaching_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.teachings, public.teaching_members TO service_role;

CREATE TABLE IF NOT EXISTS public.user_role_assignment_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('classroom', 'class_session')),
  scope_id uuid NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT user_role_assignment_exclusion_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_role_assignment_exclusions_resolution
  ON public.user_role_assignment_exclusions(user_id, role_id, scope_type, scope_id, effective_from, effective_to);
ALTER TABLE public.user_role_assignment_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_role_assignment_exclusions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_role_assignment_exclusions TO service_role;

-- Retain membership state during promotion. Only active assignments participate
-- in permission resolution; suspended and removed rows remain auditable.
ALTER TABLE public.user_role_assignments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.user_role_assignments
  DROP CONSTRAINT IF EXISTS user_role_assignments_status_check;
ALTER TABLE public.user_role_assignments
  ADD CONSTRAINT user_role_assignments_status_check CHECK (status IN ('active', 'suspended', 'removed'));

-- Install the destination scope rules before promoting rows. The legacy
-- assignment/policy triggers still reject teaching roles at the system root.
CREATE OR REPLACE FUNCTION public.validate_rbac_role_policy_domain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_permission public.permissions;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id = NEW.role_id;
  SELECT * INTO v_permission FROM public.permissions WHERE id = NEW.permission_id;
  IF v_role.id IS NULL OR v_permission.id IS NULL OR v_role.domain <> v_permission.domain THEN RAISE EXCEPTION 'RBAC_DOMAIN_MISMATCH'; END IF;
  IF v_role.domain = 'system' AND NEW.scope_type <> 'system' THEN RAISE EXCEPTION 'RBAC_SCOPE_DOMAIN_MISMATCH'; END IF;
  IF v_role.domain = 'teaching' AND NEW.scope_type NOT IN ('system', 'classroom', 'class_session') THEN RAISE EXCEPTION 'RBAC_SCOPE_DOMAIN_MISMATCH'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_user_role_assignment_domain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id = NEW.role_id;
  IF v_role.id IS NULL
     OR (v_role.domain = 'system' AND NEW.scope_type <> 'system')
     OR (v_role.domain = 'teaching' AND NEW.scope_type NOT IN ('system', 'classroom', 'class_session')) THEN
    RAISE EXCEPTION 'RBAC_ASSIGNMENT_DOMAIN_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

-- Keep same-named custom role definitions from different former workspaces
-- separate while satisfying the new platform-wide role uniqueness indexes.
-- Include the full source id so collisions remain impossible and traceable.
WITH duplicate_codes AS (
  SELECT code FROM public.roles WHERE domain = 'teaching' AND code IS NOT NULL
  GROUP BY code HAVING count(*) > 1
)
UPDATE public.roles role
SET code = left(role.code, 35) || '_from_' || replace(role.teaching_id::text, '-', '')
WHERE role.domain = 'teaching' AND role.teaching_id IS NOT NULL
  AND role.code IN (SELECT code FROM duplicate_codes);

WITH duplicate_names AS (
  SELECT lower(btrim(name)) AS normalized_name FROM public.roles WHERE domain = 'teaching'
  GROUP BY lower(btrim(name)) HAVING count(*) > 1
)
UPDATE public.roles role
SET name = left(role.name, 70) || ' [source ' || replace(role.teaching_id::text, '-', '') || ']'
WHERE role.domain = 'teaching' AND role.teaching_id IS NOT NULL
  AND lower(btrim(role.name)) IN (SELECT normalized_name FROM duplicate_names);

-- The source teaching id no longer limits teaching-domain role definitions.
UPDATE public.roles SET teaching_id = NULL WHERE domain = 'teaching';

-- Preserve the old scope rows in the archive and promote their active role
-- periods to the platform root. The current migration chain deliberately kept
-- these rows inactive at their old ids; this is the explicit global promotion.
DROP TRIGGER IF EXISTS system_role_assignment_no_overlap ON public.user_role_assignments;
DROP TRIGGER IF EXISTS classroom_role_assignment_no_overlap ON public.user_role_assignments;
DROP INDEX IF EXISTS public.user_role_assignments_unique;

UPDATE public.user_role_assignments assignment
SET scope_type = 'system', scope_id = NULL, updated_at = timezone('utc'::text, now())
FROM public.roles role
WHERE assignment.role_id = role.id
  AND role.domain = 'teaching'
  AND assignment.scope_type = 'teaching';

INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, effective_to, status)
SELECT DISTINCT member.user_id, member.role_id, 'system'::text, NULL::uuid,
       member.effective_from, member.effective_to, member.status
FROM public.teaching_members member
JOIN public.roles role ON role.id = member.role_id AND role.domain = 'teaching'
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_role_assignments existing
  WHERE existing.user_id = member.user_id AND existing.role_id = member.role_id
    AND existing.scope_type = 'system' AND existing.status = member.status
    AND existing.effective_from = member.effective_from
    AND existing.effective_to IS NOT DISTINCT FROM member.effective_to
);

-- Merge overlapping root-role periods as a union. Non-overlapping historical
-- periods remain separate, so the conversion does not fill gaps in access.
DO $$
DECLARE v_keep_id uuid; v_remove_id uuid;
BEGIN
  LOOP
    SELECT a.id, b.id INTO v_keep_id, v_remove_id
    FROM public.user_role_assignments a
    JOIN public.roles role ON role.id = a.role_id AND role.domain = 'teaching'
    JOIN public.user_role_assignments b
      ON a.id < b.id AND b.scope_type = 'system'
     AND a.user_id = b.user_id AND a.role_id = b.role_id
     AND a.effective_from <= COALESCE(b.effective_to, 'infinity'::date)
     AND b.effective_from <= COALESCE(a.effective_to, 'infinity'::date)
    WHERE a.scope_type = 'system' AND a.status = b.status
    ORDER BY a.user_id, a.role_id, a.effective_from, b.effective_from
    LIMIT 1;
    EXIT WHEN v_keep_id IS NULL;
    UPDATE public.user_role_assignments keep_assignment
    SET effective_from = LEAST(keep_assignment.effective_from, remove_assignment.effective_from),
        effective_to = CASE
          WHEN keep_assignment.effective_to IS NULL OR remove_assignment.effective_to IS NULL THEN NULL
          ELSE GREATEST(keep_assignment.effective_to, remove_assignment.effective_to)
        END,
        updated_at = timezone('utc'::text, now())
    FROM public.user_role_assignments remove_assignment
    WHERE keep_assignment.id = v_keep_id AND remove_assignment.id = v_remove_id;
    DELETE FROM public.user_role_assignments WHERE id = v_remove_id;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS user_role_assignments_unique
  ON public.user_role_assignments(user_id, role_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from, status);

CREATE OR REPLACE FUNCTION public.prevent_platform_teaching_role_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.scope_type <> 'system' OR NEW.status <> 'active' OR NOT EXISTS (
    SELECT 1 FROM public.roles role WHERE role.id = NEW.role_id AND role.domain = 'teaching'
  ) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('platform-teaching'), hashtext(NEW.user_id::text || ':' || NEW.role_id::text));
  IF EXISTS (
    SELECT 1 FROM public.user_role_assignments existing
    JOIN public.roles role ON role.id = existing.role_id AND role.domain = 'teaching'
    WHERE existing.scope_type = 'system' AND existing.user_id = NEW.user_id AND existing.role_id = NEW.role_id
      AND existing.status = 'active' AND existing.id IS DISTINCT FROM NEW.id
      AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
      AND COALESCE(existing.effective_to, 'infinity'::date) >= NEW.effective_from
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLATFORM_TEACHING_ROLE_ASSIGNMENT_OVERLAP'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_system_role_assignment_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.scope_type <> 'system' OR NEW.status <> 'active' OR NOT EXISTS (
    SELECT 1 FROM public.roles role WHERE role.id = NEW.role_id AND role.domain = 'system'
  ) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text), hashtext(NEW.role_id::text));
  IF EXISTS (
    SELECT 1 FROM public.user_role_assignments existing
    JOIN public.roles role ON role.id = existing.role_id AND role.domain = 'system'
    WHERE existing.scope_type = 'system' AND existing.user_id = NEW.user_id AND existing.role_id = NEW.role_id
      AND existing.status = 'active' AND existing.id IS DISTINCT FROM NEW.id
      AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
      AND COALESCE(existing.effective_to, 'infinity'::date) >= NEW.effective_from
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SYSTEM_ROLE_ASSIGNMENT_OVERLAP'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_classroom_role_assignment_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.scope_type <> 'classroom' OR NEW.status <> 'active' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.scope_id::text), hashtext(NEW.user_id::text || ':' || NEW.role_id::text));
  IF EXISTS (
    SELECT 1 FROM public.user_role_assignments existing
    WHERE existing.scope_type = 'classroom' AND existing.scope_id = NEW.scope_id
      AND existing.user_id = NEW.user_id AND existing.role_id = NEW.role_id
      AND existing.status = 'active' AND existing.id IS DISTINCT FROM NEW.id
      AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
      AND COALESCE(existing.effective_to, 'infinity'::date) >= NEW.effective_from
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CLASSROOM_ROLE_ASSIGNMENT_OVERLAP'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER system_role_assignment_no_overlap
BEFORE INSERT OR UPDATE OF user_id, role_id, scope_type, scope_id, effective_from, effective_to, status
ON public.user_role_assignments FOR EACH ROW EXECUTE FUNCTION public.prevent_system_role_assignment_overlap();
CREATE TRIGGER platform_teaching_role_assignment_no_overlap
BEFORE INSERT OR UPDATE OF user_id, role_id, scope_type, scope_id, effective_from, effective_to, status
ON public.user_role_assignments FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_teaching_role_overlap();
CREATE TRIGGER classroom_role_assignment_no_overlap
BEFORE INSERT OR UPDATE OF user_id, role_id, scope_type, scope_id, effective_from, effective_to, status
ON public.user_role_assignments FOR EACH ROW EXECUTE FUNCTION public.prevent_classroom_role_assignment_overlap();

-- Promote every teaching-domain policy from former teaching roots to the
-- platform root. Materialize before deleting legacy rows; deny wins across
-- source workspaces when policies conflict.
CREATE TEMP TABLE platform_teaching_root_policies ON COMMIT DROP AS
SELECT policy.role_id, policy.permission_id,
       CASE WHEN bool_or(policy.effect = 'deny') THEN 'deny' ELSE 'allow' END AS effect
FROM public.role_permission_policies policy
JOIN public.roles role ON role.id = policy.role_id AND role.domain = 'teaching'
WHERE policy.scope_type = 'teaching'
GROUP BY policy.role_id, policy.permission_id;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role_id, permission_id, 'system', NULL, effect FROM platform_teaching_root_policies
ON CONFLICT (role_id, permission_id) WHERE scope_type = 'system'
DO UPDATE SET effect = CASE WHEN public.role_permission_policies.effect = 'deny' OR EXCLUDED.effect = 'deny' THEN 'deny' ELSE 'allow' END,
              updated_at = timezone('utc'::text, now());

DELETE FROM public.role_permission_policies policy USING public.roles role
WHERE policy.role_id = role.id AND role.domain = 'teaching' AND policy.scope_type = 'teaching';

ALTER TABLE public.role_permission_policies DROP CONSTRAINT IF EXISTS role_permission_policies_scope_shape;
ALTER TABLE public.role_permission_policies ADD CONSTRAINT role_permission_policies_scope_shape CHECK (
  (scope_type = 'system' AND scope_id IS NULL)
  OR (scope_type IN ('classroom', 'class_session') AND scope_id IS NOT NULL)
);
ALTER TABLE public.user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignment_scope_shape;
ALTER TABLE public.user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignments_scope_shape;
ALTER TABLE public.user_role_assignments ADD CONSTRAINT user_role_assignment_scope_shape CHECK (
  (scope_type = 'system' AND scope_id IS NULL)
  OR (scope_type IN ('classroom', 'class_session') AND scope_id IS NOT NULL)
);
ALTER TABLE public.user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignments_scope_type_check;
ALTER TABLE public.user_role_assignments ADD CONSTRAINT user_role_assignments_scope_type_check CHECK (scope_type IN ('system', 'classroom', 'class_session'));

CREATE OR REPLACE FUNCTION public.resolve_teaching_permission(
  p_user_id uuid, p_permission_key text, p_teaching_id uuid,
  p_classroom_id uuid DEFAULT NULL, p_class_session_id uuid DEFAULT NULL,
  p_effective_date date DEFAULT CURRENT_DATE
) RETURNS TABLE(is_allowed boolean, is_denied boolean, policy_configured boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
WITH RECURSIVE target AS (
  SELECT COALESCE(p_classroom_id, (SELECT session.classroom_id FROM public.class_sessions session WHERE session.id = p_class_session_id)) AS classroom_id
), directives AS (
  SELECT assignment.role_id, assignment.scope_type, assignment.scope_id,
         CASE assignment.scope_type WHEN 'system' THEN 0 WHEN 'classroom' THEN 1 ELSE 2 END AS depth,
         'grant'::text AS directive
  FROM public.user_role_assignments assignment
  JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
  CROSS JOIN target
  WHERE assignment.user_id = p_user_id
    AND assignment.status = 'active'
    AND assignment.effective_from <= p_effective_date
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_effective_date)
    AND (assignment.scope_type = 'system'
      OR (assignment.scope_type = 'classroom' AND assignment.scope_id = target.classroom_id)
      OR (assignment.scope_type = 'class_session' AND assignment.scope_id = p_class_session_id))
  UNION ALL
  SELECT exclusion.role_id, exclusion.scope_type, exclusion.scope_id,
         CASE exclusion.scope_type WHEN 'classroom' THEN 1 ELSE 2 END AS depth,
         'exclude'::text AS directive
  FROM public.user_role_assignment_exclusions exclusion
  CROSS JOIN target
  WHERE exclusion.user_id = p_user_id
    AND exclusion.effective_from <= p_effective_date
    AND (exclusion.effective_to IS NULL OR exclusion.effective_to >= p_effective_date)
    AND ((exclusion.scope_type = 'classroom' AND exclusion.scope_id = target.classroom_id)
      OR (exclusion.scope_type = 'class_session' AND exclusion.scope_id = p_class_session_id))
), ranked AS (
  SELECT directives.*, row_number() OVER (PARTITION BY role_id ORDER BY depth DESC, (directive = 'exclude') DESC) AS rank
  FROM directives
), assigned_roles AS (
  SELECT role_id FROM ranked WHERE rank = 1 AND directive = 'grant'
), role_tree(role_id) AS (
  SELECT role_id FROM assigned_roles
  UNION
  SELECT inheritance.parent_role_id FROM public.role_inheritance inheritance JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect
  FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  JOIN role_tree role ON role.role_id = policy.role_id
  CROSS JOIN target
  WHERE permission.key = p_permission_key AND (
    policy.scope_type = 'system'
    OR (policy.scope_type = 'classroom' AND policy.scope_id = target.classroom_id)
    OR (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
  )
)
SELECT COALESCE(bool_or(effect = 'allow'), false) AND NOT COALESCE(bool_or(effect = 'deny'), false),
       COALESCE(bool_or(effect = 'deny'), false), EXISTS (SELECT 1 FROM matched)
FROM matched;
$$;

CREATE OR REPLACE FUNCTION public.has_teaching_permission(
  p_user_id uuid, p_permission_key text, p_teaching_id uuid,
  p_classroom_id uuid DEFAULT NULL, p_class_session_id uuid DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN auth.role() = 'service_role' OR auth.uid() = p_user_id
    THEN COALESCE((SELECT is_allowed AND NOT is_denied FROM public.resolve_teaching_permission(p_user_id, p_permission_key, NULL, p_classroom_id, p_class_session_id, CURRENT_DATE) LIMIT 1), false)
    ELSE false END;
$$;

-- All unscoped teaching permission checks resolve against the platform root.
-- Scoped checks use the same root roles plus the classroom/session path.
CREATE OR REPLACE FUNCTION public.has_api_permission(
  p_user_id uuid, p_permission_key text,
  p_classroom_id uuid DEFAULT NULL, p_class_session_id uuid DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_classroom_id uuid;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RETURN false; END IF;
  IF p_permission_key LIKE 'system.%' THEN
    IF p_classroom_id IS NOT NULL OR p_class_session_id IS NOT NULL THEN RETURN false; END IF;
    RETURN public.has_system_permission(p_user_id, p_permission_key);
  END IF;
  IF p_class_session_id IS NOT NULL THEN
    SELECT session.classroom_id INTO v_classroom_id
    FROM public.class_sessions session WHERE session.id = p_class_session_id;
    IF NOT FOUND OR (p_classroom_id IS NOT NULL AND p_classroom_id <> v_classroom_id) THEN RETURN false; END IF;
    p_classroom_id := v_classroom_id;
  ELSIF p_classroom_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.classrooms classroom WHERE classroom.id = p_classroom_id
  ) THEN RETURN false;
  END IF;
  RETURN COALESCE((SELECT resolved.is_allowed AND NOT resolved.is_denied
    FROM public.resolve_teaching_permission(p_user_id, p_permission_key, NULL, p_classroom_id, p_class_session_id, CURRENT_DATE) resolved), false);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_teaching(p_teaching_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_permission_key IS NOT NULL AND public.has_api_permission(auth.uid(), p_permission_key, NULL, NULL);
$$;

CREATE OR REPLACE FUNCTION public.can_access_classroom(p_classroom_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_permission_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.classrooms classroom WHERE classroom.id = p_classroom_id
      AND public.has_api_permission(auth.uid(), p_permission_key, classroom.id, NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_class_session(p_class_session_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_permission_key IS NOT NULL AND public.has_api_permission(auth.uid(), p_permission_key, NULL, p_class_session_id);
$$;

-- Teacher records are system-level directory data. Account self-access and
-- assigned-class access remain supported without consulting archived teaching
-- workspace rows.
CREATE OR REPLACE FUNCTION public.can_access_teacher(
  p_teacher_id uuid, p_permission_key text DEFAULT 'teaching.teachers.read'
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_records teacher
    JOIN public.profiles profile ON profile.id = teacher.profile_id
    WHERE teacher.id = p_teacher_id AND (
      profile.auth_user_id = auth.uid()
      OR public.has_api_permission(auth.uid(), COALESCE(p_permission_key, 'teaching.teachers.read'), NULL, NULL)
      OR EXISTS (
        SELECT 1 FROM public.class_session_teachers assignment
        JOIN public.class_sessions session ON session.id = assignment.class_session_id
        WHERE assignment.teacher_id = teacher.id
          AND public.has_api_permission(auth.uid(), COALESCE(p_permission_key, 'teaching.teachers.read'), session.classroom_id, session.id)
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_teaching_member(p_teaching_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_role_assignments assignment
    JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
    WHERE assignment.user_id = p_user_id AND assignment.scope_type = 'system'
      AND assignment.status = 'active'
      AND assignment.effective_from <= CURRENT_DATE AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
  );
$$;

CREATE OR REPLACE FUNCTION public.rbac_can_manage_domain(p_domain text, p_teaching_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE p_domain
    WHEN 'system' THEN p_teaching_id IS NULL AND public.has_system_permission(auth.uid(), 'system.roles.manage')
    WHEN 'teaching' THEN public.has_teaching_permission(auth.uid(), 'teaching.roles.manage', NULL, NULL, NULL)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_rbac_capabilities(p_teaching_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'epoch', public.current_rbac_policy_epoch(),
    'system', jsonb_build_object(
      'users_manage', public.has_system_permission(auth.uid(), 'system.users.manage'),
      'roles_manage', public.has_system_permission(auth.uid(), 'system.roles.manage'),
      'assignments_manage', public.has_system_permission(auth.uid(), 'system.role_assignments.manage'),
      'permissions_read', public.has_system_permission(auth.uid(), 'system.permissions.read'),
      'audit_read', public.has_system_permission(auth.uid(), 'system.audit.list'),
      'is_owner', public.rbac_is_system_owner(auth.uid())
    ),
    'teaching', jsonb_build_object(
      'teaching_id', NULL,
      'members_manage', false,
      'roles_manage', public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, NULL),
      'permissions_read', public.has_api_permission(auth.uid(), 'teaching.permissions.read', NULL, NULL)
    )
  );
$$;

DROP POLICY IF EXISTS "RBAC roles are visible in authorized domains" ON public.roles;
CREATE POLICY "RBAC roles are visible in authorized domains" ON public.roles FOR SELECT TO authenticated
USING (
  is_builtin
  OR (domain = 'system' AND (public.has_system_permission((select auth.uid()), 'system.roles.read') OR public.has_system_permission((select auth.uid()), 'system.roles.manage')))
  OR (domain = 'teaching' AND (public.has_api_permission((select auth.uid()), 'teaching.roles.read', NULL, NULL) OR public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, NULL)))
);

REVOKE ALL ON FUNCTION public.replace_role_permission_policies(text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_system_permission(p_user_id uuid, p_permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
WITH RECURSIVE assigned_roles(role_id) AS (
  SELECT assignment.role_id FROM public.user_role_assignments assignment
  WHERE assignment.user_id = p_user_id AND assignment.scope_type = 'system'
    AND assignment.status = 'active' AND assignment.effective_from <= CURRENT_DATE
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
), role_tree(role_id) AS (
  SELECT role_id FROM assigned_roles
  UNION
  SELECT inheritance.parent_role_id FROM public.role_inheritance inheritance
  JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  WHERE policy.role_id IN (SELECT role_id FROM role_tree)
    AND policy.scope_type = 'system' AND permission.key = p_permission_key
)
SELECT auth.role() = 'service_role' OR (
  auth.uid() = p_user_id
  AND COALESCE((SELECT bool_or(effect = 'allow') FROM matched), false)
  AND NOT COALESCE((SELECT bool_or(effect = 'deny') FROM matched), false)
);
$$;

CREATE OR REPLACE FUNCTION public.rbac_is_system_owner(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
WITH RECURSIVE assigned(role_id) AS (
  SELECT assignment.role_id FROM public.user_role_assignments assignment
  WHERE assignment.user_id = p_user_id AND assignment.scope_type = 'system'
    AND assignment.status = 'active' AND assignment.effective_from <= CURRENT_DATE
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
), role_tree(role_id) AS (
  SELECT role_id FROM assigned
  UNION
  SELECT inheritance.parent_role_id FROM public.role_inheritance inheritance
  JOIN role_tree child ON child.role_id = inheritance.role_id
)
SELECT auth.role() = 'service_role' OR (auth.uid() = p_user_id AND EXISTS (
  SELECT 1 FROM role_tree tree JOIN public.roles role ON role.id = tree.role_id
  WHERE role.domain = 'system' AND role.code = 'system_owner'
));
$$;

CREATE OR REPLACE FUNCTION public.rbac_replace_role_permissions(
  p_role_id uuid, p_scope_type text, p_scope_id uuid,
  p_expected_epoch bigint, p_policies jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_policies jsonb := COALESCE(p_policies, '[]'::jsonb); v_allowed boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 2);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR UPDATE;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF v_role.is_protected THEN RAISE EXCEPTION 'PROTECTED_ROLE'; END IF;
  IF (v_role.domain = 'system' AND (p_scope_type <> 'system' OR p_scope_id IS NOT NULL))
     OR (v_role.domain = 'teaching' AND p_scope_type NOT IN ('system', 'classroom', 'class_session'))
     OR (p_scope_type = 'system' AND p_scope_id IS NOT NULL)
     OR (p_scope_type IN ('classroom', 'class_session') AND p_scope_id IS NULL) THEN
    RAISE EXCEPTION 'RBAC_SCOPE_DOMAIN_MISMATCH';
  END IF;
  IF v_role.domain = 'system' THEN
    v_allowed := public.has_system_permission(auth.uid(), 'system.roles.manage');
  ELSIF p_scope_type = 'system' THEN
    v_allowed := public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, NULL);
  ELSIF p_scope_type = 'classroom' THEN
    v_allowed := public.has_api_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL);
  ELSE
    v_allowed := public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, p_scope_id);
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED'; END IF;
  IF jsonb_typeof(v_policies) IS DISTINCT FROM 'array' OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_policies) item
    WHERE jsonb_typeof(item) <> 'object' OR NOT (item ? 'permission_id') OR NOT (item ? 'effect')
      OR item->>'effect' NOT IN ('allow','deny') OR (item - 'permission_id' - 'effect') <> '{}'::jsonb
  ) THEN RAISE EXCEPTION 'INVALID_POLICY_PAYLOAD'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_policies) item
    LEFT JOIN public.permissions permission ON permission.id = (item->>'permission_id')::uuid
    WHERE permission.id IS NULL OR permission.domain <> v_role.domain
  ) THEN RAISE EXCEPTION 'RBAC_DOMAIN_MISMATCH'; END IF;
  DELETE FROM public.role_permission_policies
  WHERE role_id = p_role_id AND scope_type = p_scope_type AND scope_id IS NOT DISTINCT FROM p_scope_id;
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT p_role_id, (item->>'permission_id')::uuid, p_scope_type, p_scope_id, item->>'effect'
  FROM jsonb_array_elements(v_policies) item;
  RETURN public.current_rbac_policy_epoch();
END;
$$;

DROP FUNCTION IF EXISTS public.rbac_get_role_permissions(uuid, text, uuid);
CREATE FUNCTION public.rbac_get_role_permissions(
  p_role_id uuid, p_scope_type text, p_scope_id uuid
) RETURNS TABLE(
  permission_id uuid, permission_key text, resource text, action text,
  local_effect text, inherited_effect text, inherited_from_role_id uuid,
  inherited_from_scope_type text, effective_effect text, denied boolean, epoch bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_classroom_id uuid; v_allowed boolean := false;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF (v_role.domain = 'system' AND (p_scope_type <> 'system' OR p_scope_id IS NOT NULL))
     OR (v_role.domain = 'teaching' AND p_scope_type NOT IN ('system', 'classroom', 'class_session'))
     OR (p_scope_type = 'system' AND p_scope_id IS NOT NULL)
     OR (p_scope_type IN ('classroom', 'class_session') AND p_scope_id IS NULL) THEN RAISE EXCEPTION 'RBAC_SCOPE_DOMAIN_MISMATCH'; END IF;
  IF v_role.domain = 'system' THEN
    v_allowed := public.has_system_permission(auth.uid(), 'system.roles.read') OR public.has_system_permission(auth.uid(), 'system.roles.manage');
  ELSIF p_scope_type = 'system' THEN
    v_allowed := public.has_api_permission(auth.uid(), 'teaching.roles.read', NULL, NULL) OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, NULL);
  ELSIF p_scope_type = 'classroom' THEN
    v_allowed := public.has_api_permission(auth.uid(), 'teaching.roles.read', p_scope_id, NULL) OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL);
  ELSE
    SELECT session.classroom_id INTO v_classroom_id FROM public.class_sessions session WHERE session.id = p_scope_id;
    IF v_classroom_id IS NULL THEN RAISE EXCEPTION 'RBAC_SCOPE_NOT_FOUND'; END IF;
    v_allowed := public.has_api_permission(auth.uid(), 'teaching.roles.read', NULL, p_scope_id) OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, p_scope_id);
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED'; END IF;
  RETURN QUERY
  WITH RECURSIVE parents(role_id, depth) AS (
    SELECT inheritance.parent_role_id, 1 FROM public.role_inheritance inheritance WHERE inheritance.role_id = p_role_id
    UNION ALL
    SELECT inheritance.parent_role_id, parents.depth + 1 FROM parents JOIN public.role_inheritance inheritance ON inheritance.role_id = parents.role_id
  ), scopes(scope_type, scope_id, priority) AS (
    SELECT p_scope_type, p_scope_id, 3
    UNION ALL SELECT 'classroom', v_classroom_id, 2 WHERE p_scope_type = 'class_session'
    UNION ALL SELECT 'system', NULL::uuid, 1 WHERE p_scope_type IN ('classroom', 'class_session')
  ), local_policy AS (
    SELECT policy.permission_id, policy.effect FROM public.role_permission_policies policy
    WHERE policy.role_id = p_role_id AND policy.scope_type = p_scope_type AND policy.scope_id IS NOT DISTINCT FROM p_scope_id
  ), inherited_candidates AS (
    SELECT policy.permission_id, policy.effect, policy.role_id, parent.depth, scopes.priority, scopes.scope_type
    FROM parents parent JOIN public.role_permission_policies policy ON policy.role_id = parent.role_id
    JOIN scopes ON scopes.scope_type = policy.scope_type AND scopes.scope_id IS NOT DISTINCT FROM policy.scope_id
    UNION ALL
    SELECT policy.permission_id, policy.effect, policy.role_id, 0, scopes.priority, scopes.scope_type
    FROM public.role_permission_policies policy JOIN scopes
      ON scopes.scope_type = policy.scope_type AND scopes.scope_id IS NOT DISTINCT FROM policy.scope_id
    WHERE policy.role_id = p_role_id AND NOT (policy.scope_type = p_scope_type AND policy.scope_id IS NOT DISTINCT FROM p_scope_id)
  ), inherited_policy AS (
    SELECT DISTINCT ON (candidate.permission_id) candidate.permission_id, candidate.effect, candidate.role_id, candidate.scope_type
    FROM inherited_candidates candidate
    ORDER BY candidate.permission_id, (candidate.effect = 'deny') DESC, candidate.priority DESC, candidate.depth ASC
  )
  SELECT permission.id, permission.key, permission.resource, permission.action,
    local.effect, inherited.effect, inherited.role_id, inherited.scope_type,
    CASE WHEN local.effect = 'deny' OR inherited.effect = 'deny' THEN 'deny'
         WHEN local.effect = 'allow' OR inherited.effect = 'allow' THEN 'allow' ELSE NULL END,
    COALESCE(local.effect = 'deny' OR inherited.effect = 'deny', false), public.current_rbac_policy_epoch()
  FROM public.permissions permission
  LEFT JOIN local_policy local ON local.permission_id = permission.id
  LEFT JOIN inherited_policy inherited ON inherited.permission_id = permission.id
  WHERE permission.domain = v_role.domain
  ORDER BY permission.resource, permission.action, permission.key;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_role_assignment_exclusion_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.scope_type || ':' || NEW.scope_id::text), hashtext(NEW.user_id::text || ':' || NEW.role_id::text));
  IF EXISTS (
    SELECT 1 FROM public.user_role_assignment_exclusions existing
    WHERE existing.scope_type = NEW.scope_type AND existing.scope_id = NEW.scope_id
      AND existing.user_id = NEW.user_id AND existing.role_id = NEW.role_id AND existing.id IS DISTINCT FROM NEW.id
      AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
      AND COALESCE(existing.effective_to, 'infinity'::date) >= NEW.effective_from
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ROLE_ASSIGNMENT_EXCLUSION_OVERLAP'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER role_assignment_exclusion_no_overlap
BEFORE INSERT OR UPDATE ON public.user_role_assignment_exclusions
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_assignment_exclusion_overlap();

CREATE OR REPLACE FUNCTION public.prevent_session_teaching_role_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.scope_type <> 'class_session' OR NEW.status <> 'active'
     OR NOT EXISTS (SELECT 1 FROM public.roles role WHERE role.id = NEW.role_id AND role.domain = 'teaching') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('class_session:' || NEW.scope_id::text), hashtext(NEW.user_id::text || ':' || NEW.role_id::text));
  IF EXISTS (
    SELECT 1 FROM public.user_role_assignments existing
    WHERE existing.scope_type = 'class_session' AND existing.scope_id = NEW.scope_id
      AND existing.user_id = NEW.user_id AND existing.role_id = NEW.role_id AND existing.status = 'active'
      AND existing.id IS DISTINCT FROM NEW.id
      AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
      AND COALESCE(existing.effective_to, 'infinity'::date) >= NEW.effective_from
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TEACHING_ROLE_ASSIGNMENT_OVERLAP'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER class_session_teaching_role_assignment_no_overlap
BEFORE INSERT OR UPDATE OF user_id, role_id, scope_type, scope_id, effective_from, effective_to, status
ON public.user_role_assignments FOR EACH ROW EXECUTE FUNCTION public.prevent_session_teaching_role_overlap();

CREATE OR REPLACE FUNCTION public.rbac_upsert_platform_teaching_assignment(
  p_assignment_id uuid, p_user_id uuid, p_role_id uuid, p_effective_from date, p_effective_to date, p_expected_epoch bigint
) RETURNS public.user_role_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_assignment public.user_role_assignments; v_role public.roles;
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF NOT public.has_teaching_permission(auth.uid(), 'teaching.roles.manage', NULL, NULL, NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR SHARE;
  IF v_role.id IS NULL OR v_role.domain <> 'teaching' OR p_effective_from IS NULL
     OR (p_effective_to IS NOT NULL AND p_effective_to < p_effective_from) THEN RAISE EXCEPTION 'INVALID_PLATFORM_TEACHING_ASSIGNMENT'; END IF;
  IF p_assignment_id IS NULL THEN
    INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, effective_to)
    VALUES (p_user_id, p_role_id, 'system', NULL, p_effective_from, p_effective_to) RETURNING * INTO v_assignment;
  ELSE
    UPDATE public.user_role_assignments SET user_id = p_user_id, role_id = p_role_id, effective_from = p_effective_from, effective_to = p_effective_to
    WHERE id = p_assignment_id AND scope_type = 'system' AND role_id IN (SELECT id FROM public.roles WHERE domain = 'teaching')
    RETURNING * INTO v_assignment;
    IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  END IF;
  RETURN v_assignment;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_upsert_scoped_teaching_assignment(
  p_assignment_id uuid, p_user_id uuid, p_role_id uuid, p_scope_type text, p_scope_id uuid,
  p_effective_from date, p_effective_to date, p_expected_epoch bigint
) RETURNS public.user_role_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_assignment public.user_role_assignments; v_role public.roles;
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF p_scope_type NOT IN ('classroom', 'class_session') OR p_scope_id IS NULL OR p_effective_from IS NULL
     OR (p_effective_to IS NOT NULL AND p_effective_to < p_effective_from) THEN RAISE EXCEPTION 'INVALID_SCOPED_TEACHING_ASSIGNMENT'; END IF;
  IF p_scope_type = 'classroom' THEN
    IF NOT EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_scope_id)
       OR NOT public.has_api_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.class_sessions WHERE id = p_scope_id)
       OR NOT public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, p_scope_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
    END IF;
  END IF;
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR SHARE;
  IF v_role.id IS NULL OR v_role.domain <> 'teaching' THEN RAISE EXCEPTION 'RBAC_ASSIGNMENT_DOMAIN_MISMATCH'; END IF;
  IF p_assignment_id IS NULL THEN
    INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, effective_to)
    VALUES (p_user_id, p_role_id, p_scope_type, p_scope_id, p_effective_from, p_effective_to) RETURNING * INTO v_assignment;
  ELSE
    UPDATE public.user_role_assignments SET user_id = p_user_id, role_id = p_role_id,
      effective_from = p_effective_from, effective_to = p_effective_to
    WHERE id = p_assignment_id AND scope_type = p_scope_type AND scope_id = p_scope_id
      AND role_id IN (SELECT id FROM public.roles WHERE domain = 'teaching') RETURNING * INTO v_assignment;
    IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  END IF;
  RETURN v_assignment;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_delete_scoped_teaching_assignment(
  p_assignment_id uuid, p_scope_type text, p_scope_id uuid, p_expected_epoch bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF p_scope_type = 'classroom' THEN
    IF NOT public.has_api_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED'; END IF;
  ELSIF p_scope_type = 'class_session' THEN
    IF NOT public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, p_scope_id) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED'; END IF;
  ELSE RAISE EXCEPTION 'INVALID_ASSIGNMENT_SCOPE'; END IF;
  DELETE FROM public.user_role_assignments assignment USING public.roles role
  WHERE assignment.id = p_assignment_id AND assignment.scope_type = p_scope_type AND assignment.scope_id = p_scope_id
    AND role.id = assignment.role_id AND role.domain = 'teaching';
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_delete_platform_teaching_assignment(p_assignment_id uuid, p_expected_epoch bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF NOT public.has_teaching_permission(auth.uid(), 'teaching.roles.manage', NULL, NULL, NULL) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED'; END IF;
  DELETE FROM public.user_role_assignments assignment USING public.roles role
  WHERE assignment.id = p_assignment_id AND assignment.scope_type = 'system' AND role.id = assignment.role_id AND role.domain = 'teaching';
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_upsert_role_assignment_exclusion(
  p_exclusion_id uuid, p_user_id uuid, p_role_id uuid, p_scope_type text, p_scope_id uuid,
  p_effective_from date, p_effective_to date, p_expected_epoch bigint
) RETURNS public.user_role_assignment_exclusions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_exclusion public.user_role_assignment_exclusions; v_role public.roles;
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF p_scope_type NOT IN ('classroom', 'class_session') OR p_scope_id IS NULL OR p_effective_from IS NULL
     OR (p_effective_to IS NOT NULL AND p_effective_to < p_effective_from)
     OR NOT public.has_api_permission(auth.uid(), 'teaching.roles.manage', CASE WHEN p_scope_type = 'classroom' THEN p_scope_id ELSE NULL END, CASE WHEN p_scope_type = 'class_session' THEN p_scope_id ELSE NULL END) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR SHARE;
  IF v_role.id IS NULL OR v_role.domain <> 'teaching' THEN RAISE EXCEPTION 'RBAC_ASSIGNMENT_DOMAIN_MISMATCH'; END IF;
  IF p_exclusion_id IS NULL THEN
    INSERT INTO public.user_role_assignment_exclusions(user_id, role_id, scope_type, scope_id, effective_from, effective_to)
    VALUES (p_user_id, p_role_id, p_scope_type, p_scope_id, p_effective_from, p_effective_to) RETURNING * INTO v_exclusion;
  ELSE
    UPDATE public.user_role_assignment_exclusions SET user_id = p_user_id, role_id = p_role_id,
      effective_from = p_effective_from, effective_to = p_effective_to
    WHERE id = p_exclusion_id AND scope_type = p_scope_type AND scope_id = p_scope_id RETURNING * INTO v_exclusion;
    IF v_exclusion.id IS NULL THEN RAISE EXCEPTION 'EXCLUSION_NOT_FOUND'; END IF;
  END IF;
  RETURN v_exclusion;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_delete_role_assignment_exclusion(
  p_exclusion_id uuid, p_scope_type text, p_scope_id uuid, p_expected_epoch bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF p_scope_type NOT IN ('classroom', 'class_session') OR NOT public.has_api_permission(auth.uid(), 'teaching.roles.manage', CASE WHEN p_scope_type = 'classroom' THEN p_scope_id ELSE NULL END, CASE WHEN p_scope_type = 'class_session' THEN p_scope_id ELSE NULL END) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  DELETE FROM public.user_role_assignment_exclusions WHERE id = p_exclusion_id AND scope_type = p_scope_type AND scope_id = p_scope_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXCLUSION_NOT_FOUND'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_platform_teaching_role_overlap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_role_assignment_exclusion_overlap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rbac_upsert_platform_teaching_assignment(uuid,uuid,uuid,date,date,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rbac_delete_platform_teaching_assignment(uuid,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_session_teaching_role_overlap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rbac_upsert_scoped_teaching_assignment(uuid,uuid,uuid,text,uuid,date,date,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rbac_delete_scoped_teaching_assignment(uuid,text,uuid,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rbac_upsert_role_assignment_exclusion(uuid,uuid,uuid,text,uuid,date,date,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rbac_delete_role_assignment_exclusion(uuid,text,uuid,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rbac_upsert_classroom_assignment(uuid,uuid,uuid,uuid,date,date,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rbac_delete_classroom_assignment(uuid,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_upsert_platform_teaching_assignment(uuid,uuid,uuid,date,date,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_delete_platform_teaching_assignment(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_upsert_scoped_teaching_assignment(uuid,uuid,uuid,text,uuid,date,date,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_delete_scoped_teaching_assignment(uuid,text,uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_upsert_role_assignment_exclusion(uuid,uuid,uuid,text,uuid,date,date,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_delete_role_assignment_exclusion(uuid,text,uuid,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.rbac_replace_role_permissions(uuid,text,uuid,bigint,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rbac_get_role_permissions(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rbac_replace_role_permissions(uuid,text,uuid,bigint,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rbac_get_role_permissions(uuid,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_api_permission(uuid,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_api_permission(uuid,text,uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_access_teaching(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_teaching(uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_access_classroom(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_classroom(uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_access_class_session(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_class_session(uuid,text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
