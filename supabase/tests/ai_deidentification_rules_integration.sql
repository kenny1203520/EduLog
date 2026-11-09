-- Rollback-only fixture for 1000151: de-identification rules and languages.
-- Rule rows must match their kind; ai_settings.deid_languages defaults to zh
-- and only takes known languages; only system.ai.manage reads the rules and
-- nobody but the service role writes them.
BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  teacher uuid := 'a1510000-0000-4000-8000-000000000001';
  admin_user uuid := 'a1510000-0000-4000-8000-000000000002';
BEGIN
  IF (SELECT deid_languages FROM public.ai_settings) <> ARRAY['zh']::text[] THEN
    RAISE EXCEPTION 'ai_settings.deid_languages should default to {zh}';
  END IF;
  BEGIN
    UPDATE public.ai_settings SET deid_languages = '{}';
    RAISE EXCEPTION 'at least one language must stay enabled';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.ai_settings SET deid_languages = '{zh,xx}';
    RAISE EXCEPTION 'unknown languages must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.ai_settings SET deid_languages = '{zh,en}';

  INSERT INTO auth.users(id, email) VALUES
    (teacher, 'deid-teacher@example.test'),
    (admin_user, 'deid-admin@example.test');
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
  SELECT admin_user, role.id, 'system', NULL, DATE '2026-01-01', 'active'
  FROM public.roles role WHERE role.code = 'system_admin' AND role.domain = 'system' AND role.is_builtin;

  INSERT INTO public.ai_deid_rules(name, kind, entries, pattern, placeholder_kind, languages) VALUES
    ('Clubs', 'deny_list', ARRAY['火箭社'], NULL, 'organization', '{}'),
    ('Student numbers', 'regex', '{}', 'S\d{6}', 'sensitive', ARRAY['zh', 'en']),
    ('Exceptions', 'allow_list', ARRAY['小學'], NULL, NULL, '{}');

  BEGIN
    INSERT INTO public.ai_deid_rules(name, kind, entries, placeholder_kind) VALUES ('Empty', 'deny_list', '{}', 'person');
    RAISE EXCEPTION 'a deny list needs entries';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.ai_deid_rules(name, kind, pattern) VALUES ('No kind', 'regex', 'x+');
    RAISE EXCEPTION 'a regex rule needs a placeholder kind';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.ai_deid_rules(name, kind, entries, placeholder_kind) VALUES ('Allow', 'allow_list', ARRAY['x'], 'person');
    RAISE EXCEPTION 'an exception list has no placeholder kind';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.ai_deid_rules(name, kind, pattern, placeholder_kind, languages) VALUES ('Lang', 'regex', 'x+', 'person', ARRAY['zz']);
    RAISE EXCEPTION 'rule languages must be known';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- A teacher without system.ai.manage sees no rules.
SELECT set_config('request.jwt.claim.sub', 'a1510000-0000-4000-8000-000000000001', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_deid_rules) THEN
    RAISE EXCEPTION 'de-identification rules should be hidden from teachers';
  END IF;
END;
$$;

-- A system admin reads them but cannot write.
SELECT set_config('request.jwt.claim.sub', 'a1510000-0000-4000-8000-000000000002', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.ai_deid_rules) <> 3 THEN
    RAISE EXCEPTION 'system.ai.manage should read every rule';
  END IF;
END;
$$;

DO $$
BEGIN
  INSERT INTO public.ai_deid_rules(name, kind, entries, placeholder_kind) VALUES ('Direct', 'deny_list', ARRAY['x'], 'person');
  RAISE EXCEPTION 'authenticated users must not write rules directly';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;

DO $$
BEGIN
  UPDATE public.ai_settings SET deid_languages = '{en}';
  RAISE EXCEPTION 'authenticated users must not change languages directly';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;

RESET ROLE;
ROLLBACK;
