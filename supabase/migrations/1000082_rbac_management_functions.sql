-- Atomic management API for the strict system/teaching RBAC domains.

DO $$
BEGIN
  IF to_regclass('public.rbac_domain_rebuild_state') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.rbac_domain_rebuild_state WHERE version = 1) THEN
    RAISE EXCEPTION '1000082 prerequisites missing; apply 1000081 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_rbac_policy_epoch()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT epoch FROM public.rbac_policy_epoch WHERE singleton = true;
$$;

CREATE OR REPLACE FUNCTION public.rbac_is_system_owner(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
WITH RECURSIVE assigned(role_id) AS (
  SELECT assignment.role_id
  FROM public.user_role_assignments assignment
  WHERE assignment.user_id = p_user_id
    AND assignment.scope_type = 'system'
    AND assignment.effective_from <= CURRENT_DATE
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
), role_tree(role_id) AS (
  SELECT role_id FROM assigned
  UNION
  SELECT inheritance.parent_role_id
  FROM public.role_inheritance inheritance
  JOIN role_tree child ON child.role_id = inheritance.role_id
)
SELECT auth.role() = 'service_role' OR (
  auth.uid() = p_user_id AND EXISTS (
    SELECT 1 FROM role_tree tree JOIN public.roles role ON role.id = tree.role_id
    WHERE role.domain = 'system' AND role.code = 'system_owner'
  )
);
$$;

CREATE OR REPLACE FUNCTION public.rbac_can_manage_domain(p_domain text, p_teaching_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE p_domain
    WHEN 'system' THEN p_teaching_id IS NULL
      AND public.has_system_permission(auth.uid(), 'system.roles.manage')
    WHEN 'teaching' THEN p_teaching_id IS NOT NULL
      AND (
        public.has_system_permission(auth.uid(), 'system.roles.manage')
        OR public.has_teaching_permission(auth.uid(), 'teaching.roles.manage', p_teaching_id, NULL, NULL)
        OR public.has_teaching_permission(auth.uid(), 'teaching.members.manage', p_teaching_id, NULL, NULL)
      )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_assert_epoch(p_expected_epoch bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_epoch bigint;
BEGIN
  SELECT epoch INTO v_epoch FROM public.rbac_policy_epoch WHERE singleton = true FOR UPDATE;
  IF p_expected_epoch IS NULL OR p_expected_epoch <> v_epoch THEN
    RAISE EXCEPTION 'RBAC_VERSION_CONFLICT';
  END IF;
END;
$$;

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
  END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_update_role(
  p_role_id uuid, p_name text, p_description text, p_code text,
  p_expected_epoch bigint
) RETURNS public.roles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles;
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 0);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR UPDATE;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF v_role.is_protected THEN RAISE EXCEPTION 'PROTECTED_ROLE'; END IF;
  IF NOT public.rbac_can_manage_domain(v_role.domain, v_role.teaching_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  IF length(btrim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'INVALID_ROLE_NAME'; END IF;
  UPDATE public.roles SET name = btrim(p_name), description = NULLIF(btrim(p_description),''),
    code = CASE WHEN is_builtin THEN code ELSE NULLIF(btrim(p_code),'') END
  WHERE id = p_role_id RETURNING * INTO v_role;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_delete_role(p_role_id uuid, p_expected_epoch bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles;
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 0);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR UPDATE;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF v_role.is_builtin OR v_role.is_protected THEN RAISE EXCEPTION 'PROTECTED_ROLE'; END IF;
  IF NOT public.rbac_can_manage_domain(v_role.domain, v_role.teaching_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.teaching_members WHERE role_id = p_role_id)
     OR EXISTS (SELECT 1 FROM public.class_session_teachers WHERE role_id = p_role_id)
     OR EXISTS (SELECT 1 FROM public.user_role_assignments WHERE role_id = p_role_id) THEN
    RAISE EXCEPTION 'ROLE_IN_USE';
  END IF;
  DELETE FROM public.roles WHERE id = p_role_id;
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
  END IF;
  RETURN public.current_rbac_policy_epoch();
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_replace_role_permissions(
  p_role_id uuid, p_scope_type text, p_scope_id uuid,
  p_expected_epoch bigint, p_policies jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_policies jsonb := COALESCE(p_policies, '[]'::jsonb);
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 2);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR UPDATE;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF v_role.is_protected THEN RAISE EXCEPTION 'PROTECTED_ROLE'; END IF;
  IF NOT public.rbac_can_manage_domain(v_role.domain, CASE WHEN v_role.domain = 'teaching' THEN p_scope_id ELSE NULL END) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  IF (v_role.domain = 'system' AND (p_scope_type <> 'system' OR p_scope_id IS NOT NULL))
     OR (v_role.domain = 'teaching' AND (p_scope_type <> 'teaching' OR p_scope_id IS NULL))
     OR (v_role.teaching_id IS NOT NULL AND v_role.teaching_id <> p_scope_id) THEN
    RAISE EXCEPTION 'RBAC_SCOPE_DOMAIN_MISMATCH';
  END IF;
  IF jsonb_typeof(v_policies) IS DISTINCT FROM 'array' OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_policies) item
    WHERE jsonb_typeof(item) <> 'object'
      OR NOT (item ? 'permission_id') OR NOT (item ? 'effect')
      OR item->>'effect' NOT IN ('allow','deny')
      OR (item - 'permission_id' - 'effect') <> '{}'::jsonb
  ) THEN RAISE EXCEPTION 'INVALID_POLICY_PAYLOAD'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_policies) item
    LEFT JOIN public.permissions permission ON permission.id = (item->>'permission_id')::uuid
    WHERE permission.id IS NULL OR permission.domain <> v_role.domain
  ) THEN RAISE EXCEPTION 'RBAC_DOMAIN_MISMATCH'; END IF;

  DELETE FROM public.role_permission_policies
  WHERE role_id = p_role_id AND scope_type = p_scope_type AND scope_id IS NOT DISTINCT FROM p_scope_id;
  INSERT INTO public.role_permission_policies(role_id,permission_id,scope_type,scope_id,effect)
  SELECT p_role_id,(item->>'permission_id')::uuid,p_scope_type,p_scope_id,item->>'effect'
  FROM jsonb_array_elements(v_policies) item;
  RETURN public.current_rbac_policy_epoch();
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_get_role_permissions(
  p_role_id uuid, p_scope_type text, p_scope_id uuid
) RETURNS TABLE(
  permission_id uuid, permission_key text, resource text, action text,
  local_effect text, inherited_effect text, inherited_from_role_id uuid,
  effective_effect text, denied boolean, epoch bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF (v_role.domain = 'system' AND NOT (
        public.has_system_permission(auth.uid(), 'system.roles.read')
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
      ))
     OR (v_role.domain = 'teaching' AND NOT (
        public.has_teaching_permission(auth.uid(), 'teaching.roles.read', p_scope_id, NULL, NULL)
        OR public.has_teaching_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL, NULL)
        OR public.has_system_permission(auth.uid(), 'system.roles.manage')
      )) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  RETURN QUERY
  WITH RECURSIVE parents(role_id, depth) AS (
    SELECT inheritance.parent_role_id, 1 FROM public.role_inheritance inheritance WHERE inheritance.role_id = p_role_id
    UNION ALL
    SELECT inheritance.parent_role_id, parents.depth + 1
    FROM parents JOIN public.role_inheritance inheritance ON inheritance.role_id = parents.role_id
  ), local_policy AS (
    SELECT policy.permission_id, policy.effect
    FROM public.role_permission_policies policy
    WHERE policy.role_id = p_role_id AND policy.scope_type = p_scope_type
      AND policy.scope_id IS NOT DISTINCT FROM p_scope_id
  ), inherited_policy AS (
    SELECT DISTINCT ON (policy.permission_id) policy.permission_id, policy.effect, policy.role_id
    FROM parents JOIN public.role_permission_policies policy ON policy.role_id = parents.role_id
    WHERE policy.scope_type = p_scope_type AND policy.scope_id IS NOT DISTINCT FROM p_scope_id
    ORDER BY policy.permission_id, (policy.effect = 'deny') DESC, parents.depth ASC
  )
  SELECT permission.id, permission.key, permission.resource, permission.action,
         local.effect, inherited.effect, inherited.role_id,
         CASE WHEN local.effect = 'deny' OR inherited.effect = 'deny' THEN 'deny'
              WHEN local.effect = 'allow' OR inherited.effect = 'allow' THEN 'allow' ELSE NULL END,
         COALESCE(local.effect = 'deny' OR inherited.effect = 'deny', false),
         public.current_rbac_policy_epoch()
  FROM public.permissions permission
  LEFT JOIN local_policy local ON local.permission_id = permission.id
  LEFT JOIN inherited_policy inherited ON inherited.permission_id = permission.id
  WHERE permission.domain = v_role.domain
  ORDER BY permission.resource, permission.action, permission.key;
