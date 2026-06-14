export interface EduLogRuntimeConfig {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_FUNCTIONS_BASE_URL?: string
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
  return normalizeConfigValue(readRuntimeConfig()[key]) ?? normalizeConfigValue(import.meta.env[key]) ?? ''
}

export function getSupabaseRuntimeConfig(): { supabaseUrl: string, supabaseAnonKey: string } {
  return {
    supabaseUrl: getRuntimeConfigValue('VITE_SUPABASE_URL'),
    supabaseAnonKey: getRuntimeConfigValue('VITE_SUPABASE_ANON_KEY')
  }
}
