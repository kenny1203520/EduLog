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

export type ApiMode = NonNullable<EduLogRuntimeConfig['VITE_API_V1_MODE']>
const API_MODES: readonly ApiMode[] = ['mock', 'legacy', 'v1']
let resolvedApiMode: ApiMode | undefined

/**
 * The API mode for this page load, resolved once: runtime config, then the
 * build-time value, then `v1` for production builds and `mock` otherwise.
 * An unknown value is reported and replaced by that default instead of
 * silently switching the app to mock data.
 */
export function getApiMode(): ApiMode {
  if (resolvedApiMode) return resolvedApiMode
  const fallback: ApiMode = import.meta.env.PROD ? 'v1' : 'mock'
  const configured = getRuntimeConfigValue('VITE_API_V1_MODE')
  if (configured && !API_MODES.includes(configured as ApiMode)) {
    console.warn(`[EduLog] Unknown VITE_API_V1_MODE "${configured}"; using "${fallback}".`)
  }
  resolvedApiMode = API_MODES.includes(configured as ApiMode) ? configured as ApiMode : fallback
  return resolvedApiMode
}

/** Clears the memoized API mode so a spec can change `window.__EDULOG_CONFIG__`. */
export function resetRuntimeConfigForTests() {
  resolvedApiMode = undefined
}
