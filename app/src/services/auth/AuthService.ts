import { apiV1Client } from '@/services/api/ApiV1Client'

export type BffUser = { id: string; email?: string | null; full_name?: string | null; nickname?: string | null; display_name?: string | null; user_metadata?: { full_name?: string; [key: string]: unknown }; [key: string]: unknown }
export type BffSession = { user: BffUser }
type AuthResult = { user: BffUser | null; session: BffSession | null; error: Error | null }
type AuthSubscription = { data: { subscription: { unsubscribe: () => void } } }
export class AuthService {
  private static instance: AuthService
  private constructor() {}
  public static getInstance() { if (!AuthService.instance) AuthService.instance = new AuthService(); return AuthService.instance }
  async login(email: string, password: string): Promise<AuthResult> {
    try {
      const result = await apiV1Client.post<BffUser>('/auth/login', { email, password })
      return { user: result.data ?? null, session: result.data ? { user: result.data } : null, error: null }
    } catch (error) { return { user: null, session: null, error: error instanceof Error ? error : new Error('Authentication request failed') } }
  }
  async refresh(): Promise<AuthResult> {
    try {
      const result = await apiV1Client.post<BffUser>('/auth/refresh', {})
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
      return { session: result.data ? { user: result.data } : null, error: null }
    } catch (error) {
      const authError = error instanceof Error ? error : new Error('Authentication request failed')
      return { session: null, error: (error as { code?: string })?.code === 'AUTH_REQUIRED' ? null : authError }
    }
  }
  onAuthStateChange(callback: (event: string, session: BffSession | null) => void): AuthSubscription { let active = true; void this.getSession().then(({ session }) => { if (active) callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session) }); return { data: { subscription: { unsubscribe: () => { active = false } } } } }
}
export const authService = AuthService.getInstance()
