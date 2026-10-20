\set ON_ERROR_STOP on

-- Regression for 1000154: failed generations keep a bounded error detail and
-- the full system prompt; models record structured-output support.
BEGIN;

INSERT INTO auth.users(id, email) VALUES ('a1540000-0000-4000-8000-000000000001', 'details@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ai_generations(id, user_id, credential_scope, provider, model_id, status, error_code, error_detail, system_prompt)
VALUES ('a1540000-0000-4000-8000-000000000011', 'a1540000-0000-4000-8000-000000000001', 'user', 'openrouter', 'google/gemma:free',
        'failed', 'RATE_LIMITED', '{"status": 429, "message": "rate limited upstream"}', '你是補習班老師的課後報告助手');

DO $$
BEGIN
  BEGIN
    UPDATE public.ai_generations SET error_detail = to_jsonb(repeat('x', 5000)) WHERE id = 'a1540000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'non-object error_detail was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.ai_generations SET error_detail = jsonb_build_object('message', repeat('x', 5000)) WHERE id = 'a1540000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'oversized error_detail was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT error_detail->>'status' FROM public.ai_generations WHERE id = 'a1540000-0000-4000-8000-000000000011') <> '429' THEN
    RAISE EXCEPTION 'error_detail was not kept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_models' AND column_name = 'supports_structured_output') THEN
    RAISE EXCEPTION 'ai_models.supports_structured_output is missing';
  END IF;
END;
$$;

ROLLBACK;
