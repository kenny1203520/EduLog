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
