import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const migration = await Deno.readTextFile(new URL('../migrations/1000045_missing_core_rls_hardening.sql', import.meta.url))

Deno.test('1000045 is forward-only, guarded, and rerunnable', () => {
  assertStringIncludes(migration, '1000045 prerequisites missing')
  assertStringIncludes(migration, 'public.can_access_class_session(uuid,text)')
  assertStringIncludes(migration, 'DROP POLICY IF EXISTS')
  assert(!migration.includes('FOR ALL TO authenticated'))

  for (const table of [
    'students', 'student_contacts', 'student_schools', 'student_credentials',
    'teacher_credentials', 'classroom_schedules', 'student_suspensions',
  ]) {
    for (const action of ['read', 'create', 'update', 'delete']) {
      assertStringIncludes(migration, `Canonical ${table.replaceAll('_', ' ')} ${action}`)
    }
  }
})

Deno.test('1000045 uses scalar auth initplans for sensitive ownership checks', () => {
  const rewriteCount = (migration.match(/\(select auth\.uid\(\)\)/g) ?? []).length
  assert(rewriteCount >= 12, `expected ownership initplans, found ${rewriteCount}`)
  assertStringIncludes(migration, 'teacher_credentials.teacher_id')
  assertStringIncludes(migration, 'public.can_access_enrollment')
})
