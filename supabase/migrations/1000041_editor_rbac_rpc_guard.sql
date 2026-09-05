-- Editor RBAC RPC guard and execute boundary.
--
-- 1000041 is forward-only and depends on 1000038. It keeps the scoped
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
