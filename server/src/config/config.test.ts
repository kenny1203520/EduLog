import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const requiredEnv = {
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  COOKIE_SECRET: 'a'.repeat(32),
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
    expect(loadConfig({ ...requiredEnv, NODE_ENV: 'production', RATE_LIMIT_STORE: 'supabase', EDULOG_WEB_BASE_URL: 'https://edulog.example.test' }).EDULOG_WEB_BASE_URL)
      .toBe('https://edulog.example.test')
  })

  it('rejects a non-local HTTP frontend URL', () => {
    expect(() => loadConfig({ ...requiredEnv, NODE_ENV: 'test', EDULOG_WEB_BASE_URL: 'http://edulog.example.test' }))
      .toThrow(/Invalid API configuration: EDULOG_WEB_BASE_URL/)
  })

  it('rejects explicit HTTP frontend URLs in production', () => {
    expect(() => loadConfig({ ...requiredEnv, NODE_ENV: 'production', RATE_LIMIT_STORE: 'supabase', EDULOG_WEB_BASE_URL: 'http://edulog.example.test' }))
      .toThrow(/Invalid API configuration: EDULOG_WEB_BASE_URL/)
  })

  it('rejects a missing frontend URL in production', () => {
    expect(() => loadConfig({ ...requiredEnv, NODE_ENV: 'production', RATE_LIMIT_STORE: 'supabase' }))
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
