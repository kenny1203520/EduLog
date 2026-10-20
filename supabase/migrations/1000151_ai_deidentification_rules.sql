-- AI report assistant: administrator-managed de-identification.
--
-- ai_deid_rules holds custom rules applied on top of the known-name patterns:
-- deny_list (words always replaced), regex (pattern always replaced) and
-- allow_list (exception words NER must not replace). Exceptions never apply
-- to known students, teachers or schools; the API enforces that.
-- ai_settings.deid_languages picks which installed Presidio languages run.
-- Authenticated users with system.ai.manage only read; the API writes as
-- service_role.

CREATE TABLE IF NOT EXISTS public.ai_deid_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('deny_list', 'regex', 'allow_list')),
  entries text[] NOT NULL DEFAULT '{}' CHECK (cardinality(entries) <= 500),
  pattern text CHECK (pattern IS NULL OR length(pattern) BETWEEN 1 AND 1000),
  -- Placeholder the match becomes; NULL for allow_list.
  placeholder_kind text CHECK (placeholder_kind IN ('person', 'location', 'organization', 'phone', 'email', 'nationalId', 'sensitive')),
  -- Presidio language codes; empty means every enabled language.
  languages text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  score numeric(3, 2) NOT NULL DEFAULT 0.85 CHECK (score > 0 AND score <= 1),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_deid_rules_shape CHECK (
    (kind = 'deny_list' AND cardinality(entries) > 0 AND pattern IS NULL AND placeholder_kind IS NOT NULL)
    OR (kind = 'regex' AND pattern IS NOT NULL AND cardinality(entries) = 0 AND placeholder_kind IS NOT NULL)
    OR (kind = 'allow_list' AND cardinality(entries) > 0 AND pattern IS NULL AND placeholder_kind IS NULL)
  ),
  CONSTRAINT ai_deid_rules_languages CHECK (languages <@ ARRAY['zh', 'en', 'ja', 'ko']::text[])
);

ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS deid_languages text[] NOT NULL DEFAULT '{zh}';
ALTER TABLE public.ai_settings
  DROP CONSTRAINT IF EXISTS ai_settings_deid_languages_check,
  ADD CONSTRAINT ai_settings_deid_languages_check CHECK (
    cardinality(deid_languages) > 0 AND deid_languages <@ ARRAY['zh', 'en', 'ja', 'ko']::text[]
  );

DROP TRIGGER IF EXISTS update_ai_deid_rules_updated_at ON public.ai_deid_rules;
CREATE TRIGGER update_ai_deid_rules_updated_at BEFORE UPDATE ON public.ai_deid_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ai_deid_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_deid_rules FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_deid_rules TO service_role;
GRANT SELECT ON public.ai_deid_rules TO authenticated;

DROP POLICY IF EXISTS ai_deid_rules_manage_read ON public.ai_deid_rules;
CREATE POLICY ai_deid_rules_manage_read ON public.ai_deid_rules FOR SELECT TO authenticated
  USING (public.has_api_permission((select auth.uid()), 'system.ai.manage', NULL, NULL));

COMMENT ON TABLE public.ai_deid_rules IS 'Custom de-identification rules: deny lists, regex patterns and exception words.';
COMMENT ON COLUMN public.ai_settings.deid_languages IS 'Presidio languages analyzed for every AI request; each must be installed in the analyzer image.';
