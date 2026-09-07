DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.consume_api_rate_limit(text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute the shared rate-limit RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.consume_api_rate_limit(text,integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.consume_api_rate_limit(text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'untrusted roles can execute the shared rate-limit RPC';
  END IF;
END;
$$;

SET ROLE service_role;
DO $$
DECLARE
  first_allowed boolean;
  second_allowed boolean;
BEGIN
  SELECT allowed INTO first_allowed
  FROM public.consume_api_rate_limit('integration-test-rate-limit-bucket', 1, 60);
  SELECT allowed INTO second_allowed
  FROM public.consume_api_rate_limit('integration-test-rate-limit-bucket', 1, 60);
  IF NOT first_allowed OR second_allowed THEN
    RAISE EXCEPTION 'shared rate-limit RPC is not atomic';
  END IF;
END;
$$;
RESET ROLE;
