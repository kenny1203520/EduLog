export type BffUser = { id: string; email?: string; user_metadata?: { full_name?: string; [key: string]: unknown }; [key: string]: unknown }
export type BffSession = { user: BffUser }
type AuthResult = { user: BffUser | null; session: BffSession | null; error: Error | null }
type AuthSubscription = { data: { subscription: { unsubscribe: () => void } } }
async function parse<T>(response: Response): Promise<{ data?: T; error?: Error }> { const body = await response.json().catch(() => null); if (!response.ok) return { error: new Error(body?.error?.message ?? 'Authentication request failed') }; return { data: body?.data as T } }
export class AuthService {
  private static instance: AuthService
  private constructor() {}
  public static getInstance() { if (!AuthService.instance) AuthService.instance = new AuthService(); return AuthService.instance }
  async login(email: string, password: string): Promise<AuthResult> { const result = await parse<BffUser>(await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })); return { user: result.data ?? null, session: result.data ? { user: result.data } : null, error: result.error ?? null } }
  async logout(): Promise<{ error: Error | null }> { const result = await parse<unknown>(await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': this.csrfToken() } })); return { error: result.error ?? null } }
  async getSession(): Promise<{ session: BffSession | null; error: Error | null }> { const result = await parse<BffUser>(await fetch('/api/auth/me', { credentials: 'include' })); return { session: result.data ? { user: result.data } : null, error: result.error?.message === 'Authentication is required' ? null : result.error ?? null } }
  onAuthStateChange(callback: (event: string, session: BffSession | null) => void): AuthSubscription { let active = true; void this.getSession().then(({ session }) => { if (active) callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session) }); return { data: { subscription: { unsubscribe: () => { active = false } } } } }
  private csrfToken() { return typeof document === 'undefined' ? '' : document.cookie.split('; ').find((item) => item.startsWith('edulog_csrf='))?.split('=').slice(1).join('=') ?? '' }
}
export const authService = AuthService.getInstance()