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
function privilegeStatements(sql: string): string[][] {
  const uncommented = sql.split('\n').map(line => {
    const comment = line.indexOf('--')
    return comment < 0 ? line : line.slice(0, comment)
  }).join('\n')
  return uncommented.split(';').map(statement =>
    statement.toLowerCase().match(/[a-z_][a-z_0-9]*/g) ?? []
  )
}

function functionPrivileges(sql: string) {
  return privilegeStatements(sql).flatMap(tokens => {
    const operation = tokens.findIndex(token => token === 'grant' || token === 'revoke')
    if (operation < 0) return []
    const on = tokens.indexOf('on', operation + 1)
    if (on < 0 || tokens[on + 1] !== 'function') return []
    const verb = tokens[operation]
    const separator = tokens.lastIndexOf(verb === 'grant' ? 'to' : 'from')
    if (separator <= on + 1) return []
    return [{ verb, roles: tokens.slice(separator + 1) }]
  })
}

Deno.test('privilege scan supports multiline statements, comments and reordered roles', () => {
  const sql = `-- GRANT EXECUTE ON FUNCTION public.demo() TO anon;
    REVOKE ALL ON FUNCTION public.demo(text) FROM authenticated, -- explanation
      anon, PUBLIC;
    GRANT EXECUTE ON FUNCTION public.demo(text) TO authenticated, anon;`
  const [revoke, grant] = functionPrivileges(sql)
  assert(revoke.verb === 'revoke' && revoke.roles.join(',') === 'authenticated,anon,public')
  assert(grant.verb === 'grant' && grant.roles.includes('anon'))
})

Deno.test('1000167 locks anon out of public and stops default grants', () => {
  assertStringIncludes(lockdown, 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon')
  assertStringIncludes(lockdown, "REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated")
  assertStringIncludes(lockdown, 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC')
  assertStringIncludes(lockdown, 'IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated')
  assertFalse(privilegeStatements(lockdown).some(tokens => {
    const grant = tokens.indexOf('grant')
    const to = tokens.lastIndexOf('to')
    return grant >= 0 && to > grant && tokens.slice(to + 1).includes('anon')
  }), '1000167 must not grant anything to anon')
})

Deno.test('migrations after 1000167 revoke function access from anon, not only PUBLIC', async () => {
  for await (const entry of Deno.readDir(migrationDir)) {
    if (!entry.isFile || !entry.name.endsWith('.sql') || migrationNumber(entry.name) <= 1000167) continue
    for (const { verb, roles } of functionPrivileges(await readMigration(entry.name))) {
      if (verb === 'revoke' && roles.includes('public')) {
        assert(roles.includes('anon'), `${entry.name}: function revocation from PUBLIC must also revoke from anon`)
      }
      assertFalse(verb === 'grant' && roles.includes('anon'), `${entry.name} must not grant functions to anon`)
    }
  }
})

Deno.test('1000183 locks rbac_policy_epoch writes, adds the pairing code and a private session activity table', async () => {
  const sql = await readMigration('1000183_security_hardening_p2.sql')
  assertStringIncludes(sql, 'ALTER TABLE public.rbac_policy_epoch ENABLE ROW LEVEL SECURITY')
  assert(/REVOKE INSERT, UPDATE, DELETE[\s\S]*ON TABLE public\.rbac_policy_epoch FROM PUBLIC, anon, authenticated/.test(sql), 'authenticated must lose epoch write privileges')
  assertFalse(/GRANT\s+(ALL|INSERT|UPDATE|DELETE)[^;]*rbac_policy_epoch/i.test(sql), 'no write grant may be restored')
  assertStringIncludes(sql, "FOR SELECT TO authenticated USING (true)")
  assertStringIncludes(sql, "confirmation_code ~ '^[0-9]{6}$'")
  assertStringIncludes(sql, 'ALTER TABLE public.api_session_activity ENABLE ROW LEVEL SECURITY')
  assertStringIncludes(sql, 'REVOKE ALL ON TABLE public.api_session_activity FROM PUBLIC, anon, authenticated')
})
