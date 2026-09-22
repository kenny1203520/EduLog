export interface EduLogRuntimeConfig {
  VITE_LEGACY_API_BASE_URL?: string
  VITE_API_V1_MODE?: 'mock' | 'legacy' | 'v1'
}

export type RuntimeConfigKey = keyof EduLogRuntimeConfig

function normalizeConfigValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readRuntimeConfig(): EduLogRuntimeConfig {
  // Nginx injects window.__EDULOG_CONFIG__ for the production container.
  // Vite dev/preview does not load that script, so use the build-time Vite
  // values as a fallback.  Runtime injection remains authoritative and this
  // fallback exposes only public routing/mode configuration, never Supabase
  // credentials.
  const runtime = typeof window === 'undefined' ? {} : (window.__EDULOG_CONFIG__ ?? {})
  const buildTime: EduLogRuntimeConfig = import.meta.env.MODE === 'test'
    ? {}
    : {
        VITE_API_V1_MODE: import.meta.env.VITE_API_V1_MODE,
        VITE_LEGACY_API_BASE_URL: import.meta.env.VITE_LEGACY_API_BASE_URL,
      }
  return {
    VITE_API_V1_MODE: runtime.VITE_API_V1_MODE ?? buildTime.VITE_API_V1_MODE,
    VITE_LEGACY_API_BASE_URL: runtime.VITE_LEGACY_API_BASE_URL ?? buildTime.VITE_LEGACY_API_BASE_URL,
  }
}

export function getRuntimeConfigValue(key: RuntimeConfigKey): string {
  return normalizeConfigValue(readRuntimeConfig()[key]) ?? ''
}
