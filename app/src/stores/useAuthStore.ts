import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService } from '@/services/auth/AuthService'
import type { BffSession, BffUser } from '@/services/auth/AuthService'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<BffUser | null>(null)
  const session = ref<BffSession | null>(null)
  const loading = ref(true)

  const isAuthenticated = computed(() => !!user.value)

  async function initialize() {
    loading.value = true
    const { session: currentSession } = await authService.getSession()
    if (currentSession) {
      session.value = currentSession
      user.value = currentSession.user
    }
    
    // Listen for changes (e.g. token refresh, sign out)
    authService.onAuthStateChange((_event, newSession) => {
      session.value = newSession
      user.value = newSession ? newSession.user : null
      loading.value = false
    })
    loading.value = false
  }

  async function signIn(email: string, password: string) {
    const result = await authService.login(email, password)
    const { error } = result
    if (error) throw error
    if (result.user) {
      session.value = result.session ?? { user: result.user }
      user.value = result.user
    }
  }

  async function signOut() {
    const { error } = await authService.logout()
    if (error) throw error
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
