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
