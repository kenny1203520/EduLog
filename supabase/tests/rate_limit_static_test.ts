import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const migration = await Deno.readTextFile(new URL('../migrations/1000040_backend_security_reconciliation.sql', import.meta.url))

Deno.test('1000046 defines a service-role-only atomic shared rate limit RPC', () => {
  assertStringIncludes(migration, 'CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets')
  assertStringIncludes(migration, 'CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(')
  assertStringIncludes(migration, 'p_bucket_key text')
  assertStringIncludes(migration, 'p_limit integer')
  assertStringIncludes(migration, 'p_window_seconds integer')
  assertStringIncludes(migration, 'ON CONFLICT (bucket_key) DO UPDATE')
  assertStringIncludes(migration, 'REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated')
  assertStringIncludes(migration, 'GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role')
  assert(!migration.includes('auth.uid()'))
})
