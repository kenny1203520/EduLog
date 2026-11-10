-- Nobody grants what they do not hold.
--
-- Before this migration a caller who could manage roles could hand out any
-- permission of that domain:
--
-- * rbac_create_role / rbac_set_role_parent accepted a protected role as the
--   parent, so a system administrator could create a role that inherits
--   system_owner, assign it to themselves and pass every owner check.
-- * The teaching assignment functions never looked at is_protected, and
--   rbac_replace_role_permissions accepted any permission of the domain, so a
--   teaching manager (seeded without the sensitive student groups) could
--   assign itself teaching_owner or add student credentials to its own role.
-- * rbac_upsert_system_assignment only guarded the system_owner code, so a
--   user manager could assign itself system_admin.
--
-- Rules from now on:
--
-- 1. A protected role is never a parent, and only an owner of its domain
--    assigns or removes it.
-- 2. Assigning a role, or making it a parent, needs the caller to hold every
--    permission the role (with its parents) allows, at the scope where the
--    assignment hands it out. An owner of the domain is exempt.
-- 3. Saving a role's permissions needs the caller to hold every permission
--    that the save newly allows, or stops denying, at that scope.
-- 4. Teaching roles are assigned with teaching.role_assignments.manage or
--    teaching.roles.manage, as system roles already are. Defining roles and
--    their permissions still needs roles.manage.
--
-- rbac_can_grant_role(role, scope) answers rules 1, 2 and 4 for the API,
-- which approves accounts through the service role.
--
-- Existing inheritance rows that point at a protected role are removed.
-- Rerunnable.

DO $$
BEGIN
  IF to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('public.rbac_is_system_owner(uuid)') IS NULL
     OR to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION '1000164 prerequisites missing; apply migrations through 1000163 first';
  END IF;
END;
$$;

BEGIN;

DO $$
DECLARE v_row record;
BEGIN
  FOR v_row IN
    DELETE FROM public.role_inheritance inheritance USING public.roles parent, public.roles child
    WHERE parent.id = inheritance.parent_role_id AND child.id = inheritance.role_id AND parent.is_protected
    RETURNING child.code AS child_code, child.name AS child_name, parent.code AS parent_code
  LOOP
    RAISE WARNING '1000164 removed inheritance: role % (%) no longer inherits protected role %',
      v_row.child_name, COALESCE(v_row.child_code, 'no code'), v_row.parent_code;
  END LOOP;
END;
$$;

