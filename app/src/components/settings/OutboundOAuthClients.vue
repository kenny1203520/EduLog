<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import { outboundOAuthService, type OAuthClient } from '@/services/auth/OutboundOAuthService'
import AppDialog from '@/components/ui/AppDialog.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import AuthMethodRow from './security/AuthMethodRow.vue'
import MethodIcon from './security/MethodIcon.vue'
import { ui } from './security/styles'
import { copyToClipboard } from '@/utils/clipboard'

const { t } = useI18n()
const pageSize = 50
const page = ref(1)
const apps = ref<OAuthClient[]>([])
const loaded = ref(false)
const busy = ref(false)
const problem = ref('')
const disabled = ref(false)
const registering = ref(false)
const removing = ref<OAuthClient>()
const newName = ref('')
const callbacks = ref('')
const formProblem = ref('')
const issued = ref<{ client_id: string; client_secret: string }>()
const secretSaved = ref(false)
const copied = ref('')
const nameId = useId()
const callbacksId = useId()
const callbackList = computed(() => callbacks.value.split('\n').map(uri => uri.trim()).filter(Boolean))

/** Maps API failures to a message; a missing GoTrue OAuth endpoint means the auth service was not restarted with the flag. */
function problemFor(error: unknown) {
    if (error instanceof ApiV1Error && error.code === 'OAUTH_SERVER_DISABLED') { disabled.value = true; return '' }
    if (error instanceof ApiV1Error && error.status === 422) return 'invalid_settings'
    if (error instanceof ApiV1Error && (error.code.includes('REAUTH') || error.code === 'RECENT_AUTHENTICATION_REQUIRED')) return 'reauth'
    if (error instanceof ApiV1Error && error.code === 'OAUTH_REQUEST_NOT_FOUND') return 'server_not_ready'
    return 'unavailable'
}

async function load(target = page.value) {
    if (busy.value) return
    busy.value = true
    problem.value = ''
    try {
        apps.value = await outboundOAuthService.clients(target)
        page.value = target
    } catch (error) { problem.value = problemFor(error) }
    finally { busy.value = false; loaded.value = true }
}
onMounted(() => load())

function openRegister() {
    newName.value = ''
    callbacks.value = ''
    formProblem.value = ''
    issued.value = undefined
    secretSaved.value = false
    registering.value = true
}
function closeRegister() {
    if (issued.value && !secretSaved.value) return
    const created = Boolean(issued.value)
    registering.value = false
    issued.value = undefined
    if (created) void load(1)
}
function validCallbacks() {
    return callbackList.value.length > 0 && callbackList.value.every(uri => {
        try { return new URL(uri).protocol === 'https:' } catch { return false }
    })
}
async function register() {
    if (busy.value) return
    formProblem.value = ''
    if (!validCallbacks()) { formProblem.value = 'invalid_settings'; return }
    busy.value = true
    try {
        issued.value = await outboundOAuthService.register(newName.value, callbackList.value)
    } catch (error) { formProblem.value = problemFor(error) || 'unavailable' }
    finally { busy.value = false }
}
async function copy(kind: 'client_id' | 'client_secret') {
    if (issued.value && await copyToClipboard(issued.value[kind])) copied.value = kind
}
async function remove() {
    const target = removing.value
    if (!target || busy.value) return
    busy.value = true
    problem.value = ''
    try {
        await outboundOAuthService.removeClient(target.client_id)
        apps.value = apps.value.filter(app => app.client_id !== target.client_id)
    } catch (error) { problem.value = problemFor(error) }
    finally {
        busy.value = false
        removing.value = undefined
    }
}
</script>

