declare const __APP_VERSION__: string

interface Window {
  __EDULOG_CONFIG__?: {
    VITE_LEGACY_API_BASE_URL?: string
    VITE_API_V1_MODE?: 'mock' | 'legacy' | 'v1'
    VITE_SUPABASE_URL?: string
    VITE_SUPABASE_ANON_KEY?: string
  }
}
