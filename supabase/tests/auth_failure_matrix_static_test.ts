import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const source = await Deno.readTextFile(new URL('../volumes/functions/_shared/api.ts', import.meta.url))

Deno.test('JWT failure matrix is fail-closed and does not expose verification detail', () => {
  assertStringIncludes(source, "'AUTH_REQUIRED'")
  assertStringIncludes(source, "'AUTH_INVALID'")
  assertStringIncludes(source, "adminDb.auth.getUser(token)")
  assert(!source.includes('console.log(token)'))
  assert(!source.includes('console.error(token)'))
})
