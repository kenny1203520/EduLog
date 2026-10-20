import { z } from 'zod'
import { decodeSecretKey } from '../ai/credentials/secretCipher.js'

/** Treats an empty environment value (e.g. `KEY=` in an env file) as unset. */
const emptyAsUnset = (value: unknown) => value === '' ? undefined : value

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
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Optional for external Supabase projects.  Self-hosted Compose supplies
  // the same server-only JWT secret used by GoTrue so access tokens can be
  // checked locally before the account-existence validation.
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  SUPABASE_JWT_ISSUER: z.url().optional(),
  SUPABASE_REALTIME_URL: z.url().optional(),
  COOKIE_SECRET: z.string().min(32),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  RATE_LIMIT_STORE: z.enum(['supabase', 'memory']).default('supabase'),
  API_BODY_LIMIT: z.string().default('1mb'),
  API_ALLOWED_ORIGINS: z.string().default(''),
  API_EXTENSION_ALLOWED_ORIGINS: z.string().default(''),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  // AES-256-GCM key for AI provider credentials stored in ai_credentials:
  // 32 random bytes, base64 (`openssl rand -base64 32`). Optional so existing
  // deployments boot; AI credential storage stays unavailable until it is set.
  AI_SECRET_KEY: z.preprocess(emptyAsUnset, z.string().refine((value) => decodeSecretKey(value) !== null, {
    message: 'AI_SECRET_KEY must be 32 bytes encoded as base64',
  }).optional()),
  // Presidio analyzer REST endpoint used to de-identify AI prompts.
  PRESIDIO_ANALYZER_URL: z.preprocess(emptyAsUnset, z.url().optional()),
})

export type ApiConfig = z.infer<typeof ConfigSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.path.join('.') || 'environment').join(', ')
    throw new Error(`Invalid API configuration: ${details}`)
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.RATE_LIMIT_STORE !== 'supabase') {
    throw new Error('Production requires RATE_LIMIT_STORE=supabase')
  }
  if (parsed.data.NODE_ENV === 'production' && new URL(parsed.data.EDULOG_WEB_BASE_URL).protocol !== 'https:') {
    throw new Error('Production requires EDULOG_WEB_BASE_URL to use HTTPS')
  }
  return parsed.data
}
