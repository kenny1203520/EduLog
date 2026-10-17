<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-50 p-6">
    <section class="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-700" aria-hidden="true">!</div>
      <h1 class="text-2xl font-bold text-slate-900">{{ t('auth.account_disabled_title') }}</h1>
      <p class="mt-3 text-slate-600">{{ t('auth.account_disabled_message') }}</p>
      <RouterLink class="mt-7 inline-flex rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2" to="/login">
        {{ t('auth.account_disabled_login') }}
      </RouterLink>
    </section>
  </main>
</template>
