<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { authService } from '@/services/auth/AuthService'

const { t } = useI18n()
const email = ref('')
const sending = ref(false)
const sent = ref(false)
const failed = ref(false)

async function submit() {
  sending.value = true
  failed.value = false
  try {
    await authService.requestPasswordReset(email.value.trim())
    sent.value = true
  } catch {
    failed.value = true
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-100 p-4 sm:p-6">
    <section class="w-full max-w-md rounded-3xl border border-white bg-white/90 p-8 shadow-xl ring-1 ring-emerald-100" aria-labelledby="forgot-title">
      <h1 id="forgot-title" class="text-2xl font-black text-gray-900">{{ t('auth.forgot_title') }}</h1>
      <p class="mt-2 text-sm text-gray-600">{{ t('auth.forgot_description') }}</p>

      <p v-if="sent" role="status" class="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">{{ t('auth.forgot_sent') }}</p>
      <form v-else class="mt-6 space-y-4" @submit.prevent="submit">
        <label class="block space-y-2 text-sm font-bold text-gray-700" for="forgot-email">
          <span>{{ t('auth.email') }}</span>
          <input id="forgot-email" v-model="email" type="email" required autocomplete="email" maxlength="320"
            class="min-h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 font-medium text-gray-800 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
            :placeholder="t('auth.email_placeholder')" />
        </label>
        <p v-if="failed" role="alert" class="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{{ t('auth.error_unexpected') }}</p>
        <button type="submit" :disabled="sending || !email.trim()"
          class="min-h-11 w-full rounded-2xl bg-emerald-600 px-4 py-3 font-black text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          {{ sending ? t('common.processing') : t('auth.forgot_submit') }}
        </button>
      </form>
      <RouterLink to="/login" class="mt-6 inline-flex min-h-11 items-center text-sm font-bold text-emerald-700 hover:underline">{{ t('auth.back_to_login') }}</RouterLink>
    </section>
  </main>
</template>
