import { assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const sharedApi = await Deno.readTextFile(new URL('../volumes/functions/_shared/api.ts', import.meta.url))
const resources = await Deno.readTextFile(new URL('../volumes/functions/api-v1/controllers/resourceController.ts', import.meta.url))
const members = await Deno.readTextFile(new URL('../volumes/functions/api-v1/controllers/teachingMembersController.ts', import.meta.url))

Deno.test('scoped routes use canonical teaching permission evaluation', () => {
  assertStringIncludes(sharedApi, "ctx.db.rpc('has_teaching_permission'")
  assertStringIncludes(sharedApi, 'teachingId?: string | null')
  assertStringIncludes(members, "requirePermission(ctx, 'teaching.members.manage', null, null, teachingId)")
  assertStringIncludes(resources, 'requireResourcePermission')
  assertStringIncludes(resources, 'const teachingId = definition.table === \'teachings\'')
})
