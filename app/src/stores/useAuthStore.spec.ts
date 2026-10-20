import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { authService } from '@/services/auth/AuthService'
import { localDraftStore } from '@/services/report/LocalDraftStore'
import { useAuthStore } from './useAuthStore'

vi.mock('@/services/report/LocalDraftStore', () => ({
  localDraftStore: { clearAll: vi.fn().mockResolvedValue(undefined) }
}))

vi.mock('@/services/auth/AuthService', () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(),
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

  it('wipes device-local report drafts on logout and when the account is disabled', async () => {
    vi.mocked(authService.logout).mockResolvedValue({ error: null } as never)
    const store = useAuthStore()
    await store.signOut()
    expect(localDraftStore.clearAll).toHaveBeenCalledTimes(1)

    store.markAccountDisabled()
    expect(localDraftStore.clearAll).toHaveBeenCalledTimes(2)
  })

  it('keeps drafts when only the session expired so the same teacher can restore them', () => {
    useAuthStore().clearSession()
    expect(localDraftStore.clearAll).not.toHaveBeenCalled()
  })

  it('keeps drafts when logout fails', async () => {
    vi.mocked(authService.logout).mockResolvedValue({ error: new Error('offline') } as never)
    await expect(useAuthStore().signOut()).rejects.toThrow('offline')
    expect(localDraftStore.clearAll).not.toHaveBeenCalled()
  })
})
