import { z } from 'zod'

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
