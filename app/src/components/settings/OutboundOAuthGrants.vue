<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import { oauthScopeLabel, outboundOAuthService, type OAuthGrant } from '@/services/auth/OutboundOAuthService'

const { t } = useI18n()
const grants = ref<OAuthGrant[]>([])
const available = ref(false)
const busy = ref(false)
const failed = ref(false)
const confirmRevoke = ref<string>()

async function load() {
  if (busy.value) return
  busy.value = true
  failed.value = false
  try {
    grants.value = await outboundOAuthService.grants()
    available.value = true
  } catch (error) {
    available.value = !(error instanceof ApiV1Error && error.code === 'OAUTH_SERVER_DISABLED')
    failed.value = available.value
  } finally { busy.value = false }
}
onMounted(load)

async function revoke(id: string) {
  if (busy.value) return
  busy.value = true
  failed.value = false
  try {
    await outboundOAuthService.revoke(id)
    grants.value = grants.value.filter(grant => grant.client.id !== id)
    confirmRevoke.value = undefined
  } catch { failed.value = true }
  finally { busy.value = false }
}
</script>

<template>
  <section v-if="available" aria-labelledby="oauth-grants-heading" class="space-y-3">
    <h3 id="oauth-grants-heading" class="font-semibold">{{ t('oauthServer.grants_title') }}</h3>
    <p v-if="busy" role="status" class="text-sm text-gray-600">{{ t('oauthServer.loading') }}</p>
    <div v-if="failed">
      <p role="alert" class="text-sm text-red-700">{{ t('oauthServer.unavailable') }}</p>
      <button type="button" class="btn-base" :disabled="busy" @click="load">{{ t('oauthServer.retry') }}</button>
    </div>
    <p v-if="grants.length === 0 && !failed && !busy" class="text-sm text-gray-600">{{ t('oauthServer.grants_empty') }}</p>
    <ul v-if="grants.length" class="divide-y divide-gray-200">
      <li v-for="grant in grants" :key="grant.client.id" class="flex flex-wrap items-start justify-between gap-2 py-2">
        <div>
          <p class="font-medium">{{ grant.client.name || grant.client.id }}</p>
          <ul class="text-sm text-gray-600">
            <li v-for="scope in grant.scopes" :key="scope">{{ oauthScopeLabel(scope, t) }}</li>
          </ul>
        </div>
        <div v-if="confirmRevoke === grant.client.id" class="flex flex-wrap gap-2">
          <button type="button" class="btn-base" :disabled="busy" @click="confirmRevoke = undefined">{{ t('oauthServer.cancel') }}</button>
          <button type="button" class="btn-base text-red-700" :disabled="busy" @click="revoke(grant.client.id)">{{ t('oauthServer.confirm_revoke') }}</button>
        </div>
        <button v-else type="button" class="btn-base text-red-700" :disabled="busy" @click="confirmRevoke = grant.client.id">{{ t('oauthServer.revoke') }}</button>
      </li>
    </ul>
  </section>
</template>
