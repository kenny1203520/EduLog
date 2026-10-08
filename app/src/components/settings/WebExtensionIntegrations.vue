<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { apiV1Client } from '@/services/api/ApiV1Client'

type Device = { installation_id?: string | null; device_name?: string | null; browser_name?: string | null; platform_name?: string | null }
type PairApproval = Device & { id: string; status: 'pending' | 'approved' | 'claimed'; extension_origin: string; expires_at: string; token_id?: string | null }
type ExtensionToken = Device & { id: string; extension_origin: string; created_at: string; last_used_at: string | null; expires_at: string; revoked_at: string | null }
const route = useRoute(), router = useRouter()
const { t, locale } = useI18n()
const pairRequestId = computed(() => typeof route.query.extension_pair === 'string' ? route.query.extension_pair : '')
const pair = ref<PairApproval | null>(null), tokens = ref<ExtensionToken[]>([])
const loading = ref(true), refreshing = ref(false), busy = ref(false), pairExpired = ref(false)
const error = ref(''), notice = ref(''), updatedAt = ref(''), now = ref(Date.now())
const pairName = ref(''), editingId = ref(''), editName = ref('')
const revokeTarget = ref<ExtensionToken | null>(null), dialog = ref<HTMLDialogElement | null>(null)
const refreshButton = ref<HTMLButtonElement | null>(null)
const activeTokens = computed(() => tokens.value.filter(token => !token.revoked_at && new Date(token.expires_at).getTime() > now.value))
const name = (token: Device & { id: string }) => token.device_name || `${t('settings.extension.legacy_name')} · ${token.id.slice(0, 8)}`
const device = (token: Device) => [token.browser_name, token.platform_name].filter(Boolean).join(' · ')
const date = (value: string) => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
let mounted = false, generation = 0, inFlight = false
let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
function schedule() {
  clearTimeout(timer)
  if (mounted && !document.hidden) timer = setTimeout(() => { if (busy.value) schedule(); else void load() }, pair.value && !pairExpired.value ? 2000 : 10000)
}
async function load(force = false) {
  if (!mounted || (inFlight && !force)) return
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal, sequence = ++generation, requestId = pairRequestId.value
  inFlight = true; refreshing.value = true
  try {
    const [tokenResult, pairResult] = await Promise.all([
      apiV1Client.get<ExtensionToken[]>('/extension/tokens', { signal, cache: 'no-store' }),
      requestId ? apiV1Client.get<PairApproval>(`/extension/pair-requests/${encodeURIComponent(requestId)}/approval`, { signal, cache: 'no-store' }).catch(cause => {
        if (cause?.status === 404 || cause?.status === 410) return null
        throw cause
      }) : Promise.resolve(null),
    ])
    if (!mounted || sequence !== generation) return
    tokens.value = tokenResult.data ?? []; now.value = Date.now(); updatedAt.value = new Date().toISOString(); error.value = ''
    const previous = pair.value?.id
    pair.value = pairResult?.data ?? null
    pairExpired.value = Boolean(requestId && (!pair.value || (pair.value.status !== 'claimed' && new Date(pair.value.expires_at).getTime() <= now.value)))
    if (pair.value && previous !== pair.value.id) pairName.value = pair.value.device_name || device(pair.value) || t('settings.extension.default_name')
    if (pair.value?.status === 'claimed' && tokens.value.some(token => token.id === pair.value?.token_id)) {
      notice.value = t('settings.extension.connected_notice'); pair.value = null
      await router.replace({ query: { ...route.query, extension_pair: undefined } })
    }
  } catch {
    if (mounted && sequence === generation && !signal.aborted) error.value = t('settings.extension.load_failed')
  } finally {
    if (mounted && sequence === generation) { inFlight = false; loading.value = false; refreshing.value = false; schedule() }
  }
}
async function approve() {
  if (!pair.value || busy.value) return
  const value = pairName.value.trim()
  if (!value || value.length > 80) { error.value = t('settings.extension.name_required'); return }
  busy.value = true; error.value = ''
  try {
    await apiV1Client.post(`/extension/pair-requests/${encodeURIComponent(pair.value.id)}/approve`, { device_name: value })
    pair.value.status = 'approved'; notice.value = t('settings.extension.approved')
    await load(true)
  } catch { error.value = t('settings.extension.approve_failed') }
  finally { busy.value = false; schedule() }
}
function startRename(token: ExtensionToken) {
  editingId.value = token.id; editName.value = name(token)
  void nextTick(() => document.getElementById(`extension-name-${token.id}`)?.focus())
}
function cancelRename(token: ExtensionToken) {
  editingId.value = ''
  void nextTick(() => document.getElementById(`extension-rename-${token.id}`)?.focus())
}
async function rename(token: ExtensionToken) {
  if (busy.value) return
  const value = editName.value.trim()
  if (!value || value.length > 80) { error.value = t('settings.extension.name_required'); return }
  busy.value = true; error.value = ''
  try {
    await apiV1Client.patch(`/extension/tokens/${encodeURIComponent(token.id)}`, { device_name: value })
    editingId.value = ''; notice.value = t('settings.extension.renamed'); await load(true)
    await nextTick(); document.getElementById(`extension-rename-${token.id}`)?.focus()
  } catch { error.value = t('settings.extension.rename_failed') }
  finally { busy.value = false; schedule() }
}
async function askRevoke(token: ExtensionToken) {
  revokeTarget.value = token; await nextTick(); dialog.value?.showModal()
}
async function revoke() {
  const target = revokeTarget.value
  if (!target || busy.value) return
  busy.value = true; error.value = ''
  try {
    await apiV1Client.delete(`/extension/tokens/${encodeURIComponent(target.id)}`)
    tokens.value = tokens.value.filter(token => token.id !== target.id)
    notice.value = t('settings.extension.revoked'); dialog.value?.close(); revokeTarget.value = null
    await load(true); await nextTick(); refreshButton.value?.focus()
  } catch { error.value = t('settings.extension.revoke_failed'); dialog.value?.close() }
  finally { busy.value = false; schedule() }
}
function resume() { if (!document.hidden && !busy.value) void load(true) }
function visibility() {
  if (document.hidden) { clearTimeout(timer); controller?.abort(); generation++; inFlight = false; refreshing.value = false }
  else resume()
}
watch(pairRequestId, () => { pairExpired.value = false; void load(true) })
onMounted(async () => {
  mounted = true; document.addEventListener('visibilitychange', visibility); window.addEventListener('focus', resume)
  await load()
  if (pair.value) { await nextTick(); document.getElementById('integrations')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }) }
})
onUnmounted(() => { mounted = false; generation++; controller?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', resume) })
</script>

<template>
  <div class="extension-connections space-y-5">
    <p class="text-sm leading-6 text-slate-600">{{ t('settings.extension.description') }}</p>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs text-slate-500">{{ updatedAt ? t('settings.extension.updated', { date: date(updatedAt) }) : '' }}</p>
      <button ref="refreshButton" type="button" class="secondary" :disabled="refreshing || busy" @click="load(true)">{{ t(refreshing ? 'settings.extension.refreshing' : 'settings.extension.refresh') }}</button>
    </div>
    <div v-if="error" class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{{ error }}</div>
    <div v-if="notice" class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status" aria-live="polite">{{ notice }}</div>
    <p v-if="loading" role="status">{{ t('common.loading') }}</p>
    <template v-else>
      <p v-if="pairExpired" class="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{{ t('settings.extension.pair_expired') }}</p>
      <section v-if="pair && !pairExpired" class="rounded-2xl border border-blue-200 bg-blue-50 p-5" aria-labelledby="extension-pair-title">
        <h3 id="extension-pair-title" class="font-semibold text-slate-900">{{ t(pair.status === 'pending' ? 'settings.extension.pair_title' : 'settings.extension.waiting_claim') }}</h3>
        <p class="mt-2 text-sm leading-6 text-slate-700">{{ t(pair.status === 'pending' ? 'settings.extension.pair_description' : 'settings.extension.approved') }}</p>
        <p v-if="device(pair)" class="mt-2 text-sm text-slate-700">{{ device(pair) }}</p>
        <form v-if="pair.status === 'pending'" class="mt-4 space-y-2" @submit.prevent="approve">
          <label for="extension-pair-name" class="block text-sm font-medium">{{ t('settings.extension.name') }}</label>
          <input id="extension-pair-name" v-model="pairName" name="device_name" maxlength="80" required :disabled="busy" aria-describedby="extension-pair-name-hint" />
          <p id="extension-pair-name-hint" class="text-xs text-slate-600">{{ t('settings.extension.name_hint') }}</p>
          <button type="submit" class="primary" :disabled="busy">{{ t(busy ? 'common.processing' : 'settings.extension.approve') }}</button>
        </form>
        <p class="mt-3 text-xs text-slate-600">{{ t('settings.extension.expires', { date: date(pair.expires_at) }) }}</p>
        <details class="mt-3"><summary>{{ t('settings.extension.extension_info') }}</summary><p class="break-all font-mono text-xs">{{ pair.extension_origin }}</p></details>
      </section>
      <section aria-labelledby="extension-connections-title">
        <h3 id="extension-connections-title" class="font-semibold text-slate-900">{{ t('settings.extension.connection_count', { count: activeTokens.length }) }}</h3>
        <p v-if="!activeTokens.length" class="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{{ t('settings.extension.no_connections') }}</p>
        <ul v-else class="device-grid mt-3">
          <li v-for="token in activeTokens" :key="token.id" class="rounded-xl border border-slate-200 bg-white p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0"><h4 class="break-words font-semibold text-slate-900">{{ name(token) }}</h4><p v-if="device(token)" class="mt-1 text-sm text-slate-600">{{ device(token) }}</p></div>
              <span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">{{ t('settings.extension.active') }}</span>
            </div>
            <p v-if="!token.installation_id" class="mt-2 text-sm text-amber-800">{{ t('settings.extension.legacy_hint') }}</p>
            <p class="mt-2 text-xs text-slate-600">{{ t('settings.extension.connection_number', { id: token.id.slice(0, 8) }) }}</p>
            <div class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
              <p>{{ t('settings.extension.created', { date: date(token.created_at) }) }}</p>
              <p>{{ t('settings.extension.last_used', { date: token.last_used_at ? date(token.last_used_at) : t('settings.extension.never') }) }}</p>
            </div>
            <form v-if="editingId === token.id" class="mt-4 space-y-2" @submit.prevent="rename(token)">
              <label :for="`extension-name-${token.id}`" class="block text-sm font-medium">{{ t('settings.extension.name') }}</label>
              <input :id="`extension-name-${token.id}`" v-model="editName" name="device_name" maxlength="80" required :disabled="busy" />
              <div class="flex flex-wrap gap-2"><button type="submit" class="primary" :disabled="busy">{{ t('common.save') }}</button><button type="button" class="secondary" :disabled="busy" @click="cancelRename(token)">{{ t('common.cancel') }}</button></div>
            </form>
            <div v-else class="mt-4 flex flex-wrap gap-2">
              <button :id="`extension-rename-${token.id}`" type="button" class="secondary" :disabled="busy" :aria-label="t('settings.extension.rename_label', { name: name(token) })" @click="startRename(token)">{{ t('settings.extension.rename') }}</button>
              <button type="button" class="danger" :disabled="busy" :aria-label="t('settings.extension.revoke_label', { name: name(token), id: token.id.slice(0, 8) })" @click="askRevoke(token)">{{ t('settings.extension.revoke') }}</button>
            </div>
            <details class="mt-2 text-slate-600"><summary>{{ t('settings.extension.extension_info') }}</summary><p class="break-all font-mono text-xs">{{ token.extension_origin }}</p><p class="mt-2 break-all text-xs">{{ token.id }}</p><p class="mt-2 text-xs">{{ t('settings.extension.token_expires', { date: date(token.expires_at) }) }}</p></details>
          </li>
        </ul>
      </section>
    </template>
    <dialog ref="dialog" aria-labelledby="extension-revoke-title" aria-describedby="extension-revoke-description" @cancel="busy && $event.preventDefault()" @close="revokeTarget = null">
      <h3 id="extension-revoke-title" class="text-lg font-semibold">{{ t('settings.extension.revoke_title') }}</h3>
      <p id="extension-revoke-description" class="mt-3 text-sm leading-6">{{ t('settings.extension.revoke_confirm', { name: revokeTarget ? name(revokeTarget) : '', id: revokeTarget?.id.slice(0, 8) }) }}</p>
      <div class="mt-5 flex flex-wrap justify-end gap-2"><button type="button" class="secondary" :disabled="busy" autofocus @click="dialog?.close()">{{ t('common.cancel') }}</button><button type="button" class="danger" :disabled="busy" @click="revoke">{{ t(busy ? 'common.processing' : 'settings.extension.revoke') }}</button></div>
    </dialog>
  </div>
</template>

<style scoped>
.extension-connections button { min-height:44px;padding:8px 14px;border-radius:10px;font-size:14px;font-weight:600; }
.extension-connections{font-size:16px;line-height:1.6}.extension-connections .text-xs{font-size:14px}.device-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:12px}.device-grid li{min-width:0}.extension-connections :is(button,input,summary){scroll-margin-block:24px}.extension-connections input{font-size:16px}
.primary { background:#1e40af;color:#fff;border:1px solid #1e40af; }.primary:hover { background:#1e3a8a; }
.secondary { background:#fff;color:#334155;border:1px solid #cbd5e1; }.secondary:hover { background:#f8fafc; }
.danger { background:#fff;color:#b91c1c;border:1px solid #fecaca; }.danger:hover { background:#fef2f2; }
button:disabled { opacity:.6;cursor:wait; }button:focus-visible,input:focus-visible,summary:focus-visible { outline:3px solid #2563eb;outline-offset:3px; }
input { display:block;width:100%;max-width:480px;min-height:44px;padding:8px 12px;border:1px solid #94a3b8;border-radius:8px;background:#fff;color:#0f172a; }
summary { min-height:44px;display:list-item;padding:12px 0;cursor:pointer;font-size:14px; }
dialog { margin:auto;width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid #cbd5e1;border-radius:16px;padding:24px;color:#0f172a; }
dialog::backdrop { background:rgb(15 23 42 / .5); }
</style>
