<script setup lang="ts">
import { useAuthStore } from '@/stores/useAuthStore'
import { onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import { useAppUpdatePrompt } from '@/composables/useAppUpdatePrompt'

const auth = useAuthStore()
const { t } = useI18n()
const updatePrompt = useAppUpdatePrompt()
const router = useRouter()
const route = useRoute()
let authNavigationPending = false

function onAuthSessionExpired() {
  if (!route.matched.some(record => record.meta.requiresAuth) || authNavigationPending) return
  authNavigationPending = true
  auth.clearSession()
  void router.replace({ name: 'login', query: { redirect: route.fullPath } }).finally(() => { authNavigationPending = false })
}

function onAccountDisabled() {
  auth.markAccountDisabled()
  void router.replace({ name: 'account-disabled' })
}

function onAuthSessionRefreshed(event: Event) {
  const user = (event as CustomEvent<Record<string, unknown>>).detail
  if (user && typeof user.id === 'string') auth.acceptRefreshedUser(user as never)
}

onMounted(() => {
  window.addEventListener('edulog:auth-session-expired', onAuthSessionExpired)
  window.addEventListener('edulog:account-disabled', onAccountDisabled)
  window.addEventListener('edulog:auth-session-refreshed', onAuthSessionRefreshed)
  void auth.initialize()
})

onBeforeUnmount(() => {
  window.removeEventListener('edulog:auth-session-expired', onAuthSessionExpired)
  window.removeEventListener('edulog:account-disabled', onAccountDisabled)
  window.removeEventListener('edulog:auth-session-refreshed', onAuthSessionRefreshed)
})
</script>

<template>
  <div v-if="auth.loading" class="flex items-center justify-center min-h-screen bg-gray-100">
    <p class="text-gray-500">{{ t('common.loading') }}</p>
  </div>
  <router-view v-else />
  <ConfirmModal
    :is-open="updatePrompt.isOpen.value"
    :title="t('common.update_available_title')"
    :message="t('common.update_available_message')"
    :confirm-text="t('common.reload')"
    :cancel-text="t('common.later')"
    @confirm="updatePrompt.confirm()"
    @close="updatePrompt.dismiss()"
  />
</template>
