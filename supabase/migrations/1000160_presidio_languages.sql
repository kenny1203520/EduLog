-- De-identification languages follow the Presidio image (docker/presidio),
-- which now ships the spaCy pipelines of 24 languages. Widen the two checks
-- added by 1000151; the API's PRESIDIO_LANGUAGES list must match.

ALTER TABLE public.ai_deid_rules
  DROP CONSTRAINT IF EXISTS ai_deid_rules_languages,
  ADD CONSTRAINT ai_deid_rules_languages CHECK (
    languages <@ ARRAY['zh', 'en', 'ja', 'ko', 'ca', 'da', 'de', 'el', 'es', 'fi', 'fr', 'hr', 'it', 'lt', 'mk', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sl', 'sv', 'uk']::text[]
  );

ALTER TABLE public.ai_settings
  DROP CONSTRAINT IF EXISTS ai_settings_deid_languages_check,
  ADD CONSTRAINT ai_settings_deid_languages_check CHECK (
    cardinality(deid_languages) > 0 AND deid_languages <@ ARRAY['zh', 'en', 'ja', 'ko', 'ca', 'da', 'de', 'el', 'es', 'fi', 'fr', 'hr', 'it', 'lt', 'mk', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sl', 'sv', 'uk']::text[]
  );
