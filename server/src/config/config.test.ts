import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { insecureProductionSettings, isSupabaseDemoKey, loadConfig } from './config.js'

const requiredEnv = {
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  COOKIE_SECRET: 'a'.repeat(32),
  API_ALLOWED_ORIGINS: 'https://edulog.example.test',
}

describe('EduLog web base URL configuration', () => {
  it('requires an explicit browser-facing frontend URL', () => {
    expect(() => loadConfig({ ...requiredEnv, NODE_ENV: 'test' }))
      .toThrow(/Invalid API configuration: EDULOG_WEB_BASE_URL/)
  })

  it('accepts a user-configured localhost port', () => {
    expect(loadConfig({ ...requiredEnv, NODE_ENV: 'test', EDULOG_WEB_BASE_URL: 'http://localhost:7183' }).EDULOG_WEB_BASE_URL)
      .toBe('http://localhost:7183')
  })

  it('accepts an explicit HTTPS frontend origin in production', () => {
    expect(loadConfig({ ...requiredEnv, NODE_ENV: 'production', RATE_LIMIT_STORE: 'supabase', COOKIE_SECURE: 'true', EDULOG_WEB_BASE_URL: 'https://edulog.example.test' }).EDULOG_WEB_BASE_URL)
      .toBe('https://edulog.example.test')
  })

  it('rejects a non-local HTTP frontend URL', () => {
    expect(() => loadConfig({ ...requiredEnv, NODE_ENV: 'test', EDULOG_WEB_BASE_URL: 'http://edulog.example.test' }))
      .toThrow(/Invalid API configuration: EDULOG_WEB_BASE_URL/)
  })

  it('rejects explicit HTTP frontend URLs in production', () => {
    expect(() => loadConfig({ ...requiredEnv, NODE_ENV: 'production', RATE_LIMIT_STORE: 'supabase', COOKIE_SECURE: 'true', EDULOG_WEB_BASE_URL: 'http://edulog.example.test' }))
      .toThrow(/Invalid API configuration: EDULOG_WEB_BASE_URL/)
  })

  it('rejects a missing frontend URL in production', () => {
    expect(() => loadConfig({ ...requiredEnv, NODE_ENV: 'production', RATE_LIMIT_STORE: 'supabase', COOKIE_SECURE: 'true' }))
      .toThrow(/Invalid API configuration: EDULOG_WEB_BASE_URL/)
  })

  it('rejects malformed frontend URLs', () => {
    expect(() => loadConfig({ ...requiredEnv, NODE_ENV: 'test', EDULOG_WEB_BASE_URL: 'not a URL' }))
      .toThrow(/Invalid API configuration: EDULOG_WEB_BASE_URL/)
  })

  it('rejects frontend URLs containing credentials, query strings, or fragments', () => {
    expect(() => loadConfig({ ...requiredEnv, NODE_ENV: 'test', EDULOG_WEB_BASE_URL: 'https://user:secret@edulog.example.test/?next=/' }))
      .toThrow(/Invalid API configuration: EDULOG_WEB_BASE_URL/)
  })
})

describe('AI configuration', () => {
  const base = { ...requiredEnv, NODE_ENV: 'test', EDULOG_WEB_BASE_URL: 'http://localhost:7183' }

  it('leaves the AI secret key and Presidio URL optional', () => {
    const config = loadConfig(base)
    expect(config.AI_SECRET_KEY).toBeUndefined()
    expect(config.PRESIDIO_ANALYZER_URL).toBeUndefined()
  })

  it('treats empty AI values from an env file as unset', () => {
    const config = loadConfig({ ...base, AI_SECRET_KEY: '', PRESIDIO_ANALYZER_URL: '' })
    expect(config.AI_SECRET_KEY).toBeUndefined()
    expect(config.PRESIDIO_ANALYZER_URL).toBeUndefined()
  })

  it('accepts a 32-byte base64 AI secret key and a Presidio URL', () => {
    const key = randomBytes(32).toString('base64')
    const config = loadConfig({ ...base, AI_SECRET_KEY: key, PRESIDIO_ANALYZER_URL: 'http://presidio-analyzer:3000' })
    expect(config.AI_SECRET_KEY).toBe(key)
    expect(config.PRESIDIO_ANALYZER_URL).toBe('http://presidio-analyzer:3000')
  })

  it('rejects AI secret keys that are not 32 bytes of base64', () => {
    for (const value of [randomBytes(16).toString('base64'), 'a'.repeat(32), randomBytes(32).toString('base64url')]) {
      expect(() => loadConfig({ ...base, AI_SECRET_KEY: value })).toThrow(/Invalid API configuration: AI_SECRET_KEY/)
    }
  })

  it('rejects a malformed Presidio URL', () => {
    expect(() => loadConfig({ ...base, PRESIDIO_ANALYZER_URL: 'presidio' })).toThrow(/Invalid API configuration: PRESIDIO_ANALYZER_URL/)
  })
})

