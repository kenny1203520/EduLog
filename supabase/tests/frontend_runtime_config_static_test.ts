import { assert } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const entrypoint = await Deno.readTextFile(new URL('../../app/nginx/docker-entrypoint.d/05-edulog-runtime.envsh', import.meta.url))
const nginxProxy = await Deno.readTextFile(new URL('../volumes/proxy/nginx/supabase-nginx.conf.tpl', import.meta.url))
const caddyProxy = await Deno.readTextFile(new URL('../volumes/proxy/caddy/Caddyfile', import.meta.url))
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
    assert(block.includes('error_log /dev/null emerg;'), `${name} must not write token-bearing proxy errors to a log`)
  }
})

Deno.test('bundled Caddy runtime logs redact single-use email confirmation tokens', () => {
  assert(caddyProxy.startsWith('{\n'), 'Caddy must put runtime logging options first')
  const globalOptions = caddyProxy.split('\n}\n', 1)[0]
  assert(globalOptions.includes('log default'), 'Caddy must filter the default runtime logger')
  assert(globalOptions.includes('output stderr'), 'Caddy must retain its runtime log destination')
  assert(globalOptions.includes('request>uri query'), 'Caddy must filter request URI query parameters')
  assert(globalOptions.includes('replace token_hash REDACTED'), 'Caddy must redact token_hash while retaining other request diagnostics')
})