END;
$$;

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
  IF NOT public.has_system_permission(auth.uid(), 'system.role_assignments.manage')
     AND NOT public.has_system_permission(auth.uid(), 'system.roles.manage') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id;
  IF v_role.id IS NULL OR v_role.domain <> 'system' THEN RAISE EXCEPTION 'RBAC_DOMAIN_MISMATCH'; END IF;
  IF v_role.code = 'system_owner' AND NOT public.rbac_is_system_owner(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SYSTEM_OWNER_REQUIRED';
  END IF;
  IF p_effective_to IS NOT NULL AND p_effective_to < p_effective_from THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  IF p_assignment_id IS NULL THEN
    INSERT INTO public.user_role_assignments(user_id,role_id,scope_type,scope_id,effective_from,effective_to)
    VALUES (p_user_id,p_role_id,'system',NULL,COALESCE(p_effective_from,CURRENT_DATE),p_effective_to)
    RETURNING * INTO v_assignment;
  ELSE
    SELECT role.* INTO v_previous_role
    FROM public.user_role_assignments assignment JOIN public.roles role ON role.id=assignment.role_id
    WHERE assignment.id=p_assignment_id AND assignment.scope_type='system' FOR UPDATE OF assignment;
    IF v_previous_role.code='system_owner' AND v_role.code<>'system_owner' THEN
      IF NOT public.rbac_is_system_owner(auth.uid()) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='SYSTEM_OWNER_REQUIRED'; END IF;
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

CREATE OR REPLACE FUNCTION public.rbac_delete_system_assignment(p_assignment_id uuid, p_expected_epoch bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_assignment public.user_role_assignments; v_role public.roles; v_active_owner_count bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 3);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF NOT public.has_system_permission(auth.uid(), 'system.role_assignments.manage')
     AND NOT public.has_system_permission(auth.uid(), 'system.roles.manage') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED';
  END IF;
  SELECT assignment.* INTO v_assignment
  FROM public.user_role_assignments assignment
  WHERE assignment.id=p_assignment_id AND assignment.scope_type='system' FOR UPDATE;
  IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_role FROM public.roles WHERE id = v_assignment.role_id;
  IF v_role.code = 'system_owner' THEN
    IF NOT public.rbac_is_system_owner(auth.uid()) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='SYSTEM_OWNER_REQUIRED'; END IF;
    SELECT count(*) INTO v_active_owner_count
    FROM public.user_role_assignments assignment JOIN public.roles role ON role.id=assignment.role_id
    WHERE role.code='system_owner' AND role.domain='system'
      AND assignment.scope_type='system' AND assignment.effective_from <= CURRENT_DATE
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE);
    IF v_active_owner_count <= 1 THEN RAISE EXCEPTION 'LAST_SYSTEM_OWNER'; END IF;
  END IF;
  DELETE FROM public.user_role_assignments WHERE id=p_assignment_id;
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
      'teaching_id', p_teaching_id,
      'members_manage', CASE WHEN p_teaching_id IS NULL THEN false ELSE public.has_teaching_permission(auth.uid(), 'teaching.members.manage', p_teaching_id, NULL, NULL) END,
      'roles_manage', CASE WHEN p_teaching_id IS NULL THEN false ELSE public.has_teaching_permission(auth.uid(), 'teaching.roles.manage', p_teaching_id, NULL, NULL) END,
      'permissions_read', CASE WHEN p_teaching_id IS NULL THEN false ELSE public.has_teaching_permission(auth.uid(), 'teaching.permissions.read', p_teaching_id, NULL, NULL) END
    )
  );
