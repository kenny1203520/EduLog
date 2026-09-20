import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService } from '@/services/auth/AuthService'
import type { BffSession, BffUser } from '@/services/auth/AuthService'
import { AggregateService } from '@/services/AggregateService'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<BffUser | null>(null)
  const session = ref<BffSession | null>(null)
  const loading = ref(true)
  let initializePromise: Promise<void> | null = null

  const isAuthenticated = computed(() => !!user.value)

  async function initialize() {
    // App.vue and route guards can both initialise the store during boot.  Keep
    // this request single-flight so the BFF is not asked for /auth/me twice.
    if (initializePromise) return initializePromise

    initializePromise = (async () => {
      loading.value = true
      try {
        const { session: currentSession } = await authService.getSession()
        session.value = currentSession
        user.value = currentSession?.user ?? null
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
      AggregateService.clearCache()
      session.value = result.session ?? { user: result.user }
      user.value = result.user
    }
  }

  async function signOut() {
    const { error } = await authService.logout()
    if (error) throw error
    AggregateService.clearCache()
    user.value = null
    session.value = null
  }

  return {
    user,
    session,
    loading,
    isAuthenticated,
    initialize,
    signIn,
    signOut
  }
})
