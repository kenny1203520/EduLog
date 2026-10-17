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
