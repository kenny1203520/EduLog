-- AI report assistant: credentials, models, prompt versions, generation quota,
-- generation log, teaching-suggestion states, adoption tracking, notice
-- acknowledgements, site settings and the three AI permissions.
--
-- Every write goes through the API's service-role client: the API encrypts
-- credential secrets, charges quota only after a successful generation and
-- stores de-identified input/output only. Authenticated users can read their
-- own rows; holders of system.ai.logs.view_all read every generation, and
-- holders of system.ai.manage read the admin tables.
--
-- ai_credentials.secret_ciphertext is never granted to anon or authenticated:
-- the column-level SELECT grant leaves it out, so PostgREST cannot return it
-- even for the credential's owner. Only secret_hint (a masked form such as
-- "sk-…abcd") is readable.
--
-- Generation records are kept permanently: deleting a report, user, credential
-- or model nulls the reference instead of deleting the log.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR to_regclass('public.occurrence_reports') IS NULL
     OR to_regclass('public.user_preferences') IS NULL THEN
    RAISE EXCEPTION '1000149 prerequisites missing; apply migrations through 1000148 first';
  END IF;
END;
$$;

-- Permissions ---------------------------------------------------------------

INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES
  ('teaching.ai.generate', '使用 AI 生成報告', '允許在報告編輯器使用 AI 生成學習報告與教學建議', 'teaching', 'ai', 'generate'),
  ('system.ai.manage', '管理 AI 設定', '允許管理 AI 供應商憑證、模型、提示詞、額度與總開關', 'system', 'ai', 'manage'),
  ('system.ai.logs.view_all', '查看所有 AI 紀錄', '允許查看所有使用者的 AI 生成與採用紀錄', 'system', 'ai', 'logs_view_all')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles role
JOIN public.permissions permission ON permission.domain = role.domain
WHERE role.is_builtin
  AND (
    (permission.key = 'teaching.ai.generate'
      AND role.domain = 'teaching' AND role.code IN ('teaching_owner', 'teaching_manager', 'teacher'))
    OR (permission.key = 'system.ai.manage'
      AND role.domain = 'system' AND role.code IN ('system_owner', 'system_admin'))
    OR (permission.key = 'system.ai.logs.view_all'
      AND role.domain = 'system' AND role.code IN ('system_owner', 'system_admin', 'auditor'))
  )
ON CONFLICT DO NOTHING;

