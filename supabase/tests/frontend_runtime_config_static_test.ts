import { assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const entrypoint = await Deno.readTextFile(new URL('../../app/nginx/docker-entrypoint.d/05-edulog-runtime.envsh', import.meta.url))
const runtimeConfig = await Deno.readTextFile(new URL('../../app/src/lib/runtimeConfig.ts', import.meta.url))
const appTypes = await Deno.readTextFile(new URL('../../app/src/env.d.ts', import.meta.url))

Deno.test('container runtime config exposes same-origin API rollout settings only', () => {
  for (const key of ['VITE_LEGACY_API_BASE_URL', 'VITE_API_V1_MODE']) {
    assertStringIncludes(entrypoint, key)
    assertStringIncludes(runtimeConfig, key)
    assertStringIncludes(appTypes, key)
  }
  assertStringIncludes(entrypoint, 'VITE_API_V1_MODE:-mock')
  for (const secretKey of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_FUNCTIONS_BASE_URL']) {
    if (entrypoint.includes(secretKey) || runtimeConfig.includes(secretKey) || appTypes.includes(secretKey)) {
      throw new Error(`Browser runtime must not expose ${secretKey}`)
    }
  }
})
