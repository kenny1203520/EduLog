-- Forward-only contract alignment for the API Idempotency-Key header.
-- The server accepts 8..255 characters; the historical database constraint
-- incorrectly stopped at 128.

DO $$
BEGIN
  IF to_regclass('public.api_idempotency_keys') IS NULL THEN
    RAISE EXCEPTION '1000059 prerequisites missing; apply migrations through 1000058 first';
  END IF;
END;
$$;

ALTER TABLE public.api_idempotency_keys
  DROP CONSTRAINT IF EXISTS api_idempotency_key_shape;
ALTER TABLE public.api_idempotency_keys
  ADD CONSTRAINT api_idempotency_key_shape CHECK (length(idempotency_key) BETWEEN 8 AND 255);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.api_idempotency_keys WHERE length(idempotency_key) NOT BETWEEN 8 AND 255
  ) THEN
    RAISE EXCEPTION '1000059 existing idempotency key violates the API length contract';
  END IF;
END;
$$;
