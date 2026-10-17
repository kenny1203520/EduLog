-- EduLog API shared rate-limit store.
-- This is a forward-only migration. The application stores only a digest of
-- user/IP/route identity in bucket_key; raw client IPs never reach this table.

CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages api rate limit buckets" ON public.api_rate_limit_buckets;
REVOKE ALL ON TABLE public.api_rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_rate_limit_buckets TO service_role;

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
) RETURNS TABLE(allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_reset timestamptz;
BEGIN
  IF p_bucket_key IS NULL OR length(trim(p_bucket_key)) < 16
     OR p_limit IS NULL OR p_limit < 1
     OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.api_rate_limit_buckets(bucket_key, window_started_at, request_count, reset_at, updated_at)
  VALUES (p_bucket_key, v_now, 1, v_now + make_interval(secs => p_window_seconds), v_now)
  ON CONFLICT (bucket_key) DO UPDATE
  SET window_started_at = CASE
        WHEN api_rate_limit_buckets.reset_at <= v_now THEN v_now
        ELSE api_rate_limit_buckets.window_started_at
      END,
      request_count = CASE
        WHEN api_rate_limit_buckets.reset_at <= v_now THEN 1
        ELSE api_rate_limit_buckets.request_count + 1
      END,
      reset_at = CASE
        WHEN api_rate_limit_buckets.reset_at <= v_now
          THEN v_now + make_interval(secs => p_window_seconds)
        ELSE api_rate_limit_buckets.reset_at
      END,
      updated_at = v_now
  RETURNING public.api_rate_limit_buckets.request_count, public.api_rate_limit_buckets.reset_at INTO v_count, v_reset;

  RETURN QUERY
  SELECT v_count <= p_limit,
         GREATEST(p_limit - v_count, 0),
         v_reset;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role;

COMMENT ON TABLE public.api_rate_limit_buckets IS 'Hashed API rate-limit buckets; raw IP addresses must never be stored.';
