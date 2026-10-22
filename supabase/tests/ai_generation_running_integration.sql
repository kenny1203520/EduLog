\set ON_ERROR_STOP on

-- Regression for 1000153: generations can be recorded as running, finished
-- later, and running rows can never charge quota.
BEGIN;

INSERT INTO auth.users(id, email) VALUES ('a1530000-0000-4000-8000-000000000001', 'running@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ai_generations(id, user_id, credential_scope, provider, model_id, status)
VALUES ('a1530000-0000-4000-8000-000000000011', 'a1530000-0000-4000-8000-000000000001', 'site', 'ollama', 'qwen', 'running');

DO $$
BEGIN
  BEGIN
    UPDATE public.ai_generations SET quota_charged = 1 WHERE id = 'a1530000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'running generation was allowed to charge quota';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT completed_at FROM public.ai_generations WHERE id = 'a1530000-0000-4000-8000-000000000011') IS NOT NULL THEN
    RAISE EXCEPTION 'running generation has completed_at';
  END IF;
END;
$$;

UPDATE public.ai_generations SET status = 'succeeded', quota_charged = 1
WHERE id = 'a1530000-0000-4000-8000-000000000011';

DO $$
BEGIN
  IF (SELECT status FROM public.ai_generations WHERE id = 'a1530000-0000-4000-8000-000000000011') <> 'succeeded'
     OR (SELECT completed_at FROM public.ai_generations WHERE id = 'a1530000-0000-4000-8000-000000000011') IS NULL THEN
    RAISE EXCEPTION 'running generation was not finished with completed_at';
  END IF;
END;
$$;

ROLLBACK;
