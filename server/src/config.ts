import { z } from 'zod'

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_BASE_URL: z.url().default('http://localhost:4173'),
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_REALTIME_URL: z.url().optional(),
  COOKIE_SECRET: z.string().min(32),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  RATE_LIMIT_STORE: z.enum(['supabase', 'memory']).default('supabase'),
  API_BODY_LIMIT: z.string().default('1mb'),
  API_ALLOWED_ORIGINS: z.string().default(''),
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
  return parsed.data
}
