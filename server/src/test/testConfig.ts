import { loadConfig, type ApiConfig } from '../config/config.js'

/** The minimal raw environment the API needs to boot in tests. */
export function testEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    EDULOG_WEB_BASE_URL: 'http://localhost:4173',
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_ANON_KEY: 'anon-test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
    COOKIE_SECRET: 'a'.repeat(32),
    RATE_LIMIT_STORE: 'memory',
    API_ALLOWED_ORIGINS: 'http://localhost:4173',
    ...overrides,
  }
}

/** A validated `ApiConfig` built through `loadConfig`, so tests exercise the real parsing. */
export function testConfig(overrides: NodeJS.ProcessEnv = {}): ApiConfig {
  return loadConfig(testEnv(overrides))
}
