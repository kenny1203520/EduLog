BEGIN;

INSERT INTO public.permissions (key, name, description, domain, resource, action)
VALUES ('system.auth.oauth_clients.manage', 'Manage OAuth applications',
  'Register and remove third-party applications that use this instance for sign-in',
  'system', 'auth', 'oauth_clients_manage')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permission_policies (role_id, permission_id, scope_type, scope_id, effect)
SELECT roles.id, permissions.id, 'system', NULL, 'allow'
FROM public.roles
JOIN public.permissions ON permissions.key = 'system.auth.oauth_clients.manage'
WHERE roles.is_builtin AND roles.domain = 'system' AND roles.code = 'system_owner'
ON CONFLICT DO NOTHING;

CREATE FUNCTION public.edulog_reject_external_oauth()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF auth.jwt() ? 'client_id' THEN
    RAISE EXCEPTION 'Third-party OAuth tokens are limited to identity endpoints'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.edulog_reject_external_oauth() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edulog_reject_external_oauth() TO authenticated, service_role;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.edulog_reject_external_oauth';
NOTIFY pgrst, 'reload config';

-- RPCs (including SECURITY DEFINER) and GraphQL pass through the pre-request
-- function. Storage and private Realtime channels have independent DB clients.
CREATE POLICY reject_external_oauth ON storage.objects AS RESTRICTIVE FOR ALL
  USING (NOT coalesce(auth.jwt() ? 'client_id', false))
  WITH CHECK (NOT coalesce(auth.jwt() ? 'client_id', false));

CREATE POLICY reject_external_oauth ON storage.buckets AS RESTRICTIVE FOR ALL
  USING (NOT coalesce(auth.jwt() ? 'client_id', false))
  WITH CHECK (NOT coalesce(auth.jwt() ? 'client_id', false));

CREATE POLICY reject_external_oauth ON realtime.messages AS RESTRICTIVE FOR ALL
  USING (NOT coalesce(auth.jwt() ? 'client_id', false))
  WITH CHECK (NOT coalesce(auth.jwt() ? 'client_id', false));

-- Postgres Changes authorizes each WAL row against its published table.
DO $$
DECLARE
  published record;
BEGIN
  FOR published IN
    SELECT schemaname, tablename
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  LOOP
    EXECUTE format(
      'CREATE POLICY reject_external_oauth ON %I.%I AS RESTRICTIVE FOR SELECT '
        'USING (NOT coalesce(auth.jwt() ? ''client_id'', false))',
      published.schemaname, published.tablename
    );
  END LOOP;
END;
$$;

COMMIT;
