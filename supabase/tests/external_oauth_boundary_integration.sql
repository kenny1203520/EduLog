BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles, unnest(rolconfig) AS config
    WHERE rolname = 'authenticator'
      AND config = 'pgrst.db_pre_request=public.edulog_reject_external_oauth'
  ) THEN
    RAISE EXCEPTION 'PostgREST query guard is missing';
  END IF;
END;
$$;

GRANT SELECT ON storage.objects, storage.buckets, realtime.messages TO authenticated;
CREATE POLICY oauth_test_existing_access ON storage.objects FOR SELECT TO authenticated USING (true);
CREATE POLICY oauth_test_existing_access ON storage.buckets FOR SELECT TO authenticated USING (true);
CREATE POLICY oauth_test_existing_access ON realtime.messages FOR SELECT TO authenticated USING (true);

INSERT INTO storage.objects DEFAULT VALUES;
INSERT INTO storage.buckets DEFAULT VALUES;
INSERT INTO realtime.messages DEFAULT VALUES;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);

DO $$
BEGIN
  PERFORM public.edulog_reject_external_oauth();
  IF NOT EXISTS (SELECT FROM storage.objects)
     OR NOT EXISTS (SELECT FROM storage.buckets)
     OR NOT EXISTS (SELECT FROM realtime.messages) THEN
    RAISE EXCEPTION 'First-party sessions lost storage or realtime access';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claims', '{"role":"authenticated","client_id":"2de29e6b-ca8a-4bcc-b4ed-2ba362952c15"}', true);

DO $$
BEGIN
  BEGIN
    PERFORM public.edulog_reject_external_oauth();
    RAISE EXCEPTION 'External token passed PostgREST pre-request guard';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF EXISTS (SELECT FROM storage.objects)
     OR EXISTS (SELECT FROM storage.buckets)
     OR EXISTS (SELECT FROM realtime.messages) THEN
    RAISE EXCEPTION 'External token passed Storage or Realtime RLS';
  END IF;
END;
$$;

ROLLBACK;