$$;

-- Direct RBAC writes are no longer part of the authenticated API surface.
REVOKE INSERT, UPDATE, DELETE ON public.roles, public.role_inheritance,
  public.role_permission_policies, public.user_role_assignments FROM authenticated;

DO $$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.current_rbac_policy_epoch()',
    'public.rbac_is_system_owner(uuid)',
    'public.rbac_can_manage_domain(text,uuid)',
    'public.rbac_assert_epoch(bigint)',
    'public.rbac_create_role(text,uuid,text,text,text,uuid,bigint)',
    'public.rbac_update_role(uuid,text,text,text,bigint)',
    'public.rbac_delete_role(uuid,bigint)',
    'public.rbac_set_role_parent(uuid,uuid,bigint)',
    'public.rbac_replace_role_permissions(uuid,text,uuid,bigint,jsonb)',
    'public.rbac_get_role_permissions(uuid,text,uuid)',
    'public.rbac_upsert_system_assignment(uuid,uuid,uuid,date,date,bigint)',
    'public.rbac_delete_system_assignment(uuid,bigint)',
    'public.get_rbac_capabilities(uuid)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || signature || ' FROM PUBLIC, anon';
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.current_rbac_policy_epoch() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rbac_is_system_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rbac_can_manage_domain(text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rbac_create_role(text,uuid,text,text,text,uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_update_role(uuid,text,text,text,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_delete_role(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_set_role_parent(uuid,uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_replace_role_permissions(uuid,text,uuid,bigint,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_get_role_permissions(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_upsert_system_assignment(uuid,uuid,uuid,date,date,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbac_delete_system_assignment(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rbac_capabilities(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
