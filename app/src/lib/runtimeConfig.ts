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

/**
 * Nginx injects window.__EDULOG_CONFIG__ for the production container.
 * Vite dev/preview does not load that script, so the build-time Vite value is
 * the fallback.  A runtime value wins only when it is non-empty: the container
 * writes "" for unset keys, and an empty value means unset everywhere.  Only
 * public routing/mode values live here, never Supabase credentials.
 */
export function getRuntimeConfigValue(key: RuntimeConfigKey): string {
  const runtime = typeof window === 'undefined' ? {} : (window.__EDULOG_CONFIG__ ?? {})
  return normalizeConfigValue(runtime[key]) ?? normalizeConfigValue(import.meta.env[key]) ?? ''
}

export const DEFAULT_LEGACY_API_BASE_URL = '/api'

/** Base URL for `legacy` API mode. */
export function getLegacyApiBaseUrl(): string {
  return getRuntimeConfigValue('VITE_LEGACY_API_BASE_URL') || DEFAULT_LEGACY_API_BASE_URL
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
