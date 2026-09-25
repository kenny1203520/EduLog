import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { authService } from '@/services/auth/AuthService'
import { useAuthStore } from './useAuthStore'

vi.mock('@/services/auth/AuthService', () => ({
  authService: {
    login: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn()
  }
}))

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('stores the user returned by a successful BFF login', async () => {
    const user = { id: 'user-1', email: 'user@example.test' }
    vi.mocked(authService.login).mockResolvedValue({
      user,
      session: { user },
      error: null
    })

    const store = useAuthStore()
    await store.signIn(user.email, 'not-a-real-password')

    expect(store.user).toEqual(user)
    expect(store.session).toEqual({ user })
    expect(store.isAuthenticated).toBe(true)
  })

  it('preserves disabled-account state from the session check without treating it as a login session', async () => {
    vi.mocked(authService.getSession).mockResolvedValue({
      session: null,
      error: Object.assign(new Error('This account is disabled'), { code: 'ACCOUNT_DISABLED' })
    })

    const store = useAuthStore()
    await store.initialize()

    expect(store.accountDisabled).toBe(true)
    expect(store.isAuthenticated).toBe(false)
  })
})
