<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import PasswordInput from '@/components/ui/PasswordInput.vue'
import { authService } from '@/services/auth/AuthService'
import { useAuthStore } from '@/stores/useAuthStore'

/** Reached from an invite or password-reset email: choose a new password. */
const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const password = ref('')
const confirm = ref('')
const saving = ref(false)
const errorKey = ref<string | null>(null)

const mismatch = computed(() => confirm.value.length > 0 && password.value !== confirm.value)
const tooShort = computed(() => password.value.length > 0 && password.value.length < 8)

async function submit() {
  if (mismatch.value || tooShort.value) return
  saving.value = true
  errorKey.value = null
  try {
    await authService.setPassword(password.value, confirm.value)
    await router.replace(authStore.accountPending ? { name: 'account-pending' } : { name: 'dashboard' })
  } catch (error) {
    errorKey.value = (error as { code?: string })?.code === 'PASSWORD_SETUP_EXPIRED' ? 'auth.set_password_expired' : 'auth.set_password_failed'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-100 p-4 sm:p-6">
    <section class="w-full max-w-md rounded-3xl border border-white bg-white/90 p-8 shadow-xl ring-1 ring-emerald-100" aria-labelledby="set-password-title">
      <h1 id="set-password-title" class="text-2xl font-black text-gray-900">{{ t('auth.set_password_title') }}</h1>
      <p class="mt-2 text-sm text-gray-600">{{ t('auth.set_password_description', { email: authStore.user?.email ?? '' }) }}</p>
      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <div class="space-y-2">
          <label for="new-password" class="block text-sm font-bold text-gray-700">{{ t('auth.new_password') }}</label>
          <PasswordInput id="new-password" v-model="password" required autocomplete="new-password" :minlength="8"
            input-class="min-h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 font-medium text-gray-800 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10" />
          <p v-if="tooShort" class="text-xs font-semibold text-amber-700">{{ t('auth.password_min_length') }}</p>
        </div>
        <div class="space-y-2">
          <label for="confirm-password" class="block text-sm font-bold text-gray-700">{{ t('auth.confirm_password') }}</label>
          <PasswordInput id="confirm-password" v-model="confirm" required autocomplete="new-password" :minlength="8"
            input-class="min-h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 font-medium text-gray-800 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10" />
          <p v-if="mismatch" class="text-xs font-semibold text-amber-700">{{ t('auth.password_mismatch') }}</p>
        </div>
        <div v-if="errorKey" role="alert" class="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
          {{ t(errorKey) }}
          <RouterLink v-if="errorKey === 'auth.set_password_expired'" to="/forgot-password" class="ml-1 underline">{{ t('auth.forgot_link') }}</RouterLink>
        </div>
        <button type="submit" :disabled="saving || !password || !confirm || mismatch || tooShort"
          class="min-h-11 w-full rounded-2xl bg-emerald-600 px-4 py-3 font-black text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          {{ saving ? t('common.saving') : t('auth.set_password_submit') }}
        </button>
      </form>
    </section>
  </main>
</template>
