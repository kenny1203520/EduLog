<script setup lang="ts">
import { useAuthStore } from '@/stores/useAuthStore'
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import { useAppUpdatePrompt } from '@/composables/useAppUpdatePrompt'

const auth = useAuthStore()
const { t } = useI18n()
const updatePrompt = useAppUpdatePrompt()

onMounted(() => {
  auth.initialize()
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
