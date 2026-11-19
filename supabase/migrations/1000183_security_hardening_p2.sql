-- Security hardening (batch 2).
--
-- 1. Extension pairing confirmation code. The API generates six random digits
--    per pair request; the extension shows them and the approval page sends
--    them back, so a pairing link forwarded by someone else cannot be approved
--    blindly. Requests created before this migration have no code and can no
--    longer be approved; they expire within ten minutes anyway.
-- 2. rbac_policy_epoch is written only by the SECURITY DEFINER trigger
--    function. Signed-in users keep read access, but RLS is now enabled and
--    no write privilege is left for authenticated.
-- 3. api_session_activity records when each browser session started and when
--    its user was last active. The API refuses to refresh a session idle for
--    8 hours or older than 30 days. Service role only.

BEGIN;

ALTER TABLE public.web_extension_pairing_requests
  ADD COLUMN IF NOT EXISTS confirmation_code text
    CHECK (confirmation_code IS NULL OR confirmation_code ~ '^[0-9]{6}$');

COMMENT ON COLUMN public.web_extension_pairing_requests.confirmation_code IS
  'Six-digit code shown by the extension and required on approval; a mismatch revokes the request.';

UPDATE public.web_extension_pairing_requests
SET status = 'revoked'
WHERE status = 'pending' AND confirmation_code IS NULL;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.rbac_policy_epoch FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rbac_policy_epoch TO authenticated;
ALTER TABLE public.rbac_policy_epoch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Signed-in users read the RBAC policy epoch" ON public.rbac_policy_epoch;
CREATE POLICY "Signed-in users read the RBAC policy epoch"
  ON public.rbac_policy_epoch FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.api_session_activity (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_session_activity_last_activity_idx
  ON public.api_session_activity (last_activity_at);
CREATE INDEX IF NOT EXISTS api_session_activity_user_idx
  ON public.api_session_activity (user_id);
ALTER TABLE public.api_session_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_session_activity FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_session_activity TO service_role;
COMMENT ON TABLE public.api_session_activity IS
  'Browser session start and last user activity, for the API idle (8 h) and absolute (30 d) session limits; service-role access only.';

COMMIT;
