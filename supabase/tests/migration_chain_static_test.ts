import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const migrationDir = new URL('../migrations/', import.meta.url)
const reconciliation = await Deno.readTextFile(new URL('1000043_teaching_scope_reconciliation.sql', migrationDir))

Deno.test('reconciliation migration is present and fail-closed', () => {
  assertStringIncludes(reconciliation, 'CREATE TABLE IF NOT EXISTS public.teachings')
  assertStringIncludes(reconciliation, 'CREATE TABLE IF NOT EXISTS public.teaching_members')
  assertStringIncludes(reconciliation, 'RAISE EXCEPTION')
  assertStringIncludes(reconciliation, 'DROP POLICY IF EXISTS "Enable all access for authenticated users"')
  assertStringIncludes(reconciliation, 'GRANT EXECUTE ON FUNCTION public.can_teaching_action')
})

Deno.test('historical migration versions are preserved', async () => {
  const names = []
  for await (const entry of Deno.readDir(migrationDir)) {
    if (entry.isFile && entry.name.endsWith('.sql')) names.push(entry.name)
  }
  for (const version of ['1000001', '1000002', '1000003', '1000041', '1000042', '1000043']) {
    assert(names.some((name) => name.startsWith(version)), `missing migration ${version}`)
  }
  assert(!names.some((name) => name.startsWith('1000010')))
  assert(!names.some((name) => name.startsWith('1000015')))
  assert(!names.some((name) => name.startsWith('1000016')))
})