<template>
    <section :class="ui.card" class="space-y-6" aria-labelledby="oauth-apps-heading" :aria-busy="busy">
        <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
                <h2 id="oauth-apps-heading" class="text-xl font-black">{{ t('oauthServer.apps_title') }}</h2>
                <p class="mt-1 text-sm text-gray-600">{{ t('oauthServer.apps_description') }}</p>
            </div>
            <button v-if="!disabled && loaded" type="button" :class="ui.primary" :disabled="busy" @click="openRegister">
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>
                {{ t('oauthServer.add_app') }}
            </button>
        </div>

        <div v-if="disabled" role="status" class="flex items-start gap-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-5">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500"><MethodIcon name="app" /></span>
            <div class="min-w-0 text-sm">
                <p class="font-bold text-gray-800">{{ t('oauthServer.admin_disabled') }}</p>
                <p class="mt-1 text-gray-600">{{ t('oauthServer.admin_disabled_hint') }} <code translate="no" class="break-all rounded bg-white px-1.5 py-0.5 font-mono text-xs">EDULOG_AUTH_OUTBOUND_OAUTH_ENABLED=true</code></p>
            </div>
        </div>

        <template v-else>
            <div v-if="problem" role="alert" :class="ui.alert">
                <p class="flex-1">{{ t(`oauthServer.${problem}`) }}</p>
                <button v-if="problem !== 'reauth'" type="button" :class="ui.ghost" :disabled="busy" @click="load()">{{ t('oauthServer.retry') }}</button>
            </div>

            <div v-if="!loaded" class="space-y-3" aria-hidden="true">
                <div v-for="index in 2" :key="index" class="h-20 animate-pulse rounded-2xl bg-gray-100 motion-reduce:animate-none" />
            </div>
            <div v-else-if="!apps.length && !problem" class="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-200 px-6 py-10 text-center">
                <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><MethodIcon name="app" /></span>
                <p class="font-bold text-gray-800">{{ t('oauthServer.apps_empty') }}</p>
                <p class="max-w-md text-sm text-gray-600">{{ t('oauthServer.apps_empty_hint') }}</p>
            </div>

            <ul v-if="apps.length" class="space-y-3">
                <li v-for="app in apps" :key="app.client_id">
                    <AuthMethodRow :title="app.client_name" :description="t(`oauthServer.type_${app.client_type}`)">
                        <template #icon><MethodIcon name="app" /></template>
                        <p class="mt-2 break-all font-mono text-xs text-gray-500" translate="no">{{ app.client_id }}</p>
                        <ul class="mt-2 flex flex-wrap gap-1.5" :aria-label="t('oauthServer.callbacks')">
                            <li v-for="uri in app.redirect_uris" :key="uri" class="max-w-full truncate rounded-lg bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700" translate="no">{{ uri }}</li>
                        </ul>
                        <template #actions>
                            <button type="button" :class="ui.danger" :disabled="busy" @click="removing = app">{{ t('oauthServer.remove') }}</button>
                        </template>
                    </AuthMethodRow>
                </li>
            </ul>

            <nav v-if="page > 1 || apps.length === pageSize" class="flex items-center justify-center gap-3" :aria-label="t('oauthServer.apps_title')">
                <button type="button" :class="ui.secondary" :disabled="busy || page === 1" @click="load(page - 1)">{{ t('oauthServer.previous') }}</button>
                <span class="text-sm font-bold text-gray-600">{{ t('oauthServer.page', { page }) }}</span>
                <button type="button" :class="ui.secondary" :disabled="busy || apps.length < pageSize" @click="load(page + 1)">{{ t('oauthServer.next') }}</button>
            </nav>
        </template>

        <AppDialog v-if="registering" open :title="t(issued ? 'oauthServer.registered_title' : 'oauthServer.register_title')"
            :description="issued ? undefined : t('oauthServer.register_description')" :dismissible="!issued || secretSaved" size="lg" @close="closeRegister">
            <form v-if="!issued" class="space-y-4" @submit.prevent="register">
                <div>
                    <label :for="nameId" :class="ui.label">{{ t('oauthServer.app_name') }}</label>
                    <input :id="nameId" v-model="newName" type="text" autofocus required maxlength="120" :disabled="busy" autocomplete="off" :class="ui.input">
                </div>
                <div>
                    <label :for="callbacksId" :class="ui.label">{{ t('oauthServer.callbacks') }}</label>
                    <textarea :id="callbacksId" v-model="callbacks" required rows="3" :disabled="busy" spellcheck="false" placeholder="https://app.example.com/oauth/callback"
                        :class="ui.input" class="font-mono text-sm" />
                    <p class="mt-1 text-xs text-gray-500">{{ t('oauthServer.callbacks_hint') }}</p>
                </div>
                <p v-if="formProblem" role="alert" :class="ui.alert">{{ t(`oauthServer.${formProblem}`) }}</p>
                <div class="flex flex-wrap justify-end gap-2">
                    <button type="button" :class="ui.ghost" :disabled="busy" @click="closeRegister">{{ t('oauthServer.cancel') }}</button>
                    <button type="submit" :class="ui.primary" :disabled="busy">{{ t('oauthServer.register') }}</button>
                </div>
            </form>
            <div v-else class="space-y-4">
                <p role="status" class="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{{ t('oauthServer.copy_secret') }}</p>
                <div v-for="kind in (['client_id', 'client_secret'] as const)" :key="kind">
                    <p :class="ui.label">{{ kind === 'client_id' ? 'Client ID' : 'Client Secret' }}</p>
                    <div class="mt-1 flex flex-wrap items-center gap-2">
                        <code translate="no" class="min-w-0 flex-1 select-all break-all rounded-xl bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900">{{ issued[kind] }}</code>
                        <button type="button" :class="ui.secondary" @click="copy(kind)">{{ t(copied === kind ? 'oauthServer.copied' : 'oauthServer.copy') }}</button>
                    </div>
                </div>
                <label class="flex cursor-pointer items-start gap-3 rounded-2xl border border-gray-100 p-4 text-sm font-bold text-gray-800">
                    <input v-model="secretSaved" type="checkbox" class="mt-0.5 h-5 w-5 cursor-pointer accent-emerald-600">
                    {{ t('oauthServer.secret_saved_confirm') }}
                </label>
                <div class="flex justify-end">
                    <button type="button" :class="ui.primary" :disabled="!secretSaved" @click="closeRegister">{{ t('oauthServer.done') }}</button>
                </div>
            </div>
        </AppDialog>

        <ConfirmModal v-if="removing" :is-open="true" is-dangerous :is-loading="busy" :title="t('oauthServer.remove_title')"
            :message="t('oauthServer.remove_message', { app: removing.client_name })" :confirm-text="t('oauthServer.confirm_remove')"
            @confirm="remove" @close="removing = undefined" />
    </section>
</template>
