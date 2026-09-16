-- Qualify idempotency table columns that share names with the function's
-- TABLE output variables. Without qualification PL/pgSQL rejects the locked
-- replay lookup as ambiguous.

DO $$
BEGIN
  IF to_regclass('public.api_idempotency_keys') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'api_idempotency_keys'
         AND column_name = 'processing_started_at'
     )
     OR to_regprocedure('public.reserve_api_idempotency(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '1000067 prerequisites missing; apply migrations through 1000066 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_api_idempotency(
  p_user_id uuid,
  p_key text,
  p_method text,
  p_route text
) RETURNS TABLE(is_replay boolean, response_status integer, response_body jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_method text;
  v_route text;
  v_status integer;
  v_body jsonb;
  v_started timestamptz;
  v_inserted boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  DELETE FROM public.api_idempotency_keys AS idem
  WHERE idem.expires_at < timezone('utc'::text, now());

  INSERT INTO public.api_idempotency_keys(user_id, idempotency_key, method, route, processing_started_at)
  VALUES (p_user_id, p_key, p_method, p_route, timezone('utc'::text, now()))
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING true INTO v_inserted;
  IF v_inserted THEN
    RETURN QUERY SELECT false, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  SELECT idem.method,
         idem.route,
         idem.response_status,
         idem.response_body,
         idem.processing_started_at
  INTO v_method, v_route, v_status, v_body, v_started
  FROM public.api_idempotency_keys AS idem
  WHERE idem.user_id = p_user_id
    AND idem.idempotency_key = p_key
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

  UPDATE public.api_idempotency_keys AS idem
  SET processing_started_at = timezone('utc'::text, now())
  WHERE idem.user_id = p_user_id
    AND idem.idempotency_key = p_key;
  RETURN QUERY SELECT false, NULL::integer, NULL::jsonb;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_api_idempotency(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_api_idempotency(uuid,text,text,text) TO service_role;
