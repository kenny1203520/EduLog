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
  if (typeof window === 'undefined') return {}
  return window.__EDULOG_CONFIG__ ?? {}
}

export function getRuntimeConfigValue(key: RuntimeConfigKey): string {
  return normalizeConfigValue(readRuntimeConfig()[key]) ?? ''
}
