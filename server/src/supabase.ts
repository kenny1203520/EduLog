import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { ApiConfig } from './config.js'

export type SupabaseClients = {
  publicClient: SupabaseClient
  adminClient: SupabaseClient
}

export function createSupabaseClients(config: ApiConfig): SupabaseClients {
  const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  return {
    publicClient: createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, options),
    adminClient: createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, options),
  }
}

export function createUserClient(config: ApiConfig, accessToken: string): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

export async function validateAccessToken(adminClient: SupabaseClient, accessToken: string): Promise<User> {
  const { data, error } = await adminClient.auth.getUser(accessToken)
  if (error || !data.user) throw new Error('AUTH_INVALID')
  return data.user
}

export async function signIn(publicClient: SupabaseClient, email: string, password: string): Promise<{ user: User; session: Session }> {
  const { data, error } = await publicClient.auth.signInWithPassword({ email, password })
  if (error || !data.user || !data.session) throw new Error('AUTH_INVALID')
  return { user: data.user, session: data.session }
}

export async function refresh(publicClient: SupabaseClient, refreshToken: string): Promise<{ user: User; session: Session }> {
  const { data, error } = await publicClient.auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data.user || !data.session) throw new Error('AUTH_INVALID')
  return { user: data.user, session: data.session }
}

export function safeUser(user: User) {
  return { id: user.id, email: user.email ?? null, role: user.role ?? null, created_at: user.created_at, user_metadata: user.user_metadata ?? {} }
}
