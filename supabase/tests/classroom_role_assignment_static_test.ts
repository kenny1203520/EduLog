import { assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const migration = await Deno.readTextFile(new URL('../migrations/1000095_classroom_teaching_role_assignments.sql', import.meta.url))

Deno.test('classroom role assignment migration enforces scoped authorization and overlap safety', () => {
  assertStringIncludes(migration, "NEW.scope_type <> 'classroom'")
  assertStringIncludes(migration, "existing.scope_id = NEW.scope_id")
  assertStringIncludes(migration, "existing.user_id = NEW.user_id")
  assertStringIncludes(migration, "existing.role_id = NEW.role_id")
  assertStringIncludes(migration, 'CLASSROOM_ROLE_ASSIGNMENT_OVERLAP')
  assertStringIncludes(migration, "'teaching.roles.manage'")
  assertStringIncludes(migration, "'system.users.list'")
  assertStringIncludes(migration, "v_role.domain <> 'teaching'")
  assertStringIncludes(migration, "'classroom', p_classroom_id")
})
