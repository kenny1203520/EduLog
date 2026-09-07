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