-- Tables --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('site', 'user')),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'google', 'openrouter', 'ollama')),
  auth_type text NOT NULL CHECK (auth_type IN ('api_key', 'oauth', 'none')),
  -- AES-256-GCM envelope produced by the API (server/src/ai/credentials/secretCipher.ts).
  secret_ciphertext text,
  secret_hint text CHECK (secret_hint IS NULL OR length(secret_hint) <= 32),
  base_url text CHECK (base_url IS NULL OR length(base_url) <= 2048),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalid', 'disabled')),
  last_verified_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_credentials_owner_matches_scope CHECK (
    (scope = 'site' AND owner_user_id IS NULL) OR (scope = 'user' AND owner_user_id IS NOT NULL)
  ),
  CONSTRAINT ai_credentials_secret_matches_auth CHECK (
    (auth_type = 'none' AND secret_ciphertext IS NULL) OR (auth_type <> 'none' AND secret_ciphertext IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS ai_credentials_owner_idx
  ON public.ai_credentials (owner_user_id, created_at DESC) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_credentials_site_idx
  ON public.ai_credentials (provider, created_at DESC) WHERE scope = 'site';

CREATE TABLE IF NOT EXISTS public.ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES public.ai_credentials(id) ON DELETE CASCADE,
  model_id text NOT NULL CHECK (length(btrim(model_id)) BETWEEN 1 AND 200),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  quota_weight numeric(8, 2) NOT NULL DEFAULT 1 CHECK (quota_weight >= 0),
  price_input_per_mtok numeric(12, 4) CHECK (price_input_per_mtok IS NULL OR price_input_per_mtok >= 0),
  price_output_per_mtok numeric(12, 4) CHECK (price_output_per_mtok IS NULL OR price_output_per_mtok >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credential_id, model_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_one_default_per_credential_idx
  ON public.ai_models (credential_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS public.ai_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key text NOT NULL CHECK (prompt_key ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  version integer NOT NULL CHECK (version > 0),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 100000),
  source text NOT NULL CHECK (source IN ('code', 'override')),
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_prompt_versions_one_active_idx
  ON public.ai_prompt_versions (prompt_key) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.ai_quota_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('default', 'role', 'user')),
  -- roles.id for scope 'role', auth.users.id for scope 'user', NULL for 'default'.
  target_id uuid,
  one_time_total numeric(12, 2) CHECK (one_time_total IS NULL OR one_time_total >= 0),
  period text NOT NULL DEFAULT 'none' CHECK (period IN ('none', 'day', 'week', 'month')),
  period_amount numeric(12, 2) CHECK (period_amount IS NULL OR period_amount >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_quota_policies_target_matches_scope CHECK (
    (scope = 'default' AND target_id IS NULL) OR (scope <> 'default' AND target_id IS NOT NULL)
  ),
  CONSTRAINT ai_quota_policies_period_amount CHECK (
    (period = 'none' AND period_amount IS NULL) OR (period <> 'none' AND period_amount IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_quota_policies_target_idx
  ON public.ai_quota_policies (scope, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS public.ai_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  notice_version integer NOT NULL DEFAULT 1 CHECK (notice_version > 0),
  default_model_id uuid REFERENCES public.ai_models(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_report_id uuid REFERENCES public.occurrence_reports(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  credential_id uuid REFERENCES public.ai_credentials(id) ON DELETE SET NULL,
  credential_scope text NOT NULL CHECK (credential_scope IN ('site', 'user')),
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'google', 'openrouter', 'ollama')),
  model_id text NOT NULL CHECK (length(btrim(model_id)) BETWEEN 1 AND 200),
  prompt_versions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(prompt_versions) = 'object'),
  options jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(options) = 'object'),
  sanitized_input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(sanitized_input) = 'object'),
  sanitized_output jsonb CHECK (sanitized_output IS NULL OR jsonb_typeof(sanitized_output) = 'object'),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled')),
  error_code text CHECK (error_code IS NULL OR length(error_code) <= 120),
  tokens_in integer CHECK (tokens_in IS NULL OR tokens_in >= 0),
  tokens_out integer CHECK (tokens_out IS NULL OR tokens_out >= 0),
  est_cost numeric(12, 6) CHECK (est_cost IS NULL OR est_cost >= 0),
  quota_charged numeric(12, 2) NOT NULL DEFAULT 0 CHECK (quota_charged >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  session_seq integer NOT NULL DEFAULT 1 CHECK (session_seq > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Failed and cancelled generations never charge quota.
  CONSTRAINT ai_generations_charge_only_on_success CHECK (status = 'succeeded' OR quota_charged = 0)
);
CREATE INDEX IF NOT EXISTS ai_generations_user_idx
  ON public.ai_generations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_generations_report_idx
  ON public.ai_generations (occurrence_report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_generations_created_idx
  ON public.ai_generations (created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_quota_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generation_id uuid REFERENCES public.ai_generations(id) ON DELETE SET NULL,
  delta numeric(12, 2) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('grant', 'consume', 'reset')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_quota_ledger_consume_is_negative CHECK (kind <> 'consume' OR (delta <= 0 AND generation_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ai_quota_ledger_user_idx
  ON public.ai_quota_ledger (user_id, created_at DESC);
-- A generation is charged at most once.
CREATE UNIQUE INDEX IF NOT EXISTS ai_quota_ledger_one_consume_idx
  ON public.ai_quota_ledger (generation_id) WHERE kind = 'consume';

CREATE TABLE IF NOT EXISTS public.ai_teaching_suggestion_states (
  generation_id uuid NOT NULL REFERENCES public.ai_generations(id) ON DELETE CASCADE,
  suggestion_index integer NOT NULL CHECK (suggestion_index >= 0),
  state text NOT NULL CHECK (state IN ('kept', 'dismissed')),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_id, suggestion_index)
);

CREATE TABLE IF NOT EXISTS public.ai_adoptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES public.ai_generations(id) ON DELETE CASCADE,
  section_key text NOT NULL CHECK (length(btrim(section_key)) BETWEEN 1 AND 64),
  action text NOT NULL CHECK (action IN ('insert', 'replace', 'copy', 'adopt_all')),
  sanitized_snapshot text NOT NULL CHECK (length(sanitized_snapshot) <= 100000),
  adopted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  adopted_at timestamptz NOT NULL DEFAULT now(),
  final_similarity numeric(5, 4) CHECK (final_similarity IS NULL OR final_similarity BETWEEN 0 AND 1),
  measured_from text CHECK (measured_from IS NULL OR measured_from IN ('push', 'save')),
  measured_at timestamptz,
  CONSTRAINT ai_adoptions_measurement_complete CHECK (
    (final_similarity IS NULL AND measured_from IS NULL AND measured_at IS NULL)
    OR (final_similarity IS NOT NULL AND measured_from IS NOT NULL AND measured_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS ai_adoptions_generation_idx
  ON public.ai_adoptions (generation_id, adopted_at);
CREATE INDEX IF NOT EXISTS ai_adoptions_unmeasured_idx
  ON public.ai_adoptions (adopted_at) WHERE final_similarity IS NULL;

CREATE TABLE IF NOT EXISTS public.ai_notice_acknowledgements (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notice_version integer NOT NULL CHECK (notice_version > 0),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notice_version)
);

DROP TRIGGER IF EXISTS update_ai_credentials_updated_at ON public.ai_credentials;
CREATE TRIGGER update_ai_credentials_updated_at BEFORE UPDATE ON public.ai_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_ai_models_updated_at ON public.ai_models;
CREATE TRIGGER update_ai_models_updated_at BEFORE UPDATE ON public.ai_models
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_ai_quota_policies_updated_at ON public.ai_quota_policies;
CREATE TRIGGER update_ai_quota_policies_updated_at BEFORE UPDATE ON public.ai_quota_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_ai_settings_updated_at ON public.ai_settings;
CREATE TRIGGER update_ai_settings_updated_at BEFORE UPDATE ON public.ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Grants: authenticated users only read; the API writes as service_role ------

ALTER TABLE public.ai_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_quota_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_quota_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_teaching_suggestion_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_adoptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_notice_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_credentials, public.ai_models, public.ai_prompt_versions,
  public.ai_quota_policies, public.ai_quota_ledger, public.ai_generations,
  public.ai_teaching_suggestion_states, public.ai_adoptions,
  public.ai_notice_acknowledgements, public.ai_settings
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_credentials, public.ai_models, public.ai_prompt_versions,
  public.ai_quota_policies, public.ai_quota_ledger, public.ai_generations,
  public.ai_teaching_suggestion_states, public.ai_adoptions,
  public.ai_notice_acknowledgements, public.ai_settings
  TO service_role;

-- Column-level grant: secret_ciphertext is deliberately absent.
GRANT SELECT (id, scope, owner_user_id, provider, auth_type, secret_hint, base_url, label, status,
  last_verified_at, created_at, updated_at)
  ON public.ai_credentials TO authenticated;
GRANT SELECT ON public.ai_models, public.ai_prompt_versions, public.ai_quota_policies,
  public.ai_quota_ledger, public.ai_generations, public.ai_teaching_suggestion_states,
  public.ai_adoptions, public.ai_notice_acknowledgements, public.ai_settings
  TO authenticated;

-- Policies -----------------------------------------------------------------

-- Own personal credentials; active site credentials (label/provider only) so
-- the source picker can list them; every credential for AI managers.
DROP POLICY IF EXISTS ai_credentials_read ON public.ai_credentials;
CREATE POLICY ai_credentials_read ON public.ai_credentials FOR SELECT TO authenticated
  USING (
    (scope = 'user' AND owner_user_id = (select auth.uid()))
    OR (scope = 'site' AND status = 'active')
    OR public.has_api_permission((select auth.uid()), 'system.ai.manage', NULL, NULL)
  );

-- Models follow the visibility of their credential.
DROP POLICY IF EXISTS ai_models_read ON public.ai_models;
CREATE POLICY ai_models_read ON public.ai_models FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_credentials credential WHERE credential.id = ai_models.credential_id));

DROP POLICY IF EXISTS ai_prompt_versions_manage_read ON public.ai_prompt_versions;
CREATE POLICY ai_prompt_versions_manage_read ON public.ai_prompt_versions FOR SELECT TO authenticated
  USING (public.has_api_permission((select auth.uid()), 'system.ai.manage', NULL, NULL));

DROP POLICY IF EXISTS ai_quota_policies_manage_read ON public.ai_quota_policies;
CREATE POLICY ai_quota_policies_manage_read ON public.ai_quota_policies FOR SELECT TO authenticated
  USING (public.has_api_permission((select auth.uid()), 'system.ai.manage', NULL, NULL));

DROP POLICY IF EXISTS ai_quota_ledger_read ON public.ai_quota_ledger;
CREATE POLICY ai_quota_ledger_read ON public.ai_quota_ledger FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    OR public.has_api_permission((select auth.uid()), 'system.ai.manage', NULL, NULL)
    OR public.has_api_permission((select auth.uid()), 'system.ai.logs.view_all', NULL, NULL)
  );

-- Teachers read only their own generations.
DROP POLICY IF EXISTS ai_generations_read ON public.ai_generations;
CREATE POLICY ai_generations_read ON public.ai_generations FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    OR public.has_api_permission((select auth.uid()), 'system.ai.logs.view_all', NULL, NULL)
  );

-- Suggestion states and adoptions follow the visibility of their generation.
DROP POLICY IF EXISTS ai_teaching_suggestion_states_read ON public.ai_teaching_suggestion_states;
CREATE POLICY ai_teaching_suggestion_states_read ON public.ai_teaching_suggestion_states FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_generations generation WHERE generation.id = ai_teaching_suggestion_states.generation_id));

DROP POLICY IF EXISTS ai_adoptions_read ON public.ai_adoptions;
CREATE POLICY ai_adoptions_read ON public.ai_adoptions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_generations generation WHERE generation.id = ai_adoptions.generation_id));

DROP POLICY IF EXISTS ai_notice_acknowledgements_self_read ON public.ai_notice_acknowledgements;
CREATE POLICY ai_notice_acknowledgements_self_read ON public.ai_notice_acknowledgements FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- The switch, notice version and default model are not sensitive.
DROP POLICY IF EXISTS ai_settings_read ON public.ai_settings;
CREATE POLICY ai_settings_read ON public.ai_settings FOR SELECT TO authenticated
  USING (true);

-- Per-user AI panel preferences (tone, length, last source/model) ----------

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS ai_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_ai_settings_check,
  ADD CONSTRAINT user_preferences_ai_settings_check CHECK (
    jsonb_typeof(ai_settings) = 'object' AND pg_column_size(ai_settings) <= 16384
  );

COMMENT ON TABLE public.ai_credentials IS 'Site and personal LLM provider credentials. secret_ciphertext is AES-256-GCM encrypted by the API and readable only by service_role.';
COMMENT ON TABLE public.ai_models IS 'Models offered per credential, with quota weight and price per million tokens.';
COMMENT ON TABLE public.ai_prompt_versions IS 'Versioned prompts: code baselines and administrator overrides.';
COMMENT ON TABLE public.ai_quota_policies IS 'Generation quota policies (default, per role, per user): one-time total and/or periodic amount.';
COMMENT ON TABLE public.ai_quota_ledger IS 'Quota grants, consumption (successful site-credential generations only) and resets.';
COMMENT ON TABLE public.ai_generations IS 'Permanent AI generation log with de-identified input and output only.';
COMMENT ON TABLE public.ai_teaching_suggestion_states IS 'Teacher decisions (kept/dismissed) on internal teaching suggestions.';
COMMENT ON TABLE public.ai_adoptions IS 'Adopted AI sections with a de-identified snapshot and later similarity measurement.';
COMMENT ON TABLE public.ai_notice_acknowledgements IS 'Which AI usage notice version each user has acknowledged.';
COMMENT ON TABLE public.ai_settings IS 'Single-row AI site settings: master switch, notice version and default model.';
COMMENT ON COLUMN public.user_preferences.ai_settings IS 'AI panel preferences: tone, length, last credential source and model.';

NOTIFY pgrst, 'reload schema';
COMMIT;
