-- Forward-only hardening for DELETE idempotency replay authorization.
-- The 1000063 history remains unchanged.  Replay is executed by the
-- service-role client for storage access, but authorization must still be
-- evaluated for the original user and scoped resource.

DO $$
BEGIN
  IF to_regprocedure('public.replay_deleted_report_idempotency(uuid,text,text,text,uuid,text)') IS NULL
     OR to_regprocedure('public.resolve_teaching_permission(uuid,text,uuid,uuid,uuid,date)') IS NULL
     OR to_regprocedure('public.is_teaching_member(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000064 prerequisites missing; apply migrations through 1000063 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.replay_deleted_report_idempotency(
  p_user_id uuid,
  p_key text,
  p_method text,
  p_route text,
  p_resource_id uuid,
  p_permission_key text
) RETURNS TABLE(is_replay boolean, response_status integer, response_body jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.api_idempotency_keys%ROWTYPE;
  v_allowed boolean;
  v_denied boolean;
  v_configured boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  SELECT * INTO v_row
  FROM public.api_idempotency_keys
  WHERE user_id = p_user_id AND idempotency_key = p_key;

  IF NOT FOUND
     OR v_row.method IS DISTINCT FROM p_method
     OR v_row.route IS DISTINCT FROM p_route
     OR v_row.resource_id IS DISTINCT FROM p_resource_id
     OR v_row.permission_key IS DISTINCT FROM p_permission_key
     OR v_row.response_status IS NULL
     OR v_row.teaching_id IS NULL
     OR NOT public.is_teaching_member(v_row.teaching_id, p_user_id) THEN
    RETURN;
  END IF;

  SELECT resolved.is_allowed, resolved.is_denied, resolved.policy_configured
    INTO v_allowed, v_denied, v_configured
  FROM public.resolve_teaching_permission(
    p_user_id,
    v_row.permission_key,
    v_row.teaching_id,
    v_row.classroom_id,
    v_row.class_session_id,
    CURRENT_DATE
  ) AS resolved;

  IF COALESCE(v_configured, false) IS NOT TRUE
     OR COALESCE(v_allowed, false) IS NOT TRUE
     OR COALESCE(v_denied, false) IS TRUE THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_row.response_status, v_row.response_body;
END;
$$;

REVOKE ALL ON FUNCTION public.replay_deleted_report_idempotency(uuid,text,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replay_deleted_report_idempotency(uuid,text,text,text,uuid,text) TO service_role;
