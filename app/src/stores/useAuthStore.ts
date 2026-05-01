import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService } from '@/services/Auth/AuthService'
import type { Session, User } from '@supabase/supabase-js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const session = ref<Session | null>(null)
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
    const { error } = await authService.login(email, password)
    if (error) throw error
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
