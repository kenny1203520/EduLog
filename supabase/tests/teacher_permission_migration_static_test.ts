import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const canonical = await Deno.readTextFile(
  new URL('../migrations/1000040_backend_security_reconciliation.sql', import.meta.url),
)
const start = canonical.indexOf('-- Former migration 1000047_canonical_teacher_permissions.sql')
const end = canonical.indexOf('\n-- Former migration ', start + 1)
const migration = canonical.slice(start, end < 0 ? undefined : end)

Deno.test('1000047 completes the canonical teacher permission catalogue', () => {
  assertStringIncludes(migration, "'teaching.teachers.%s'")
  for (const action of ['create', 'read', 'update', 'delete', 'list', 'manage']) {
    assertStringIncludes(migration, `'${action}'`)
  }
  assertStringIncludes(migration, "owner_role.code = 'teaching_owner'")
  assertStringIncludes(migration, "permission.key = 'teaching.teachers.list'")
  assertStringIncludes(migration, "RAISE EXCEPTION '1000047")
  assert(!migration.includes('GRANT ALL'))
})
