import { afterEach, describe, expect, it } from 'vitest'
import { getRuntimeConfigValue } from '@/lib/runtimeConfig'

describe('runtime config', () => {
  afterEach(() => { delete window.__EDULOG_CONFIG__ })
  it('reads API mode from container runtime config', () => {
    window.__EDULOG_CONFIG__ = { VITE_API_V1_MODE: 'v1' }
    expect(getRuntimeConfigValue('VITE_API_V1_MODE')).toBe('v1')
  })
})