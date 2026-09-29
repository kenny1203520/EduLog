<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { apiV1Client } from '@/services/api/ApiV1Client'

type PairApproval = { id: string; status: 'pending' | 'approved'; extension_origin: string; expires_at: string }
type ExtensionToken = { id: string; extension_origin: string; created_at: string; last_used_at: string | null; expires_at: string; revoked_at: string | null }
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const pairRequestId = computed(() => typeof route.query.extension_pair === 'string' ? route.query.extension_pair : '')
const pair = ref<PairApproval | null>(null)
const tokens = ref<ExtensionToken[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [tokenResult, pairResult] = await Promise.all([
      apiV1Client.get<ExtensionToken[]>('/extension/tokens'),
      pairRequestId.value ? apiV1Client.get<PairApproval>(`/extension/pair-requests/${encodeURIComponent(pairRequestId.value)}/approval`).catch(() => null) : Promise.resolve(null),
    ])
    tokens.value = tokenResult.data ?? []
    pair.value = pairResult?.data ?? null
  } catch {
    error.value = t('settings.extension.load_failed')
  } finally {
    loading.value = false
  }
}

async function approve() {
  if (!pairRequestId.value || busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    await apiV1Client.post(`/extension/pair-requests/${encodeURIComponent(pairRequestId.value)}/approve`, {})
    notice.value = t('settings.extension.approved')
    await router.replace({ query: { ...route.query, extension_pair: undefined } })
    pair.value = null
    await load()
  } catch {
    error.value = t('settings.extension.approve_failed')
  } finally { busy.value = false }
}

async function revoke(tokenId: string) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    await apiV1Client.delete(`/extension/tokens/${encodeURIComponent(tokenId)}`)
    notice.value = t('settings.extension.revoked')
    await load()
  } catch { error.value = t('settings.extension.revoke_failed') }
  finally { busy.value = false }
}

onMounted(async () => {
  await load()
  if (pairRequestId.value && pair.value) {
    await nextTick()
    document.getElementById('integrations')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }
})
</script>

<template>
  <div class="space-y-5">
    <p class="text-sm leading-6 text-slate-600">{{ t('settings.extension.description') }}</p>
    <div v-if="error" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{{ error }}</div>
    <div v-if="notice" class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{{ notice }}</div>
    <div v-if="loading" class="py-4 text-sm text-slate-500" role="status">{{ t('common.loading') }}</div>
    <template v-else>
      <section v-if="pair" class="rounded-2xl border border-amber-300 bg-amber-50 p-5" aria-labelledby="extension-pair-title">
        <h3 id="extension-pair-title" class="font-semibold text-slate-900">{{ t('settings.extension.pair_title') }}</h3>
        <p class="mt-2 text-sm leading-6 text-slate-700">{{ t('settings.extension.pair_description') }}</p>
        <p class="mt-3 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-slate-700">{{ pair.extension_origin }}</p>
        <p class="mt-2 text-xs text-slate-600">{{ t('settings.extension.expires', { date: new Date(pair.expires_at).toLocaleString() }) }}</p>
        <button type="button" class="mt-4 min-h-11 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50" :disabled="busy || pair.status !== 'pending'" @click="approve">{{ busy ? t('common.processing') : t('settings.extension.approve') }}</button>
      </section>

      <section aria-labelledby="extension-connections-title">
        <h3 id="extension-connections-title" class="font-semibold text-slate-900">{{ t('settings.extension.connections') }}</h3>
        <p v-if="!tokens.filter((token) => !token.revoked_at && new Date(token.expires_at).getTime() > Date.now()).length" class="mt-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{{ t('settings.extension.no_connections') }}</p>
        <ul v-else class="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200">
          <li v-for="token in tokens.filter((item) => !item.revoked_at && new Date(item.expires_at).getTime() > Date.now())" :key="token.id" class="flex flex-wrap items-center justify-between gap-3 p-4">
            <div class="min-w-0"><p class="break-all text-sm font-medium text-slate-800">{{ token.extension_origin }}</p><p class="mt-1 text-xs text-slate-500">{{ t('settings.extension.last_used', { date: token.last_used_at ? new Date(token.last_used_at).toLocaleString() : t('settings.extension.never') }) }}</p></div>
            <button type="button" class="min-h-11 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-50" :disabled="busy" @click="revoke(token.id)">{{ t('settings.extension.revoke') }}</button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
