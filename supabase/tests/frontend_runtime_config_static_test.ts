import { assert } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const entrypoint = await Deno.readTextFile(new URL('../../app/nginx/docker-entrypoint.d/05-edulog-runtime.envsh', import.meta.url))
const nginxProxy = await Deno.readTextFile(new URL('../volumes/proxy/nginx/supabase-nginx.conf.tpl', import.meta.url))
const indexHtml = await Deno.readTextFile(new URL('../../app/index.html', import.meta.url))
const appTypes = await Deno.readTextFile(new URL('../../app/src/env.d.ts', import.meta.url))

Deno.test('the browser bundle has no runtime config and no Supabase credentials', () => {
  assert(!entrypoint.includes('runtime-config.js'), 'nginx must not generate a browser runtime config')
  assert(!indexHtml.includes('runtime-config.js'), 'index.html must not load a browser runtime config')
  for (const key of ['VITE_API_V1_MODE', 'VITE_LEGACY_API_BASE_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_FUNCTIONS_BASE_URL']) {
    if (entrypoint.includes(key) || appTypes.includes(key)) {
      throw new Error(`Browser runtime must not expose ${key}`)
    }
  }
})

Deno.test('bundled nginx proxies do not log single-use email confirmation tokens', () => {
  for (const [name, config] of [['EduLog app', entrypoint], ['Supabase nginx', nginxProxy]]) {
    const block = config.match(/location = \/api\/auth\/confirm \{([^}]*)\}/)?.[1]
    assert(block, `${name} must declare an exact auth confirmation location`)
    assert(block.includes('access_log off;'), `${name} must not log the token_hash query`)
  }
})
