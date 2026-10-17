-- Web extension pairing, source identity, resumable import state, and report push audit.
-- Secrets and source payloads are never stored in these tables.

CREATE TABLE IF NOT EXISTS public.web_extension_pairing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  extension_origin text NOT NULL,
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'claimed', 'revoked')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  approved_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS web_extension_pairing_expiry_idx
  ON public.web_extension_pairing_requests (expires_at) WHERE status IN ('pending', 'approved');

CREATE TABLE IF NOT EXISTS public.web_extension_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  extension_origin text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS web_extension_tokens_user_idx
  ON public.web_extension_tokens (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.web_extension_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_origin text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('student', 'course', 'classroom', 'class_session', 'enrollment', 'occurrence', 'report')),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 256),
  edulog_id uuid NOT NULL,
  source_fingerprint text CHECK (source_fingerprint IS NULL OR source_fingerprint ~ '^[a-f0-9]{64}$'),
  linked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_origin, source_kind, source_id)
);
CREATE INDEX IF NOT EXISTS web_extension_source_links_edulog_idx
  ON public.web_extension_source_links (user_id, source_kind, edulog_id);

CREATE TABLE IF NOT EXISTS public.web_extension_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_origin text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'previewed', 'applying', 'complete', 'failed', 'cancelled')),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS web_extension_import_jobs_user_idx
  ON public.web_extension_import_jobs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.web_extension_report_pushes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.occurrence_reports(id) ON DELETE CASCADE,
  source_origin text NOT NULL,
  source_report_url text NOT NULL CHECK (length(source_report_url) <= 2048),
  status text NOT NULL CHECK (status IN ('confirmed', 'pending_confirmation')),
  pushed_at timestamptz,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS web_extension_report_pushes_report_idx
  ON public.web_extension_report_pushes (user_id, report_id, created_at DESC);

ALTER TABLE public.web_extension_pairing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_extension_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_extension_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_extension_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_extension_report_pushes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.web_extension_pairing_requests FROM anon, authenticated;
REVOKE ALL ON public.web_extension_tokens FROM anon, authenticated;
REVOKE ALL ON public.web_extension_source_links FROM anon, authenticated;
REVOKE ALL ON public.web_extension_import_jobs FROM anon, authenticated;
REVOKE ALL ON public.web_extension_report_pushes FROM anon, authenticated;
GRANT ALL ON public.web_extension_pairing_requests TO service_role;
GRANT ALL ON public.web_extension_tokens TO service_role;
GRANT ALL ON public.web_extension_source_links TO service_role;
GRANT ALL ON public.web_extension_import_jobs TO service_role;
GRANT ALL ON public.web_extension_report_pushes TO service_role;

COMMENT ON TABLE public.web_extension_pairing_requests IS 'Short-lived PKCE pairing requests initiated by the browser extension; service-role access only.';
COMMENT ON TABLE public.web_extension_tokens IS 'Hashed, revocable extension credentials restricted to integration API routes; plaintext tokens are never stored.';
COMMENT ON TABLE public.web_extension_source_links IS 'Per-user stable mapping between external source IDs and EduLog entity IDs.';
COMMENT ON TABLE public.web_extension_import_jobs IS 'Resumable import metadata only; source records remain in the browser.';
COMMENT ON TABLE public.web_extension_report_pushes IS 'Audit records for manually submitted report prefill operations.';