describe('optional values', () => {
  const base = { ...requiredEnv, NODE_ENV: 'test', EDULOG_WEB_BASE_URL: 'http://localhost:7183' }

  it('treats every empty optional value from an env file as unset', () => {
    const config = loadConfig({ ...base, SUPABASE_JWT_SECRET: '', SUPABASE_JWT_ISSUER: '', SUPABASE_REALTIME_URL: '', OPENAI_SIWC_CLIENT_ID: '', OPENAI_SIWC_CLIENT_SECRET: '' })
    expect(config.SUPABASE_JWT_SECRET).toBeUndefined()
    expect(config.SUPABASE_JWT_ISSUER).toBeUndefined()
    expect(config.SUPABASE_REALTIME_URL).toBeUndefined()
    expect(config.OPENAI_SIWC_CLIENT_ID).toBeUndefined()
  })
})

describe('CORS origin configuration', () => {
  const base = { ...requiredEnv, NODE_ENV: 'test', EDULOG_WEB_BASE_URL: 'http://localhost:7183' }
  const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`

  it('parses comma-separated origins once, trimmed and de-duplicated', () => {
    const config = loadConfig({ ...base, API_ALLOWED_ORIGINS: ' https://a.example , https://b.example,https://a.example ', API_EXTENSION_ALLOWED_ORIGINS: extensionOrigin })
    expect(config.API_ALLOWED_ORIGINS).toEqual(['https://a.example', 'https://b.example'])
    expect(config.API_EXTENSION_ALLOWED_ORIGINS).toEqual([extensionOrigin])
    expect(config.corsOrigins).toEqual(['https://a.example', 'https://b.example', extensionOrigin])
  })

  it('allows the local Vite browser origins in development without an allowlist', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development', API_ALLOWED_ORIGINS: '' }).corsOrigins).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://[::1]:5173',
    ])
  })

  it('rejects wildcard origins instead of combining them with credentials', () => {
    expect(() => loadConfig({ ...base, API_ALLOWED_ORIGINS: '*' })).toThrow(/API_ALLOWED_ORIGINS \(API_ALLOWED_ORIGINS cannot contain wildcard/)
  })

  it('rejects origins with a path', () => {
    expect(() => loadConfig({ ...base, API_ALLOWED_ORIGINS: 'https://a.example/' })).toThrow(/exact origins/)
  })

  it('accepts only exact Chrome extension origins', () => {
    expect(() => loadConfig({ ...base, API_EXTENSION_ALLOWED_ORIGINS: 'chrome-extension://*' })).toThrow(/exact Chrome extension origins/)
  })

  it('fails at startup when production has no explicit origin allowlist', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', RATE_LIMIT_STORE: 'supabase', COOKIE_SECURE: 'true', EDULOG_WEB_BASE_URL: 'https://edulog.example.test', API_ALLOWED_ORIGINS: '' }))
      .toThrow(/explicit API_ALLOWED_ORIGINS/)
  })
})

describe('production refuses example secrets', () => {
  const demoJwt = (role: string) => ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', Buffer.from(JSON.stringify({ role, iss: 'supabase-demo', iat: 1641769200, exp: 1799535600 })).toString('base64url'), 'signature'].join('.')
  const production = { ...requiredEnv, NODE_ENV: 'production', RATE_LIMIT_STORE: 'supabase', EDULOG_WEB_BASE_URL: 'https://edulog.example.test', COOKIE_SECURE: 'true' }

  it('starts with project-specific secrets and secure cookies', () => {
    expect(() => loadConfig(production)).not.toThrow()
  })
  it.each([
    ['the demo anon key', { SUPABASE_ANON_KEY: demoJwt('anon') }, 'SUPABASE_ANON_KEY'],
    ['the demo service-role key', { SUPABASE_SERVICE_ROLE_KEY: demoJwt('service_role') }, 'SUPABASE_SERVICE_ROLE_KEY'],
    ['the example JWT secret', { SUPABASE_JWT_SECRET: 'your-super-secret-jwt-token-with-at-least-32-characters-long' }, 'SUPABASE_JWT_SECRET'],
    ['the example Realtime key', { REALTIME_DB_ENC_KEY: 'supabaserealtime' }, 'REALTIME_DB_ENC_KEY'],
    ['insecure cookies', { COOKIE_SECURE: 'false' }, 'COOKIE_SECURE'],
  ])('refuses %s', (_label, override, name) => {
    expect(() => loadConfig({ ...production, ...override })).toThrow(new RegExp(`Production refuses insecure settings: .*${name}`))
  })
  it('refuses COOKIE_SECURE left unset in production', () => {
    const { COOKIE_SECURE: _secure, ...unset } = production
    expect(() => loadConfig(unset)).toThrow(/COOKIE_SECURE must be true/)
  })
  it('never echoes secret values', () => {
    try { loadConfig({ ...production, SUPABASE_SERVICE_ROLE_KEY: demoJwt('service_role') }) } catch (error) {
      expect(String(error)).not.toContain('supabase-demo')
      expect(String(error)).not.toContain('eyJ')
    }
  })
  it('allows the local demo stack outside production', () => {
    expect(() => loadConfig({ ...production, NODE_ENV: 'development', SUPABASE_ANON_KEY: demoJwt('anon'), COOKIE_SECURE: 'false' })).not.toThrow()
  })
  it('recognizes only the demo issuer', () => {
    expect(isSupabaseDemoKey(demoJwt('anon'))).toBe(true)
    expect(isSupabaseDemoKey('anon-test-key')).toBe(false)
    expect(insecureProductionSettings({ SUPABASE_ANON_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y', SUPABASE_JWT_SECRET: undefined, REALTIME_DB_ENC_KEY: undefined, COOKIE_SECURE: true })).toEqual([])
  })
})
