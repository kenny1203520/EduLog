declare const __APP_VERSION__: string

interface Window {
  __EDULOG_CONFIG__?: {
    VITE_SUPABASE_URL?: string
    VITE_SUPABASE_ANON_KEY?: string
    VITE_SUPABASE_FUNCTIONS_BASE_URL?: string
  }
}
