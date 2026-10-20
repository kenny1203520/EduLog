-- AI generation details for diagnosis and review.
--
-- error_detail keeps the provider's HTTP status and a short, redacted message
-- (no keys), so a failed generation says why. system_prompt keeps the full
-- system rules sent with the generation; before this only their version was
-- recorded. supports_structured_output records whether a model accepts JSON
-- schema output (NULL = unknown); models that do not are called in a
-- compatibility mode that asks for JSON in the prompt instead.

BEGIN;

ALTER TABLE public.ai_generations ADD COLUMN IF NOT EXISTS error_detail jsonb;
ALTER TABLE public.ai_generations ADD COLUMN IF NOT EXISTS system_prompt text;

ALTER TABLE public.ai_generations DROP CONSTRAINT IF EXISTS ai_generations_error_detail_shape;
ALTER TABLE public.ai_generations
  ADD CONSTRAINT ai_generations_error_detail_shape
  CHECK (error_detail IS NULL OR (jsonb_typeof(error_detail) = 'object' AND octet_length(error_detail::text) <= 4000));

ALTER TABLE public.ai_models ADD COLUMN IF NOT EXISTS supports_structured_output boolean;

COMMENT ON COLUMN public.ai_generations.error_detail IS 'Provider status and a short redacted message for failed generations.';
COMMENT ON COLUMN public.ai_generations.system_prompt IS 'Full system prompt sent with the generation (contains no personal data).';
COMMENT ON COLUMN public.ai_models.supports_structured_output IS 'Whether the model accepts JSON schema output; NULL when unknown.';

NOTIFY pgrst, 'reload schema';
COMMIT;
