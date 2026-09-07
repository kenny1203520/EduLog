import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const migrationDir = new URL('../migrations/', import.meta.url)
const reconciliation = await Deno.readTextFile(new URL('1000043_teaching_scope_reconciliation.sql', migrationDir))
const hardening = await Deno.readTextFile(new URL('1000044_rbac_epoch_and_api_contract.sql', migrationDir))
const compatibility = await Deno.readTextFile(new URL('1000041a_has_api_permission_compatibility.sql', migrationDir))
const rateLimit = await Deno.readTextFile(new URL('1000046_api_rate_limit_shared_store.sql', migrationDir))
const studentScope = await Deno.readTextFile(new URL('1000048_student_scope_course_fallback.sql', migrationDir))
const upgradeFixture = await Deno.readTextFile(new URL('migration_upgrade_fixture.sql', import.meta.url))

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
  assertStringIncludes(hardening, '(select auth.uid())')
  assertStringIncludes(hardening, 'Report editor read is scoped')
  assertStringIncludes(hardening, 'Canonical reports read')
  assertStringIncludes(hardening, 'Canonical reports create')
  assertStringIncludes(hardening, 'Canonical reports update')
  assertStringIncludes(hardening, 'Canonical reports delete')
  for (const policyName of [
    'Teaching owners create teachings',
    'Teaching owners update teachings',
    'Teaching owners delete teachings',
    'Users read own audit events',
    'Teaching templates read',
    'Teaching templates create',
    'Teaching templates update',
    'Teaching templates delete',
    'Teaching credentials read',
    'Teaching credentials create',
    'Teaching credentials update',
    'Teaching credentials delete',
    'Canonical teachers read',
    'Canonical teachers create',
    'Canonical teachers update',
    'Canonical teachers delete',
  ]) {
    assertStringIncludes(hardening, policyName)
  }
  assertStringIncludes(hardening, 'Teaching enrollments create')
  assert(!hardening.includes('FOR ALL TO authenticated'))
})

Deno.test('historical migration versions are preserved', async () => {
  const names = []
  for await (const entry of Deno.readDir(migrationDir)) {
    if (entry.isFile && entry.name.endsWith('.sql')) names.push(entry.name)
  }
  names.sort()
  for (const version of ['1000001', '1000002', '1000003', '1000041', '1000042', '1000043', '1000044', '1000046', '1000048']) {
    assert(names.some((name) => name.startsWith(version)), `missing migration ${version}`)
  }
  assert(names.includes('1000041a_has_api_permission_compatibility.sql'))
  assert(names.indexOf('1000041a_has_api_permission_compatibility.sql') < names.indexOf('1000042_api_rbac_rest_foundation.sql'))
  assertStringIncludes(compatibility, 'public.has_api_permission(uuid,text,uuid,uuid)')
  assertStringIncludes(compatibility, 'SELECT false;')
  assert(!names.some((name) => name.startsWith('1000010')))
  assert(!names.some((name) => name.startsWith('1000015')))
  assert(!names.some((name) => name.startsWith('1000016')))
})


Deno.test('1000048 resolves student scope through course fallback', () => {
  assertStringIncludes(studentScope, 'CREATE OR REPLACE FUNCTION public.can_access_student')
  assertStringIncludes(studentScope, 'COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id)')
  assertStringIncludes(studentScope, 'RAISE EXCEPTION ''1000048 prerequisites missing')
  assertStringIncludes(studentScope, 'GRANT EXECUTE ON FUNCTION public.can_access_student(uuid, text) TO authenticated, service_role')
})

Deno.test('1000046 uses a service-role-only shared rate limit store', () => {
  assertStringIncludes(rateLimit, 'CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets')
  assertStringIncludes(rateLimit, 'CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(')
  assertStringIncludes(rateLimit, 'p_bucket_key text')
  assertStringIncludes(rateLimit, 'p_limit integer')
  assertStringIncludes(rateLimit, 'p_window_seconds integer')
  assertStringIncludes(rateLimit, 'ON CONFLICT (bucket_key) DO UPDATE')
  assertStringIncludes(rateLimit, 'GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role')
})

Deno.test('upgrade fixture satisfies the teachers email contract', () => {
  assertStringIncludes(upgradeFixture, 'INSERT INTO public.teachers(id, name, user_id, email)')
  assertStringIncludes(upgradeFixture, 'teacher-b@example.test')
})
