<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import { oauthScopeLabel, outboundOAuthService, type OAuthConsentDetails } from '@/services/auth/OutboundOAuthService'

const route = useRoute()
const { t } = useI18n()
const authorizationId = computed(() => typeof route.query.authorization_id === 'string' ? route.query.authorization_id : '')
const details = ref<OAuthConsentDetails>()
const loading = ref(true)
const submitting = ref(false)
const problem = ref<'invalid' | 'unavailable' | null>(null)
let request = 0

function returnToApp(url: string) {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Invalid OAuth callback')
  window.location.replace(target.href)
}

function reportProblem(error: unknown) {
  problem.value = error instanceof ApiV1Error && [404, 422].includes(error.status) ? 'invalid' : 'unavailable'
}

async function load() {
  const current = ++request
  loading.value = true
  submitting.value = false
  problem.value = null
  details.value = undefined
  try {
    if (!authorizationId.value) {
      problem.value = 'invalid'
      return
    }
    const result = await outboundOAuthService.authorization(authorizationId.value)
    if (current !== request) return
    if ('redirect_url' in result) returnToApp(result.redirect_url)
    else details.value = result
  } catch (error) {
    if (current === request) reportProblem(error)
  } finally {
    if (current === request) loading.value = false
  }
}
watch(authorizationId, load, { immediate: true })

async function decide(action: 'approve' | 'deny') {
  if (loading.value || submitting.value || !details.value) return
  const current = request
  submitting.value = true
  problem.value = null
  try {
    const result = await outboundOAuthService.decide(authorizationId.value, action)
    if (current === request) returnToApp(result.redirect_url)
  } catch (error) {
    if (current === request) reportProblem(error)
  } finally {
    if (current === request) submitting.value = false
  }
}
</script>

<template>
  <main class="min-h-dvh bg-gray-50 px-4 py-12">
    <section class="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 class="text-xl font-semibold text-gray-900">{{ t('oauthServer.consent_title') }}</h1>
      <p v-if="loading" role="status" class="mt-3 text-gray-600">{{ t('oauthServer.loading') }}</p>
      <p v-if="problem" role="alert" class="mt-3 text-red-700">{{ t(`oauthServer.${problem}`) }}</p>
      <button v-if="problem === 'unavailable' && !details" type="button" class="btn-base mt-3" @click="load">
        {{ t('oauthServer.retry') }}
      </button>
      <div v-if="details" class="mt-4 space-y-4">
        <p>{{ t('oauthServer.request', { app: details.client.name || details.client.id }) }}</p>
        <p v-if="details.user.email" class="break-all text-sm text-gray-600">{{ details.user.email }}</p>
        <ul class="list-disc space-y-1 pl-5 text-gray-700">
          <li v-for="scope in details.scope.split(/\s+/)" :key="scope">{{ oauthScopeLabel(scope, t) }}</li>
        </ul>
        <div class="flex flex-wrap justify-end gap-3">
          <button type="button" class="btn-base" :disabled="submitting" @click="decide('deny')">{{ t('oauthServer.deny') }}</button>
          <button type="button" class="btn-base bg-emerald-700 text-white" :disabled="submitting" @click="decide('approve')">{{ t('oauthServer.approve') }}</button>
        </div>
      </div>
      <RouterLink v-else-if="problem === 'invalid'" class="mt-4 inline-block text-emerald-800 underline" to="/dashboard">
        {{ t('oauthServer.back') }}
      </RouterLink>
    </section>
  </main>
</template>
