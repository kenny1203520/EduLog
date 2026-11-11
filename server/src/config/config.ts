import { z } from 'zod'
import { decodeSecretKey } from '../ai/credentials/secretCipher.js'

/**
 * The single place the API reads its environment.  Everything else receives
 * the parsed `ApiConfig`; nothing outside this module (and `src/bin/*`) should
 * touch `process.env`.  The variable reference lives in
 * `docs/deployment/environment.md`.
 */

/** Treats an empty environment value (e.g. `KEY=` in an env file) as unset. */
const emptyAsUnset = (value: unknown) => value === '' ? undefined : value
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyAsUnset, schema.optional())

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/
const LOCAL_DEVELOPMENT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']

/** Comma-separated list → trimmed, de-duplicated array. */
const originList = (name: string, check: (origin: string) => string | null) => z.string().default('').transform((value, ctx) => {
  const origins = [...new Set(value.split(',').map((origin) => origin.trim()).filter(Boolean))]
  for (const origin of origins) {
    const problem = check(origin)
    if (problem) ctx.addIssue({ code: 'custom', message: `${name} ${problem}` })
  }
  return origins
})

const webOrigin = (origin: string) => {
  if (origin.includes('*')) return 'cannot contain wildcard origins'
  try {
    if (new URL(origin).origin !== origin) return 'must contain exact origins (scheme://host[:port])'
  } catch {
    return 'must contain exact origins (scheme://host[:port])'
  }
  return null
}
const extensionOrigin = (origin: string) => EXTENSION_ORIGIN.test(origin) ? null : 'must contain exact Chrome extension origins'

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  EDULOG_WEB_BASE_URL: z.url().superRefine((value, ctx) => {
    let url: URL
    try { url = new URL(value) } catch { return }
    const localHosts = ['localhost', '127.0.0.1', '[::1]']
    const localHttp = url.protocol === 'http:' && localHosts.includes(url.hostname)
    if (url.protocol !== 'https:' && !localHttp) {
      ctx.addIssue({ code: 'custom', message: 'EDULOG_WEB_BASE_URL must use HTTPS except for localhost development' })
    }
    if (url.username || url.password || url.search || url.hash) {
      ctx.addIssue({ code: 'custom', message: 'EDULOG_WEB_BASE_URL must not contain credentials, a query, or a fragment' })
    }
  }),
  SUPABASE_URL: z.url(),
  // Optional root URL for direct server-to-GoTrue OAuth requests; never sent to the browser.
  GOTRUE_INTERNAL_URL: optional(z.url().superRefine((value, ctx) => {
    const url = new URL(value)
    if (url.username || url.password || (url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
      ctx.addIssue({ code: 'custom', message: 'GOTRUE_INTERNAL_URL must be a root URL without credentials, a path, a query, or a fragment' })
    }
  })),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Optional for external Supabase projects.  Self-hosted Compose supplies
  // the same server-only JWT secret used by GoTrue so access tokens can be
  // checked locally before the account-existence validation.
  SUPABASE_JWT_SECRET: optional(z.string().min(32)),
  SUPABASE_JWT_ISSUER: optional(z.url()),
  // Defaults to SUPABASE_URL when unset.
  SUPABASE_REALTIME_URL: optional(z.url()),
  COOKIE_SECRET: z.string().min(32),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  RATE_LIMIT_STORE: z.enum(['supabase', 'memory']).default('supabase'),
  // Express/`bytes` syntax (e.g. `1mb`, `512kb`); the frontend nginx accepts the same value.
  API_BODY_LIMIT: z.string().default('1mb'),
  API_ALLOWED_ORIGINS: originList('API_ALLOWED_ORIGINS', webOrigin),
  API_EXTENSION_ALLOWED_ORIGINS: originList('API_EXTENSION_ALLOWED_ORIGINS', extensionOrigin),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  // AES-256-GCM key for AI provider credentials stored in ai_credentials:
  // 32 random bytes, base64 (`openssl rand -base64 32`). Optional so existing
  // deployments boot; AI credential storage stays unavailable until it is set.
  AI_SECRET_KEY: optional(z.string().refine((value) => decodeSecretKey(value) !== null, {
    message: 'AI_SECRET_KEY must be 32 bytes encoded as base64',
  })),
  // Presidio analyzer REST endpoint used to de-identify AI prompts.
  PRESIDIO_ANALYZER_URL: optional(z.url()),
  // "Sign in with ChatGPT" plan usage (teachers spend their own Plus/Pro
  // allowance). Requires an OpenAI-approved website client; the feature stays
  // hidden until OPENAI_SIWC_CLIENT_ID is set.
  OPENAI_SIWC_CLIENT_ID: optional(z.string().min(1).max(200)),
  OPENAI_SIWC_CLIENT_SECRET: optional(z.string().min(1).max(500)),
  // SMTP for the API's own mail (administrator notices about accounts
  // waiting for approval). The same server GoTrue uses; unset = no mail.
  SMTP_HOST: optional(z.string().min(1).max(255)),
  SMTP_PORT: z.preprocess(emptyAsUnset, z.coerce.number().int().positive().max(65535).default(587)),
  SMTP_USER: optional(z.string().max(320)),
  SMTP_PASS: optional(z.string().max(1024)),
  SMTP_ADMIN_EMAIL: optional(z.email()),
  SMTP_SENDER_NAME: optional(z.string().max(120)),
})

type ParsedConfig = z.infer<typeof ConfigSchema>

export type ApiConfig = ParsedConfig & {
  /** Every origin allowed to call the API with credentials (web + extension), resolved once at startup. */
  corsOrigins: string[]
}

/**
 * Resolves the browser origins allowed by CORS.  Without an explicit web
 * allowlist, development falls back to the local Vite dev server; production
 * refuses to start.
 */
export function resolveAllowedOrigins(config: Pick<ParsedConfig, 'API_ALLOWED_ORIGINS' | 'API_EXTENSION_ALLOWED_ORIGINS' | 'NODE_ENV'>): string[] {
  if (config.API_ALLOWED_ORIGINS.length) return [...new Set([...config.API_ALLOWED_ORIGINS, ...config.API_EXTENSION_ALLOWED_ORIGINS])]
  if (config.NODE_ENV === 'production') throw new Error('Production requires explicit API_ALLOWED_ORIGINS')
  return [...new Set([...LOCAL_DEVELOPMENT_ORIGINS, ...config.API_EXTENSION_ALLOWED_ORIGINS])]
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    // Messages come from the schema, never from the value, so secrets are not echoed.
    const details = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.') || 'environment'
      return issue.code === 'custom' ? `${path} (${issue.message})` : path
    }).join(', ')
    throw new Error(`Invalid API configuration: ${details}`)
  }
  const config = parsed.data
  if (config.NODE_ENV === 'production' && config.RATE_LIMIT_STORE !== 'supabase') {
    throw new Error('Production requires RATE_LIMIT_STORE=supabase')
  }
  if (config.NODE_ENV === 'production' && new URL(config.EDULOG_WEB_BASE_URL).protocol !== 'https:') {
    throw new Error('Production requires EDULOG_WEB_BASE_URL to use HTTPS')
  }
  return { ...config, corsOrigins: resolveAllowedOrigins(config) }
}
