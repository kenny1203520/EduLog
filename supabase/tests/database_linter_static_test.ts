import { assert, assertFalse, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const migrationDir = new URL('../migrations/', import.meta.url)
const readMigration = (name: string) => Deno.readTextFile(new URL(name, migrationDir))
const hardening = await readMigration('1000044_rbac_epoch_and_api_contract.sql')
const coreHardening = await readMigration('1000045_missing_core_rls_hardening.sql')
const rateLimit = await readMigration('1000046_api_rate_limit_shared_store.sql')

const scalarAuthUid = /\(\s*select\s+auth\.uid\(\)/i

Deno.test('forward migrations use initplan-safe auth expressions and scoped policies', () => {
  assert(scalarAuthUid.test(hardening), '1000044 must contain scalar auth.uid() rewrites')
  assert(scalarAuthUid.test(coreHardening), '1000045 must contain scalar auth.uid() rewrites')
  assertFalse(/FOR\s+ALL\s+TO\s+authenticated/i.test(hardening), '1000044 must not restore authenticated-wide policies')
  assertFalse(/FOR\s+ALL\s+TO\s+authenticated/i.test(coreHardening), '1000045 must not create authenticated-wide policies')
})

Deno.test('shared rate limit store is fail-closed and service-role only', () => {
  assertStringIncludes(rateLimit, 'CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets')
  assertStringIncludes(rateLimit, 'ON CONFLICT (bucket_key) DO UPDATE')
  assertStringIncludes(rateLimit, 'REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated')
  assertStringIncludes(rateLimit, 'GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role')
})
