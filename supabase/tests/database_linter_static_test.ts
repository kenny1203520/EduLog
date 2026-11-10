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

const lockdown = await readMigration('1000167_lockdown_public_privileges.sql')
const migrationNumber = (name: string) => Number(/^(\d+)/.exec(name)?.[1] ?? 0)
const withoutComments = (sql: string) => sql.replace(/--.*$/gm, '')

Deno.test('1000167 locks anon out of public and stops default grants', () => {
  assertStringIncludes(lockdown, 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon')
  assertStringIncludes(lockdown, "REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated")
  assertStringIncludes(lockdown, 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC')
  assertStringIncludes(lockdown, 'IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated')
  assertFalse(/GRANT\s+[^;]*\bTO\s+anon\b/i.test(withoutComments(lockdown)), '1000167 must not grant anything to anon')
})

Deno.test('migrations after 1000167 revoke function access from anon, not only PUBLIC', async () => {
  for await (const entry of Deno.readDir(migrationDir)) {
    if (!entry.isFile || !entry.name.endsWith('.sql') || migrationNumber(entry.name) <= 1000167) continue
    const sql = withoutComments(await readMigration(entry.name))
    for (const statement of sql.match(/REVOKE\s[^;]*?ON\s+FUNCTION\s[^;]*?FROM\s[^;]*;/gis) ?? []) {
      if (/\bPUBLIC\b/i.test(statement.split(/\bFROM\b/i).pop() ?? '')) {
        assert(/\banon\b/i.test(statement), `${entry.name}: "${statement.trim()}" must also revoke from anon`)
      }
    }
    assertFalse(/GRANT\s[^;]*?ON\s+FUNCTION\s[^;]*?\bTO\s+[^;]*\banon\b/is.test(sql), `${entry.name} must not grant functions to anon`)
  }
})
