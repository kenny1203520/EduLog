<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import { outboundOAuthService, type OAuthClient } from '@/services/auth/OutboundOAuthService'

const { t } = useI18n()
const page = ref(1)
const apps = ref<OAuthClient[]>([])
const busy = ref(false)
const problem = ref('')
const disabled = ref(false)
const registering = ref(false)
const confirmRemove = ref<string>()
const newName = ref('')
const callbacks = ref('')
const issued = ref<{ client_id: string; client_secret: string }>()
const formId = 'outbound-oauth-registration'

function reportProblem(error: unknown) {
  if (error instanceof ApiV1Error && error.code === 'OAUTH_SERVER_DISABLED') disabled.value = true
  else if (error instanceof ApiV1Error && error.status === 422) problem.value = 'invalid_settings'
  else if (error instanceof ApiV1Error && error.code.includes('REAUTH')) problem.value = 'reauth'
  else problem.value = 'unavailable'
}

async function load(target = page.value) {
  if (busy.value) return
  busy.value = true
  problem.value = ''
  try {
    apps.value = await outboundOAuthService.clients(target)
    page.value = target
  } catch (error) { reportProblem(error) }
  finally { busy.value = false }
}
onMounted(() => load())

async function register() {
  if (busy.value) return
  busy.value = true
  problem.value = ''
  try {
    issued.value = await outboundOAuthService.register(newName.value, callbacks.value.split('\n').map(uri => uri.trim()).filter(Boolean))
    newName.value = ''
    callbacks.value = ''
    registering.value = false
  } catch (error) { reportProblem(error) }
  finally { busy.value = false }
  if (!registering.value) await load(1)
}

async function remove(id: string) {
  if (busy.value) return
  busy.value = true
  problem.value = ''
  try {
    await outboundOAuthService.removeClient(id)
    apps.value = apps.value.filter(app => app.client_id !== id)
  } catch (error) { reportProblem(error) }
  finally {
    busy.value = false
    confirmRemove.value = undefined
  }
}
</script>

<template>
  <section aria-labelledby="oauth-apps-heading" class="space-y-4">
    <h2 id="oauth-apps-heading" class="text-lg font-semibold">{{ t('oauthServer.apps_title') }}</h2>
    <p v-if="disabled" class="text-sm text-gray-600">{{ t('oauthServer.admin_disabled') }}</p>
    <template v-else>
      <p v-if="busy" role="status" class="text-sm text-gray-600">{{ t('oauthServer.loading') }}</p>
      <p v-if="problem" role="alert" class="text-sm text-red-700">{{ t(`oauthServer.${problem}`) }}</p>
      <button v-if="problem === 'unavailable'" type="button" class="btn-base" :disabled="busy" @click="load()">{{ t('oauthServer.retry') }}</button>
      <p v-if="!apps.length && !busy && !problem" class="text-sm text-gray-600">{{ t('oauthServer.apps_empty') }}</p>
      <ul v-if="apps.length" class="divide-y divide-gray-200">
        <li v-for="app in apps" :key="app.client_id" class="flex flex-wrap items-start justify-between gap-2 py-3">
          <div class="min-w-0 space-y-1">
            <p class="font-semibold">{{ app.client_name }}</p>
            <p class="break-all font-mono text-sm">{{ app.client_id }}</p>
            <p v-for="uri in app.redirect_uris" :key="uri" class="break-all text-sm text-gray-600">{{ uri }}</p>
          </div>
          <div v-if="confirmRemove === app.client_id" class="flex flex-wrap gap-2">
            <button type="button" class="btn-base" :disabled="busy" @click="confirmRemove = undefined">{{ t('oauthServer.cancel') }}</button>
            <button type="button" class="btn-base text-red-700" :disabled="busy" @click="remove(app.client_id)">{{ t('oauthServer.confirm_remove') }}</button>
          </div>
          <button v-else type="button" class="btn-base text-red-700" :disabled="busy" @click="confirmRemove = app.client_id">{{ t('oauthServer.remove') }}</button>
        </li>
      </ul>
      <div v-if="page > 1 || apps.length === 50" class="flex items-center gap-3">
        <button type="button" class="btn-base" :disabled="busy || page === 1" @click="load(page - 1)">{{ t('oauthServer.previous') }}</button>
        <span>{{ t('oauthServer.page', { page }) }}</span>
        <button type="button" class="btn-base" :disabled="busy || apps.length < 50" @click="load(page + 1)">{{ t('oauthServer.next') }}</button>
      </div>
      <div v-if="issued" class="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4" role="status">
        <p>{{ t('oauthServer.copy_secret') }}</p>
        <p class="break-all">Client ID <code>{{ issued.client_id }}</code></p>
        <p class="break-all">Client Secret <code>{{ issued.client_secret }}</code></p>
        <button type="button" class="btn-base" @click="issued = undefined">{{ t('oauthServer.done') }}</button>
      </div>
      <button v-if="!registering" type="button" class="btn-base" :disabled="busy" @click="registering = true">{{ t('oauthServer.add_app') }}</button>
      <form v-else class="space-y-3" @submit.prevent="register">
        <label :for="`${formId}-name`" class="block font-medium">{{ t('oauthServer.app_name') }}</label>
        <input :id="`${formId}-name`" v-model="newName" type="text" required maxlength="120" :disabled="busy"
          class="w-full rounded border border-gray-300 p-2">
        <label :for="`${formId}-urls`" class="block font-medium">{{ t('oauthServer.callbacks') }}</label>
        <textarea :id="`${formId}-urls`" v-model="callbacks" required rows="3" :disabled="busy"
          class="w-full rounded border border-gray-300 p-2"></textarea>
        <div class="flex gap-2">
          <button type="submit" class="btn-base bg-emerald-700 text-white" :disabled="busy">{{ t('oauthServer.register') }}</button>
          <button type="button" class="btn-base" :disabled="busy" @click="registering = false">{{ t('oauthServer.cancel') }}</button>
        </div>
      </form>
    </template>
  </section>
</template>
