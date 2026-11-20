import { apiV1Client, registerApiAuthRecovery } from '@/services/api/ApiV1Client'

export type BffUser = { id: string; email?: string | null; account_status?: 'active' | 'pending'; full_name?: string | null; nickname?: string | null; display_name?: string | null; user_metadata?: { full_name?: string; [key: string]: unknown }; [key: string]: unknown }
export type BffSession = { user: BffUser }
type AuthResult = { user: BffUser | null; session: BffSession | null; error: Error | null }
/** Idle sign-out after this long without interaction; the server's value replaces it once known. */
let idleTimeoutMs = 8 * 60 * 60 * 1000
/** The idle timeout the server enforces on session refresh. */
export function sessionIdleTimeoutMs() { return idleTimeoutMs }
function acceptSessionMeta(meta: unknown) {
    const seconds = (meta as { session?: { idle_timeout_seconds?: unknown } } | null | undefined)?.session?.idle_timeout_seconds
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 600) idleTimeoutMs = seconds * 1000
}
type AuthSubscription = { data: { subscription: { unsubscribe: () => void } } }
export class AuthService {
  private static instance: AuthService
  public static getInstance() { if (!AuthService.instance) AuthService.instance = new AuthService(); return AuthService.instance }
  private constructor() {
    registerApiAuthRecovery(async () => {
      const result = await this.refresh()
      return result.error || !result.user ? null : result.user
    })
  }
  async login(email: string, password: string): Promise<AuthResult> {
    try {
      const result = await apiV1Client.post<BffUser>('/auth/login', { email, password })
      acceptSessionMeta(result.meta)
      return { user: result.data ?? null, session: result.data ? { user: result.data } : null, error: null }
    } catch (error) { return { user: null, session: null, error: error instanceof Error ? error : new Error('Authentication request failed') } }
  }
  async refresh(): Promise<AuthResult> {
    try {
      const result = await apiV1Client.post<BffUser>('/auth/refresh', {})
      acceptSessionMeta(result.meta)
      return { user: result.data ?? null, session: result.data ? { user: result.data } : null, error: null }
    } catch (error) { return { user: null, session: null, error: error instanceof Error ? error : new Error('Authentication request failed') } }
  }
  async logout(): Promise<{ error: Error | null }> {
    try { await apiV1Client.post('/auth/logout', {}); return { error: null } }
    catch (error) { return { error: error instanceof Error ? error : new Error('Authentication request failed') } }
  }
  async getSession(): Promise<{ session: BffSession | null; error: Error | null }> {
    try {
      const result = await apiV1Client.get<BffUser>('/auth/me')
      acceptSessionMeta(result.meta)
      return { session: result.data ? { user: result.data } : null, error: null }
    } catch (error) {
      const authError = error instanceof Error ? error : new Error('Authentication request failed')
      return { session: null, error: (error as { code?: string })?.code === 'AUTH_REQUIRED' ? null : authError }
    }
  }
  /** OAuth providers GoTrue has enabled. An outage is distinct from an empty list. */
  async oauthProviders(): Promise<string[]> {
    const result = await apiV1Client.get<{ providers: string[] }>('/auth/providers')
    return result.data.providers
  }
  async identities() {
    return (await apiV1Client.get<{ identities: Array<{ id: string; provider: string }>; providers: string[]; manual_linking: boolean }>('/auth/me/identities')).data
  }
  async linkIdentity(provider: string) {
    return (await apiV1Client.post<{ url: string }>('/auth/me/identities/link', { provider })).data.url
  }
  async unlinkIdentity(id: string, currentPassword: string) {
    await apiV1Client.post(`/auth/me/identities/${encodeURIComponent(id)}/unlink`, { current_password: currentPassword })
  }
  /** Ask for a password-reset email. The server answers the same whether or not the account exists. */
  async requestPasswordReset(email: string): Promise<void> {
    await apiV1Client.post('/auth/recover', { email })
  }
  /** Set a password after following an invite or reset link. */
  async setPassword(newPassword: string, confirmPassword: string): Promise<void> {
    await apiV1Client.post('/auth/set-password', { new_password: newPassword, confirm_password: confirmPassword })
  }
  onAuthStateChange(callback: (event: string, session: BffSession | null) => void): AuthSubscription { let active = true; void this.getSession().then(({ session }) => { if (active) callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session) }); return { data: { subscription: { unsubscribe: () => { active = false } } } } }
}
export const authService = AuthService.getInstance()
