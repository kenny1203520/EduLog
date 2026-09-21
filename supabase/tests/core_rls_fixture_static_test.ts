import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const source = (await Deno.readTextFile(
  new URL('./core_rls_security.sql', import.meta.url),
)).replaceAll('\r\n', '\n')

Deno.test('cross-teaching fixture stays outside PL/pgSQL blocks', () => {
  const fixture = source.indexOf('-- Exercise the teaching resolver against rows owned by learners')
  const helper = source.indexOf("IF to_regprocedure('public.can_access_student(uuid,text)') IS NULL")
  assert(fixture > 0)
  assert(helper > fixture)

  const fixtureSection = source.slice(fixture, helper)
  assert(!fixtureSection.includes('DO $$\nBEGIN\n-- Exercise the teaching resolver'))
  assertStringIncludes(fixtureSection, 'INSERT INTO public.teachings')
  assertStringIncludes(fixtureSection, 'INSERT INTO public.student_credentials')
  assertStringIncludes(fixtureSection, 'cross-teaching sensitive-data leak detected')
  assertStringIncludes(source.slice(helper - 20, helper + 240), 'DO $$\nBEGIN')
})

Deno.test('RBAC fixture uses domain-scoped role identities', () => {
  assertStringIncludes(source, 'domain, teaching_id, is_builtin, is_protected')
  assertStringIncludes(source, "ON CONFLICT (domain, code) DO NOTHING")
  assertStringIncludes(source, "'rls_system_admin', 'RLS system admin'")
  assertStringIncludes(source, "'rls_scoped_manager', 'RLS scoped manager'")
})

Deno.test('role fixtures target the domain-scoped uniqueness index', () => {
  const roleCodeTargets = source.match(/ON CONFLICT \(domain, code\) DO NOTHING;/g) ?? []
  assert(roleCodeTargets.length >= 2)
  assert(!/ON CONFLICT \(code\) DO NOTHING;/.test(source))
})
