import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const apiSource = await Deno.readTextFile(new URL('../volumes/functions/_shared/api.ts', import.meta.url))

Deno.test('authentication is fail-closed and uses the user JWT for RLS queries', () => {
  assertStringIncludes(apiSource, "if (!token) throw new ApiError(401, 'AUTH_REQUIRED'")
  assertStringIncludes(apiSource, 'adminDb.auth.getUser(token)')
  assertStringIncludes(apiSource, "Authorization: 'Bearer ' + token")
  assertStringIncludes(apiSource, "'AUTH_INVALID'")
  assertStringIncludes(apiSource, "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')")
  assertStringIncludes(apiSource, "Deno.env.get('SUPABASE_ANON_KEY')")
})

Deno.test('security middleware exposes shared rate-limit and telemetry adapters', () => {
  assertStringIncludes(apiSource, 'export interface RateLimitStore')
  assertStringIncludes(apiSource, 'configureRateLimitStore')
  assertStringIncludes(apiSource, 'OtlpTelemetryExporter')
  assertStringIncludes(apiSource, 'traceparent')
  assert(apiSource.includes('console.log(JSON.stringify({ type: \'api_telemetry\''))
  assert(!apiSource.includes('console.log(token)'))
})
