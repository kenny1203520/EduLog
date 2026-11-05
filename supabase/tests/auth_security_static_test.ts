import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const apiSource = await Deno.readTextFile(new URL('../volumes/functions/_shared/api.ts', import.meta.url))
const envSource = await Deno.readTextFile(new URL('../volumes/functions/_shared/env.ts', import.meta.url))
const mainSource = await Deno.readTextFile(new URL('../volumes/functions/main/index.ts', import.meta.url))

Deno.test('authentication is fail-closed and uses the user JWT for RLS queries', () => {
  assertStringIncludes(apiSource, "if (!token) throw new ApiError(401, 'AUTH_REQUIRED'")
  assertStringIncludes(apiSource, 'adminDb.auth.getUser(token)')
  assertStringIncludes(apiSource, "Authorization: 'Bearer ' + token")
  assertStringIncludes(apiSource, "'AUTH_INVALID'")
  assertStringIncludes(envSource, "read('SUPABASE_SERVICE_ROLE_KEY')")
  assertStringIncludes(envSource, "read('SUPABASE_ANON_KEY')")
})

Deno.test('edge env is read in one module and fails closed', () => {
  assert(!apiSource.includes('Deno.env'), '_shared/api.ts must read configuration through _shared/env.ts')
  assertStringIncludes(envSource, "read('ENVIRONMENT') === 'development' ? 'development' : 'production'")
})

Deno.test('the main router forwards only allowlisted env vars to user workers', () => {
  assert(!mainSource.includes('Deno.env'), 'main/index.ts must read configuration through _shared/env.ts')
  assertStringIncludes(mainSource, 'workerEnvVars()')
  const workerKeys = envSource.match(/export const WORKER_ENV_KEYS = \[([^\]]*)\]/)?.[1]
  assert(workerKeys, 'WORKER_ENV_KEYS must be a literal array')
  for (const secret of ['JWT_SECRET', 'VERIFY_JWT', 'SUPABASE_DB_URL', 'POSTGRES_PASSWORD', 'SUPABASE_SECRET_KEYS']) {
    assert(!workerKeys.includes(`'${secret}'`), `${secret} must not be forwarded to user workers`)
  }
  for (const secret of ['SUPABASE_DB_URL', 'POSTGRES_PASSWORD', 'SUPABASE_SECRET_KEYS']) {
    assert(!envSource.includes(`'${secret}'`), `${secret} must not be read by EduLog edge code`)
  }
})

Deno.test('security middleware exposes shared rate-limit and telemetry adapters', () => {
  assertStringIncludes(apiSource, 'export interface RateLimitStore')
  assertStringIncludes(apiSource, 'configureRateLimitStore')
  assertStringIncludes(apiSource, 'OtlpTelemetryExporter')
  assertStringIncludes(apiSource, 'traceparent')
  assert(apiSource.includes('console.log(JSON.stringify({ type: \'api_telemetry\''))
  assert(!apiSource.includes('console.log(token)'))
})
