import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const source = await Deno.readTextFile(new URL('../volumes/functions/main/index.ts', import.meta.url))

Deno.test('legacy adapter emits safe successor metadata and errors', () => {
  assertStringIncludes(source, "legacyHeaders.set('Deprecation', 'true')")
  assertStringIncludes(source, "rel=\"successor-version\"")
  assertStringIncludes(source, "'LEGACY_FUNCTION_ERROR'")
  assert(!source.includes('e.toString()'))
  assert(!source.includes("JSON.stringify({ msg:"))
})
