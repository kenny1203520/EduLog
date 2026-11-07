import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService } from '@/services/auth/AuthService'
import type { BffSession, BffUser } from '@/services/auth/AuthService'
import { AggregateService } from '@/services/api/AggregateService'
import { localDraftStore } from '@/services/report/LocalDraftStore'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<BffUser | null>(null)
  const session = ref<BffSession | null>(null)
  const loading = ref(true)
  const accountDisabled = ref(false)
  let initializePromise: Promise<void> | null = null

  const isAuthenticated = computed(() => !!user.value)

  function acceptRefreshedUser(nextUser: BffUser) {
    session.value = { user: nextUser }
    user.value = nextUser
    loading.value = false
  }

  function clearSession() {
    AggregateService.clearCache()
    user.value = null
    session.value = null
    loading.value = false
    accountDisabled.value = false
  }

  // Unsaved report drafts hold student data; they must not outlive the
  // person's session on a shared device. An expired session keeps them so the
  // same teacher can restore after signing in again.
  function clearLocalDrafts() {
    void localDraftStore.clearAll().catch((error) => console.warn('Local report drafts could not be cleared', error))
  }

  function markAccountDisabled() {
    clearLocalDrafts()
    clearSession()
    accountDisabled.value = true
  }

  async function initialize() {
    // App.vue and route guards can both initialise the store during boot.  Keep
    // this request single-flight so the BFF is not asked for /auth/me twice.
    if (initializePromise) return initializePromise

    initializePromise = (async () => {
      loading.value = true
      try {
        const { session: currentSession, error } = await authService.getSession()
        session.value = currentSession
        user.value = currentSession?.user ?? null
        accountDisabled.value = (error as { code?: string } | null)?.code === 'ACCOUNT_DISABLED'
      } finally {
        loading.value = false
      }
    })()

    try {
      await initializePromise
    } finally {
      initializePromise = null
    }
  }

  async function signIn(email: string, password: string) {
    const result = await authService.login(email, password)
    const { error } = result
    if (error) throw error
    if (result.user) {
      accountDisabled.value = false
      AggregateService.clearCache()
      session.value = result.session ?? { user: result.user }
      user.value = result.user
    }
  }

  async function signOut() {
    const { error } = await authService.logout()
    if (error) throw error
    clearLocalDrafts()
    clearSession()
  }

  return {
    user,
    session,
    loading,
    isAuthenticated,
    initialize,
    signIn,
    signOut,
    acceptRefreshedUser,
    clearSession,
    markAccountDisabled,
    accountDisabled
  }
})
