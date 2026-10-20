-- Rollback-only fixture for 1000149: AI report assistant tables.
-- Teachers read only their own generations, adoptions and personal
-- credentials; system.ai.logs.view_all reads every generation; the credential
-- ciphertext is never selectable by authenticated users; writes are
-- service-role only; failed generations cannot charge quota.
BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  teacher_a uuid := 'a1000000-0000-4000-8000-000000000001';
  teacher_b uuid := 'a1000000-0000-4000-8000-000000000002';
  admin_user uuid := 'a1000000-0000-4000-8000-000000000003';
  site_credential uuid := 'a1000000-0000-4000-8000-0000000000c1';
  personal_a uuid := 'a1000000-0000-4000-8000-0000000000c2';
  personal_b uuid := 'a1000000-0000-4000-8000-0000000000c3';
  generation_a uuid := 'a1000000-0000-4000-8000-0000000000e1';
  generation_b uuid := 'a1000000-0000-4000-8000-0000000000e2';
BEGIN
  IF (SELECT count(*) FROM public.permissions WHERE key IN ('teaching.ai.generate', 'system.ai.manage', 'system.ai.logs.view_all')) <> 3 THEN
    RAISE EXCEPTION 'AI permissions should be seeded';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permission_policies policy
    JOIN public.roles role ON role.id = policy.role_id
    JOIN public.permissions permission ON permission.id = policy.permission_id
    WHERE role.code = 'teacher' AND permission.key = 'teaching.ai.generate' AND policy.effect = 'allow'
  ) THEN
    RAISE EXCEPTION 'teacher role should be allowed teaching.ai.generate';
  END IF;
  IF (SELECT count(*) FROM public.ai_settings) <> 1 OR (SELECT enabled FROM public.ai_settings) THEN
    RAISE EXCEPTION 'ai_settings should hold one disabled row';
  END IF;

  INSERT INTO auth.users(id, email) VALUES
    (teacher_a, 'ai-teacher-a@example.test'),
    (teacher_b, 'ai-teacher-b@example.test'),
    (admin_user, 'ai-admin@example.test');
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
  SELECT admin_user, role.id, 'system', NULL, DATE '2026-01-01', 'active'
  FROM public.roles role WHERE role.code = 'system_admin' AND role.domain = 'system' AND role.is_builtin;

  INSERT INTO public.ai_credentials(id, scope, owner_user_id, provider, auth_type, secret_ciphertext, secret_hint, label) VALUES
    (site_credential, 'site', NULL, 'anthropic', 'api_key', 'v1:site-cipher', 'sk-…site', 'Site Anthropic'),
    (personal_a, 'user', teacher_a, 'openai', 'api_key', 'v1:a-cipher', 'sk-…aaaa', 'A personal'),
    (personal_b, 'user', teacher_b, 'openai', 'api_key', 'v1:b-cipher', 'sk-…bbbb', 'B personal');
  INSERT INTO public.ai_generations(id, user_id, credential_id, credential_scope, provider, model_id, status, quota_charged) VALUES
    (generation_a, teacher_a, site_credential, 'site', 'anthropic', 'claude-test', 'succeeded', 1),
    (generation_b, teacher_b, personal_b, 'user', 'openai', 'gpt-test', 'succeeded', 0);
  INSERT INTO public.ai_adoptions(generation_id, section_key, action, sanitized_snapshot) VALUES
    (generation_a, 'today', 'insert', '[學生A] 今天...'),
    (generation_b, 'today', 'insert', '[學生A] 今天...');

  BEGIN
    INSERT INTO public.ai_generations(user_id, credential_scope, provider, model_id, status, quota_charged)
    VALUES (teacher_a, 'site', 'anthropic', 'claude-test', 'failed', 1);
    RAISE EXCEPTION 'a failed generation must not charge quota';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.ai_quota_ledger(user_id, generation_id, delta, kind) VALUES
      (teacher_a, generation_a, -1, 'consume'), (teacher_a, generation_a, -1, 'consume');
    RAISE EXCEPTION 'a generation must not be charged twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO public.user_preferences(user_id) VALUES (teacher_a);
  IF (SELECT ai_settings FROM public.user_preferences WHERE user_id = teacher_a) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'user_preferences.ai_settings should default to an empty object';
  END IF;
  BEGIN
    UPDATE public.user_preferences SET ai_settings = '[]'::jsonb WHERE user_id = teacher_a;
    RAISE EXCEPTION 'user_preferences.ai_settings must be an object';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- Teacher A: own generation, own adoption, own personal and active site credential.
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.ai_generations) <> 1
     OR (SELECT user_id FROM public.ai_generations) <> 'a1000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'teacher should read only their own generations';
  END IF;
  IF (SELECT count(*) FROM public.ai_adoptions) <> 1 THEN
    RAISE EXCEPTION 'teacher should read only adoptions of their own generations';
  END IF;
  IF (SELECT array_agg(label ORDER BY label) FROM public.ai_credentials) <> ARRAY['A personal', 'Site Anthropic'] THEN
    RAISE EXCEPTION 'teacher should read own personal and active site credentials only';
  END IF;
  IF (SELECT count(*) FROM public.ai_settings) <> 1 THEN
    RAISE EXCEPTION 'every user should read ai_settings';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_prompt_versions) OR EXISTS (SELECT 1 FROM public.ai_quota_policies) THEN
    RAISE EXCEPTION 'admin tables should be hidden from teachers';
  END IF;
END;
$$;

DO $$
BEGIN
  PERFORM secret_ciphertext FROM public.ai_credentials;
  RAISE EXCEPTION 'secret_ciphertext must not be selectable by authenticated users';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;

DO $$
BEGIN
  INSERT INTO public.ai_notice_acknowledgements(user_id, notice_version)
  VALUES ('a1000000-0000-4000-8000-000000000001', 1);
  RAISE EXCEPTION 'authenticated users must not write AI tables directly';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;

-- System admin: holds system.ai.logs.view_all and system.ai.manage.
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.ai_generations) <> 2 THEN
    RAISE EXCEPTION 'system.ai.logs.view_all should read every generation';
  END IF;
  IF (SELECT count(*) FROM public.ai_adoptions) <> 2 THEN
    RAISE EXCEPTION 'system.ai.logs.view_all should read every adoption';
  END IF;
  IF (SELECT count(*) FROM public.ai_credentials) <> 3 THEN
    RAISE EXCEPTION 'system.ai.manage should read every credential';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
