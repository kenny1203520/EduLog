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
