import { assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const migration = await Deno.readTextFile(new URL('../migrations/1000110_teaching_role_sources_and_enrollment_visibility.sql', import.meta.url))
const qualificationFix = await Deno.readTextFile(new URL('../migrations/1000111_qualify_effective_teaching_role_columns.sql', import.meta.url))
const rbacRouter = await Deno.readTextFile(new URL('../../server/src/routes/rest/rbacRouter.ts', import.meta.url))

Deno.test('teacher assignments create reversible source-scoped teaching grants', () => {
  assertStringIncludes(migration, 'class_session_teacher_role_grants')
  assertStringIncludes(migration, 'AFTER INSERT OR UPDATE OR DELETE ON public.class_session_teachers')
  assertStringIncludes(migration, 'teaching.roles.manage')
  assertStringIncludes(migration, 'ON CONFLICT (teacher_assignment_id) DO UPDATE')
  assertStringIncludes(migration, 'AFTER UPDATE OF auth_user_id ON public.profiles')
  assertStringIncludes(migration, 'AFTER UPDATE OF profile_id ON public.teacher_records')
  assertStringIncludes(migration, 'CREATE OR REPLACE FUNCTION public.resolve_teaching_permission')
  assertStringIncludes(migration, "'teaching_assignment'")
})

Deno.test('effective-role query uses the same scope hierarchy and enrollment reads use student readability', () => {
  assertStringIncludes(migration, 'public.get_effective_teaching_roles')
  assertStringIncludes(migration, 'user_role_assignment_exclusions')
  assertStringIncludes(migration, "THEN 'teaching.students.read' ELSE p_permission_key END")
  assertStringIncludes(migration, 'public.has_teaching_permission(auth.uid(), p_permission_key')
})

Deno.test('effective-role repair qualifies output-column collisions and logs only safe RPC diagnostics', () => {
  assertStringIncludes(qualificationFix, 'PARTITION BY directives.role_id')
  assert(!/PARTITION BY\s+role_id\b/.test(qualificationFix))
  assertStringIncludes(qualificationFix, 'REVOKE ALL ON FUNCTION public.get_effective_teaching_roles')
  assertStringIncludes(rbacRouter, "event: 'effective_teaching_roles_query_failed'")
  assertStringIncludes(rbacRouter, 'database_error_code: result.error.code')
  assert(!/effective_teaching_roles_query_failed[\s\S]{0,400}result\.error\.message/.test(rbacRouter))
})
