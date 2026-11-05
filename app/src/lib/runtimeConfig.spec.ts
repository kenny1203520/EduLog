import { afterEach, describe, expect, it, vi } from 'vitest'
import { getApiMode, getLegacyApiBaseUrl, getRuntimeConfigValue, resetRuntimeConfigForTests } from '@/lib/runtimeConfig'

describe('runtime config', () => {
  afterEach(() => { delete window.__EDULOG_CONFIG__; resetRuntimeConfigForTests(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
  it('reads API mode from container runtime config', () => {
    window.__EDULOG_CONFIG__ = { VITE_API_V1_MODE: 'v1' }
    expect(getRuntimeConfigValue('VITE_API_V1_MODE')).toBe('v1')
  })

  it('lets container runtime config override build-time values', () => {
    window.__EDULOG_CONFIG__ = { VITE_API_V1_MODE: 'legacy', VITE_LEGACY_API_BASE_URL: '/legacy-api' }
    expect(getRuntimeConfigValue('VITE_API_V1_MODE')).toBe('legacy')
    expect(getRuntimeConfigValue('VITE_LEGACY_API_BASE_URL')).toBe('/legacy-api')
  })

  it('treats an empty runtime value as unset and falls back to the build-time value', () => {
    vi.stubEnv('VITE_LEGACY_API_BASE_URL', '/built-api')
    window.__EDULOG_CONFIG__ = { VITE_LEGACY_API_BASE_URL: '' }
    expect(getLegacyApiBaseUrl()).toBe('/built-api')
  })

  it('uses /api for legacy mode when nothing is configured', () => {
    window.__EDULOG_CONFIG__ = { VITE_LEGACY_API_BASE_URL: '  ' }
    expect(getLegacyApiBaseUrl()).toBe('/api')
  })

  it('resolves the API mode once per page load', () => {
    window.__EDULOG_CONFIG__ = { VITE_API_V1_MODE: 'v1' }
    expect(getApiMode()).toBe('v1')
    window.__EDULOG_CONFIG__ = { VITE_API_V1_MODE: 'legacy' }
    expect(getApiMode()).toBe('v1')
    resetRuntimeConfigForTests()
    expect(getApiMode()).toBe('legacy')
  })

  it('defaults to mock outside production builds', () => {
    expect(getApiMode()).toBe('mock')
  })

  it('warns and falls back instead of accepting an unknown mode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.__EDULOG_CONFIG__ = { VITE_API_V1_MODE: 'V1 ' as never }
    expect(getApiMode()).toBe('mock')
    expect(warn).toHaveBeenCalledOnce()
  })
})
