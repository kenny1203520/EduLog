<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/useAuthStore'

/** Shown to a signed-in account that an administrator has not approved yet. */
const { t } = useI18n()
const authStore = useAuthStore()
const router = useRouter()
const signingOut = ref(false)
const failed = ref(false)

async function signOut() {
  signingOut.value = true
  failed.value = false
  try {
    await authStore.signOut()
    await router.replace({ name: 'login' })
  } catch {
    failed.value = true
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-slate-50 p-4 sm:p-6">
    <section class="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm" aria-labelledby="account-pending-title">
      <div class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-sky-50 text-sky-700" aria-hidden="true">
        <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      </div>
      <h1 id="account-pending-title" class="text-2xl font-bold text-slate-900">{{ t('auth.account_pending_title') }}</h1>
      <p class="mt-3 text-slate-600">{{ t('auth.account_pending_message') }}</p>
      <p v-if="authStore.user?.email" class="mt-4 rounded-xl bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">{{ authStore.user.email }}</p>
      <p v-if="failed" role="alert" class="mt-4 text-sm font-semibold text-rose-700">{{ t('auth.sign_out_failed') }}</p>
      <button type="button" :disabled="signingOut"
        class="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        @click="signOut">
        {{ signingOut ? t('common.processing') : t('auth.sign_out') }}
      </button>
    </section>
  </main>
</template>