-- True when the caller owns the domain: the service role, or an account that
-- holds the domain's protected built-in role at platform scope today.
CREATE OR REPLACE FUNCTION private.rbac_caller_owns_domain(p_domain text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT auth.role() = 'service_role' OR EXISTS (
    SELECT 1 FROM public.user_role_assignments assignment
    JOIN public.roles role ON role.id = assignment.role_id
    WHERE assignment.user_id = auth.uid() AND assignment.scope_type = 'system' AND assignment.status = 'active'
      AND assignment.effective_from <= CURRENT_DATE
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
      AND role.domain = p_domain AND role.is_builtin AND role.is_protected
  );
$$;

-- True when the caller holds p_permission_key at the scope. The domain comes
-- from the permission row: the system key rbac.manage has no system. prefix.
CREATE OR REPLACE FUNCTION private.rbac_caller_holds(p_permission_key text, p_scope_type text, p_scope_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN (SELECT domain FROM public.permissions WHERE key = p_permission_key) = 'system'
      THEN public.has_system_permission(auth.uid(), p_permission_key)
    WHEN p_scope_type = 'system' THEN public.has_api_permission(auth.uid(), p_permission_key, NULL, NULL)
    WHEN p_scope_type = 'classroom' THEN public.has_api_permission(auth.uid(), p_permission_key, p_scope_id, NULL)
    WHEN p_scope_type = 'class_session' THEN public.has_api_permission(auth.uid(), p_permission_key, NULL, p_scope_id)
    ELSE false
  END;
$$;

-- True when the caller may assign roles of the domain at the scope.
CREATE OR REPLACE FUNCTION private.rbac_caller_assigns(p_domain text, p_scope_type text, p_scope_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE p_domain
    WHEN 'system' THEN p_scope_type = 'system' AND p_scope_id IS NULL AND (
      private.rbac_caller_holds('system.role_assignments.manage', 'system', NULL)
      OR private.rbac_caller_holds('system.roles.manage', 'system', NULL))
    WHEN 'teaching' THEN
      private.rbac_caller_holds('teaching.role_assignments.manage', p_scope_type, p_scope_id)
      OR private.rbac_caller_holds('teaching.roles.manage', p_scope_type, p_scope_id)
    ELSE false
  END;
$$;

-- The first permission that assigning p_role_id at the scope would hand out
-- and the caller does not hold there, or NULL when there is none.
--
-- A policy of the role applies inside the assignment's scope only, so each
-- allow is checked where the two overlap: a platform policy of a role
-- assigned in a classroom is checked in that classroom, and a policy written
-- for another classroom is skipped.
CREATE OR REPLACE FUNCTION private.rbac_grant_exceeding_caller(p_role_id uuid, p_scope_type text, p_scope_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_domain text; v_policy record; v_check_type text; v_check_id uuid; v_assignment_classroom uuid;
BEGIN
  SELECT domain INTO v_domain FROM public.roles WHERE id = p_role_id;
  IF v_domain IS NULL OR private.rbac_caller_owns_domain(v_domain) THEN RETURN NULL; END IF;
  IF p_scope_type = 'class_session' THEN
    SELECT classroom_id INTO v_assignment_classroom FROM public.class_sessions WHERE id = p_scope_id;
  END IF;
  FOR v_policy IN
    WITH RECURSIVE role_tree(role_id) AS (
      SELECT p_role_id
      UNION
      SELECT inheritance.parent_role_id FROM public.role_inheritance inheritance
      JOIN role_tree child ON child.role_id = inheritance.role_id
    )
    SELECT DISTINCT permission.key, policy.scope_type, policy.scope_id
    FROM public.role_permission_policies policy
    JOIN public.permissions permission ON permission.id = policy.permission_id
    WHERE policy.role_id IN (SELECT role_id FROM role_tree) AND policy.effect = 'allow'
    ORDER BY permission.key
  LOOP
    v_check_type := NULL;
    IF p_scope_type = 'system' THEN
      v_check_type := v_policy.scope_type; v_check_id := v_policy.scope_id;
    ELSIF v_policy.scope_type = 'system' THEN
      v_check_type := p_scope_type; v_check_id := p_scope_id;
    ELSIF p_scope_type = 'classroom' THEN
      IF v_policy.scope_type = 'classroom' AND v_policy.scope_id = p_scope_id THEN
        v_check_type := p_scope_type; v_check_id := p_scope_id;
      ELSIF v_policy.scope_type = 'class_session' AND EXISTS (
        SELECT 1 FROM public.class_sessions WHERE id = v_policy.scope_id AND classroom_id = p_scope_id
      ) THEN
        v_check_type := 'class_session'; v_check_id := v_policy.scope_id;
      END IF;
    ELSIF p_scope_type = 'class_session' THEN
      IF (v_policy.scope_type = 'classroom' AND v_policy.scope_id = v_assignment_classroom)
         OR (v_policy.scope_type = 'class_session' AND v_policy.scope_id = p_scope_id) THEN
        v_check_type := p_scope_type; v_check_id := p_scope_id;
      END IF;
    END IF;
    IF v_check_type IS NOT NULL AND NOT private.rbac_caller_holds(v_policy.key, v_check_type, v_check_id) THEN
      RETURN v_policy.key;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- Rules 1 and 2 for one role at one scope. The caller's right to assign at
-- all (rule 4) is checked by each function, which knows its own scope rules.
CREATE OR REPLACE FUNCTION private.rbac_assert_can_grant_role(p_role_id uuid, p_scope_type text, p_scope_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_exceeding text;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF v_role.is_protected AND NOT private.rbac_caller_owns_domain(v_role.domain) THEN
    RAISE EXCEPTION 'OWNER_ROLE_REQUIRED';
  END IF;
  v_exceeding := private.rbac_grant_exceeding_caller(p_role_id, p_scope_type, p_scope_id);
  IF v_exceeding IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'GRANT_EXCEEDS_CALLER', DETAIL = v_exceeding;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.rbac_caller_owns_domain(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.rbac_caller_holds(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.rbac_caller_assigns(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.rbac_grant_exceeding_caller(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.rbac_assert_can_grant_role(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- For the API: may the caller give p_role_id to someone at this scope?
CREATE OR REPLACE FUNCTION public.rbac_can_grant_role(p_role_id uuid, p_scope_type text DEFAULT 'system', p_scope_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id;
  IF v_role.id IS NULL
     OR p_scope_type NOT IN ('system', 'classroom', 'class_session')
     OR (p_scope_type = 'system') <> (p_scope_id IS NULL)
     OR (v_role.domain = 'system' AND p_scope_type <> 'system') THEN
    RETURN false;
  END IF;
  RETURN private.rbac_caller_assigns(v_role.domain, p_scope_type, p_scope_id)
    AND (NOT v_role.is_protected OR private.rbac_caller_owns_domain(v_role.domain))
    AND private.rbac_grant_exceeding_caller(p_role_id, p_scope_type, p_scope_id) IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.rbac_can_grant_role(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rbac_can_grant_role(uuid, text, uuid) TO authenticated, service_role;

-- Rule 1: a protected role is never a parent.
CREATE OR REPLACE FUNCTION public.validate_rbac_role_inheritance_domain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_child public.roles; v_parent public.roles;
BEGIN
  SELECT * INTO v_child FROM public.roles WHERE id = NEW.role_id;
  SELECT * INTO v_parent FROM public.roles WHERE id = NEW.parent_role_id;
  IF v_child.id IS NULL OR v_parent.id IS NULL OR v_child.domain <> v_parent.domain THEN
    RAISE EXCEPTION 'RBAC_INHERITANCE_DOMAIN_MISMATCH';
  END IF;
  IF v_parent.is_protected THEN RAISE EXCEPTION 'PROTECTED_ROLE_PARENT'; END IF;
  IF v_child.domain = 'teaching' AND NOT v_child.is_builtin
     AND NOT (v_parent.is_builtin OR v_parent.teaching_id = v_child.teaching_id) THEN
    RAISE EXCEPTION 'RBAC_CROSS_TEACHING_INHERITANCE';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_rbac_role_inheritance_domain() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rbac_create_role(
  p_domain text, p_teaching_id uuid, p_code text, p_name text,
  p_description text, p_parent_role_id uuid,
  p_expected_epoch bigint
) RETURNS public.roles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_code text := NULLIF(btrim(p_code), '');
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 0);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF p_domain NOT IN ('system','teaching') OR length(btrim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'INVALID_ROLE';
  END IF;
  IF p_domain = 'system' THEN p_teaching_id := NULL; END IF;
  IF NOT public.rbac_can_manage_domain(p_domain, p_teaching_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  INSERT INTO public.roles(code,name,description,is_system,sort_order,domain,teaching_id,is_builtin,is_protected)
  VALUES (v_code,btrim(p_name),NULLIF(btrim(p_description),''),false,500,p_domain,p_teaching_id,false,false)
  RETURNING * INTO v_role;
  IF p_parent_role_id IS NOT NULL THEN
    INSERT INTO public.role_inheritance(role_id,parent_role_id) VALUES (v_role.id,p_parent_role_id);
    PERFORM private.rbac_assert_can_grant_role(p_parent_role_id, 'system', NULL);
  END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_set_role_parent(
  p_role_id uuid, p_parent_role_id uuid, p_expected_epoch bigint
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles;
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 1);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR UPDATE;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF v_role.is_builtin OR v_role.is_protected THEN RAISE EXCEPTION 'PROTECTED_ROLE'; END IF;
  IF NOT public.rbac_can_manage_domain(v_role.domain, v_role.teaching_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  DELETE FROM public.role_inheritance WHERE role_id = p_role_id;
  IF p_parent_role_id IS NOT NULL THEN
    INSERT INTO public.role_inheritance(role_id,parent_role_id) VALUES (p_role_id,p_parent_role_id);
    PERFORM private.rbac_assert_can_grant_role(p_parent_role_id, 'system', NULL);
  END IF;
  RETURN public.current_rbac_policy_epoch();
END;
$$;

-- Rule 3. The body is 1000099's plus the escalation check before the write.
CREATE OR REPLACE FUNCTION public.rbac_replace_role_permissions(
  p_role_id uuid, p_scope_type text, p_scope_id uuid,
  p_expected_epoch bigint, p_policies jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_policies jsonb := COALESCE(p_policies, '[]'::jsonb); v_allowed boolean := false; v_exceeding text;
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

  -- A permission the save newly allows, or stops denying, widens the role.
  IF NOT private.rbac_caller_owns_domain(v_role.domain) THEN
    SELECT permission.key INTO v_exceeding
    FROM public.permissions permission
    LEFT JOIN public.role_permission_policies existing
      ON existing.permission_id = permission.id AND existing.role_id = p_role_id
     AND existing.scope_type = p_scope_type AND existing.scope_id IS NOT DISTINCT FROM p_scope_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN bool_or(item->>'effect' = 'deny') THEN 'deny' ELSE 'allow' END AS effect
      FROM jsonb_array_elements(v_policies) item
      WHERE (item->>'permission_id')::uuid = permission.id
      HAVING count(*) > 0
    ) requested ON true
    WHERE permission.domain = v_role.domain
      AND requested.effect IS DISTINCT FROM 'deny'
      AND ((requested.effect = 'allow' AND existing.effect IS DISTINCT FROM 'allow') OR existing.effect = 'deny')
      AND NOT private.rbac_caller_holds(permission.key, p_scope_type, p_scope_id)
    ORDER BY permission.key
    LIMIT 1;
    IF v_exceeding IS NOT NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'GRANT_EXCEEDS_CALLER', DETAIL = v_exceeding;
    END IF;
  END IF;

  DELETE FROM public.role_permission_policies
  WHERE role_id = p_role_id AND scope_type = p_scope_type AND scope_id IS NOT DISTINCT FROM p_scope_id;
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT p_role_id, (item->>'permission_id')::uuid, p_scope_type, p_scope_id, item->>'effect'
  FROM jsonb_array_elements(v_policies) item;
  RETURN public.current_rbac_policy_epoch();
END;
$$;

-- Rules 1 and 2 for system roles. The body is 1000082's with the owner guard
-- widened from the system_owner code to every protected role, and the ceiling.
CREATE OR REPLACE FUNCTION public.rbac_upsert_system_assignment(
  p_assignment_id uuid, p_user_id uuid, p_role_id uuid,
  p_effective_from date, p_effective_to date,
  p_expected_epoch bigint
) RETURNS public.user_role_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_assignment public.user_role_assignments;
  v_previous_role public.roles; v_active_owner_count bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 3);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF NOT private.rbac_caller_assigns('system', 'system', NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id;
  IF v_role.id IS NULL OR v_role.domain <> 'system' THEN RAISE EXCEPTION 'RBAC_DOMAIN_MISMATCH'; END IF;
  PERFORM private.rbac_assert_can_grant_role(p_role_id, 'system', NULL);
  IF p_effective_to IS NOT NULL AND p_effective_to < p_effective_from THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  IF p_assignment_id IS NULL THEN
    INSERT INTO public.user_role_assignments(user_id,role_id,scope_type,scope_id,effective_from,effective_to)
    VALUES (p_user_id,p_role_id,'system',NULL,COALESCE(p_effective_from,CURRENT_DATE),p_effective_to)
    RETURNING * INTO v_assignment;
  ELSE
    SELECT role.* INTO v_previous_role
    FROM public.user_role_assignments assignment JOIN public.roles role ON role.id=assignment.role_id
    WHERE assignment.id=p_assignment_id AND assignment.scope_type='system' FOR UPDATE OF assignment;
    IF v_previous_role.is_protected AND NOT private.rbac_caller_owns_domain('system') THEN
      RAISE EXCEPTION 'OWNER_ROLE_REQUIRED';
    END IF;
    IF v_previous_role.code='system_owner' AND v_role.code<>'system_owner' THEN
      SELECT count(DISTINCT assignment.user_id) INTO v_active_owner_count
      FROM public.user_role_assignments assignment JOIN public.roles owner_role ON owner_role.id=assignment.role_id
      WHERE owner_role.domain='system' AND owner_role.code='system_owner' AND assignment.scope_type='system'
        AND assignment.effective_from <= CURRENT_DATE
        AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE);
      IF v_active_owner_count <= 1 THEN RAISE EXCEPTION 'LAST_SYSTEM_OWNER'; END IF;
    END IF;
    UPDATE public.user_role_assignments SET user_id=p_user_id, role_id=p_role_id,
      effective_from=COALESCE(p_effective_from,CURRENT_DATE), effective_to=p_effective_to
    WHERE id=p_assignment_id AND scope_type='system' RETURNING * INTO v_assignment;
    IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  END IF;
  RETURN v_assignment;
END;
$$;

-- Rules 1, 2 and 4 for teaching roles at platform scope.
CREATE OR REPLACE FUNCTION public.rbac_upsert_platform_teaching_assignment(
  p_assignment_id uuid, p_user_id uuid, p_role_id uuid, p_effective_from date, p_effective_to date, p_expected_epoch bigint
) RETURNS public.user_role_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_assignment public.user_role_assignments; v_role public.roles; v_previous_protected boolean;
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF NOT private.rbac_caller_assigns('teaching', 'system', NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR SHARE;
  IF v_role.id IS NULL OR v_role.domain <> 'teaching' OR p_effective_from IS NULL
     OR (p_effective_to IS NOT NULL AND p_effective_to < p_effective_from) THEN RAISE EXCEPTION 'INVALID_PLATFORM_TEACHING_ASSIGNMENT'; END IF;
  PERFORM private.rbac_assert_can_grant_role(p_role_id, 'system', NULL);
  IF p_assignment_id IS NULL THEN
    INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, effective_to)
    VALUES (p_user_id, p_role_id, 'system', NULL, p_effective_from, p_effective_to) RETURNING * INTO v_assignment;
  ELSE
    SELECT role.is_protected INTO v_previous_protected
    FROM public.user_role_assignments assignment JOIN public.roles role ON role.id = assignment.role_id
    WHERE assignment.id = p_assignment_id AND assignment.scope_type = 'system' AND role.domain = 'teaching' FOR UPDATE OF assignment;
    IF v_previous_protected AND NOT private.rbac_caller_owns_domain('teaching') THEN RAISE EXCEPTION 'OWNER_ROLE_REQUIRED'; END IF;
    UPDATE public.user_role_assignments SET user_id = p_user_id, role_id = p_role_id, effective_from = p_effective_from, effective_to = p_effective_to
    WHERE id = p_assignment_id AND scope_type = 'system' AND role_id IN (SELECT id FROM public.roles WHERE domain = 'teaching')
    RETURNING * INTO v_assignment;
    IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  END IF;
  RETURN v_assignment;
END;
$$;

-- The same in a classroom or a class.
CREATE OR REPLACE FUNCTION public.rbac_upsert_scoped_teaching_assignment(
  p_assignment_id uuid, p_user_id uuid, p_role_id uuid, p_scope_type text, p_scope_id uuid,
  p_effective_from date, p_effective_to date, p_expected_epoch bigint
) RETURNS public.user_role_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_assignment public.user_role_assignments; v_role public.roles; v_previous_protected boolean;
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF p_scope_type NOT IN ('classroom', 'class_session') OR p_scope_id IS NULL OR p_effective_from IS NULL
     OR (p_effective_to IS NOT NULL AND p_effective_to < p_effective_from) THEN RAISE EXCEPTION 'INVALID_SCOPED_TEACHING_ASSIGNMENT'; END IF;
  IF (p_scope_type = 'classroom' AND NOT EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_scope_id))
     OR (p_scope_type = 'class_session' AND NOT EXISTS (SELECT 1 FROM public.class_sessions WHERE id = p_scope_id))
     OR NOT private.rbac_caller_assigns('teaching', p_scope_type, p_scope_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR SHARE;
  IF v_role.id IS NULL OR v_role.domain <> 'teaching' THEN RAISE EXCEPTION 'RBAC_ASSIGNMENT_DOMAIN_MISMATCH'; END IF;
  PERFORM private.rbac_assert_can_grant_role(p_role_id, p_scope_type, p_scope_id);
  IF p_assignment_id IS NULL THEN
    INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, effective_to)
    VALUES (p_user_id, p_role_id, p_scope_type, p_scope_id, p_effective_from, p_effective_to) RETURNING * INTO v_assignment;
  ELSE
    SELECT role.is_protected INTO v_previous_protected
    FROM public.user_role_assignments assignment JOIN public.roles role ON role.id = assignment.role_id
    WHERE assignment.id = p_assignment_id AND assignment.scope_type = p_scope_type AND assignment.scope_id = p_scope_id
      AND role.domain = 'teaching' FOR UPDATE OF assignment;
    IF v_previous_protected AND NOT private.rbac_caller_owns_domain('teaching') THEN RAISE EXCEPTION 'OWNER_ROLE_REQUIRED'; END IF;
    UPDATE public.user_role_assignments SET user_id = p_user_id, role_id = p_role_id,
      effective_from = p_effective_from, effective_to = p_effective_to
    WHERE id = p_assignment_id AND scope_type = p_scope_type AND scope_id = p_scope_id
      AND role_id IN (SELECT id FROM public.roles WHERE domain = 'teaching') RETURNING * INTO v_assignment;
    IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  END IF;
  RETURN v_assignment;
END;
$$;

-- Removing an assignment follows rule 4, and rule 1 for a protected role.
CREATE OR REPLACE FUNCTION public.rbac_delete_scoped_teaching_assignment(
  p_assignment_id uuid, p_scope_type text, p_scope_id uuid, p_expected_epoch bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_protected boolean;
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF p_scope_type NOT IN ('classroom', 'class_session') THEN RAISE EXCEPTION 'INVALID_ASSIGNMENT_SCOPE'; END IF;
  IF NOT private.rbac_caller_assigns('teaching', p_scope_type, p_scope_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  SELECT role.is_protected INTO v_protected
  FROM public.user_role_assignments assignment JOIN public.roles role ON role.id = assignment.role_id
  WHERE assignment.id = p_assignment_id AND assignment.scope_type = p_scope_type AND assignment.scope_id = p_scope_id
    AND role.domain = 'teaching' FOR UPDATE OF assignment;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  IF v_protected AND NOT private.rbac_caller_owns_domain('teaching') THEN RAISE EXCEPTION 'OWNER_ROLE_REQUIRED'; END IF;
  DELETE FROM public.user_role_assignments WHERE id = p_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_delete_platform_teaching_assignment(p_assignment_id uuid, p_expected_epoch bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_protected boolean;
BEGIN
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF NOT private.rbac_caller_assigns('teaching', 'system', NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  SELECT role.is_protected INTO v_protected
  FROM public.user_role_assignments assignment JOIN public.roles role ON role.id = assignment.role_id
  WHERE assignment.id = p_assignment_id AND assignment.scope_type = 'system' AND role.domain = 'teaching' FOR UPDATE OF assignment;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  IF v_protected AND NOT private.rbac_caller_owns_domain('teaching') THEN RAISE EXCEPTION 'OWNER_ROLE_REQUIRED'; END IF;
  DELETE FROM public.user_role_assignments WHERE id = p_assignment_id;
END;
$$;

-- A class job (class_session_teachers.role_id) grants its role in that class
-- through sync_class_session_teacher_role_grant, so it follows rules 1 and 2
-- as well. Rows written without a signed-in caller (migrations, the service
-- role) are not checked.
CREATE OR REPLACE FUNCTION private.assert_class_session_teacher_role_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.role_id IS NULL OR auth.uid() IS NULL OR auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id
     AND NEW.class_session_id IS NOT DISTINCT FROM OLD.class_session_id THEN RETURN NEW; END IF;
  PERFORM private.rbac_assert_can_grant_role(NEW.role_id, 'class_session', NEW.class_session_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_class_session_teacher_role_grant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS class_session_teacher_role_grant_ceiling ON public.class_session_teachers;
CREATE TRIGGER class_session_teacher_role_grant_ceiling BEFORE INSERT OR UPDATE ON public.class_session_teachers
FOR EACH ROW EXECUTE FUNCTION private.assert_class_session_teacher_role_grant();

COMMIT;

NOTIFY pgrst, 'reload schema';
