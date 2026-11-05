/**
 * The single place EduLog edge functions read their environment.  Values are
 * read once, on first use; request handlers use `env`, never
 * `Deno.env` directly.  Missing values stay `undefined` so callers can answer
 * with a proper API error instead of crashing the worker.
 *
 * `WORKER_ENV_KEYS` is also the allowlist the `main` router forwards to user
 * workers, so a variable a worker needs must be listed here.
 */

export const WORKER_ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'API_ALLOWED_ORIGINS',
  'ENVIRONMENT',
  'API_RATE_LIMIT_PER_MINUTE',
  'LEGACY_API_SUNSET',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
] as const

const DEFAULT_LEGACY_API_SUNSET = 'Wed, 31 Dec 2026 23:59:59 GMT'
const DEFAULT_RATE_LIMIT_PER_MINUTE = 120

function read(name: (typeof WORKER_ENV_KEYS)[number]): string | undefined {
  const value = Deno.env.get(name)?.trim()
  return value ? value : undefined
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export type EdgeEnvironment = 'development' | 'production'

function loadEnv() {
  return Object.freeze({
    supabaseUrl: read('SUPABASE_URL'),
    serviceRoleKey: read('SUPABASE_SERVICE_ROLE_KEY') ?? read('SERVICE_ROLE_KEY'),
    anonKey: read('SUPABASE_ANON_KEY') ?? read('SUPABASE_PUBLISHABLE_KEY'),
    /** Comma-separated exact origins. */
    allowedOrigins: Object.freeze((read('API_ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)),
    /** Fails closed: anything other than an explicit `development` is production. */
    environment: (read('ENVIRONMENT') === 'development' ? 'development' : 'production') as EdgeEnvironment,
    rateLimitPerMinute: positiveInt(read('API_RATE_LIMIT_PER_MINUTE'), DEFAULT_RATE_LIMIT_PER_MINUTE),
    legacyApiSunset: read('LEGACY_API_SUNSET') ?? DEFAULT_LEGACY_API_SUNSET,
    otlpEndpoints: Object.freeze({
      log: read('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'),
      span: read('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'),
      metric: read('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT'),
    }),
  })
}

type EdgeEnv = ReturnType<typeof loadEnv>
let loaded: EdgeEnv | undefined

/**
 * Read on first property access, then cached.  Importing this module touches
 * no environment, so modules that only import helpers (and their tests) need
 * no env permission.
 */
export const env: EdgeEnv = new Proxy({} as EdgeEnv, {
  get: (_target, key) => (loaded ??= loadEnv())[key as keyof EdgeEnv],
})

/** The variables `main` forwards to a user worker: only those listed above. */
export function workerEnvVars(): [string, string][] {
  return WORKER_ENV_KEYS.flatMap((key) => {
    const value = Deno.env.get(key)
    return value === undefined ? [] : [[key, value] as [string, string]]
  })
}
