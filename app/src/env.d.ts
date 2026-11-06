declare const __APP_VERSION__: string

/** The only build-time keys the app reads; see src/lib/runtimeConfig.ts. Never add secrets here. */
interface ImportMetaEnv {
  readonly VITE_API_V1_MODE?: 'mock' | 'legacy' | 'v1'
  readonly VITE_LEGACY_API_BASE_URL?: string
}

interface Window {
  __EDULOG_CONFIG__?: {
    VITE_LEGACY_API_BASE_URL?: string
    VITE_API_V1_MODE?: 'mock' | 'legacy' | 'v1'
  }
}
