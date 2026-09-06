import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const migrationDir = new URL('../migrations/', import.meta.url)
const reconciliation = await Deno.readTextFile(new URL('1000043_teaching_scope_reconciliation.sql', migrationDir))
const hardening = await Deno.readTextFile(new URL('1000044_rbac_epoch_and_api_contract.sql', migrationDir))

Deno.test('reconciliation migration is present and fail-closed', () => {
  assertStringIncludes(reconciliation, 'CREATE TABLE IF NOT EXISTS public.teachings')
  assertStringIncludes(reconciliation, 'CREATE TABLE IF NOT EXISTS public.teaching_members')
  assertStringIncludes(reconciliation, 'RAISE EXCEPTION')
  assertStringIncludes(reconciliation, 'DROP POLICY IF EXISTS "Enable all access for authenticated users"')
  assertStringIncludes(reconciliation, 'GRANT EXECUTE ON FUNCTION public.can_teaching_action')
  assertStringIncludes(reconciliation, 'matched.effect')
  assertStringIncludes(reconciliation, 'FROM matched;')
  assertStringIncludes(reconciliation, 'WITH resolved_sessions AS')
})

Deno.test('forward hardening adds epoch, cycle prevention, and action-specific RLS', () => {
  assertStringIncludes(hardening, 'CREATE TABLE IF NOT EXISTS public.rbac_policy_epoch')
  assertStringIncludes(hardening, 'RBAC_ROLE_INHERITANCE_CYCLE')
  assertStringIncludes(hardening, 'CREATE OR REPLACE FUNCTION public.has_api_permission')
  assertStringIncludes(hardening, 'public.resolve_user_permission(uuid,text,uuid,uuid,date)')
  assertStringIncludes(hardening, 'Teaching enrollments create')
  assert(!hardening.includes('FOR ALL TO authenticated'))
})

Deno.test('historical migration versions are preserved', async () => {
  const names = []
  for await (const entry of Deno.readDir(migrationDir)) {
    if (entry.isFile && entry.name.endsWith('.sql')) names.push(entry.name)
  }
  for (const version of ['1000001', '1000002', '1000003', '1000041', '1000042', '1000043', '1000044']) {
    assert(names.some((name) => name.startsWith(version)), `missing migration ${version}`)
  }
  assert(!names.some((name) => name.startsWith('1000010')))
  assert(!names.some((name) => name.startsWith('1000015')))
  assert(!names.some((name) => name.startsWith('1000016')))
})
