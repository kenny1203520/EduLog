import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRuntimeConfigValue, getSupabaseRuntimeConfig } from '@/lib/runtimeConfig'

describe('runtime config', () => {
  afterEach(() => {
    delete window.__EDULOG_CONFIG__
    vi.unstubAllEnvs()
  })

  it('prefers container runtime config over Vite env values', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://build-time.example.test')
    window.__EDULOG_CONFIG__ = {
      VITE_SUPABASE_URL: 'https://runtime.example.test'
    }

    expect(getRuntimeConfigValue('VITE_SUPABASE_URL')).toBe('https://runtime.example.test')
  })

  it('falls back to Vite env values for local development', () => {
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'build-time-anon-key')

    expect(getRuntimeConfigValue('VITE_SUPABASE_ANON_KEY')).toBe('build-time-anon-key')
  })

  it('returns normalized Supabase client settings', () => {
    window.__EDULOG_CONFIG__ = {
      VITE_SUPABASE_URL: ' https://runtime.example.test ',
      VITE_SUPABASE_ANON_KEY: ' runtime-anon-key '
    }

    expect(getSupabaseRuntimeConfig()).toEqual({
      supabaseUrl: 'https://runtime.example.test',
      supabaseAnonKey: 'runtime-anon-key'
    })
  })
})
