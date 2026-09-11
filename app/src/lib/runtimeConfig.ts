export interface EduLogRuntimeConfig {
  VITE_LEGACY_API_BASE_URL?: string
  VITE_API_V1_MODE?: 'mock' | 'legacy' | 'v1'
  /** Deprecated compatibility values; production runtime must leave these unset. */
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

export type RuntimeConfigKey = keyof EduLogRuntimeConfig

function normalizeConfigValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readRuntimeConfig(): EduLogRuntimeConfig {
  if (typeof window === 'undefined') return {}
  return window.__EDULOG_CONFIG__ ?? {}
}

export function getRuntimeConfigValue(key: RuntimeConfigKey): string {
  return normalizeConfigValue(readRuntimeConfig()[key]) ?? ''
}

/**
 * Compatibility accessor for modules that are still being migrated away from
 * browser Supabase access. It intentionally reads only runtime config and
 * never exposes service-role credentials.
 */
export function getSupabaseRuntimeConfig() {
  return {
    supabaseUrl: getRuntimeConfigValue('VITE_SUPABASE_URL'),
    supabaseAnonKey: getRuntimeConfigValue('VITE_SUPABASE_ANON_KEY'),
  }
}
