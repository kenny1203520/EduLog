<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import PasswordInput from '@/components/ui/PasswordInput.vue'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { copyToClipboard } from '@/utils/clipboard'
import { providerLabel } from '@/utils/oauthProviders'
import ProviderIcon from './security/ProviderIcon.vue'
import MethodIcon from './security/MethodIcon.vue'
import { ui } from './security/styles'

type ProviderType = 'oidc' | 'oauth2'
type CustomProvider = { identifier: string; name: string; provider_type: ProviderType; enabled: boolean }
type ProviderStatus = {
    enabled: boolean
    builtin: Array<{ identifier: string; enabled: boolean }> | null
    custom: CustomProvider[] | null
    callback_url: string
}
type Action = 'enable' | 'disable' | 'rotate_secret'

const endpoint = '/auth/provider-admin'
const inputClass = ui.input
const buttonClass = ui.secondary
const initialDraft = () => ({
    provider_type: 'oidc' as ProviderType,
    identifier: '', name: '', client_id: '', client_secret: '',
    issuer: '', discovery_url: '', authorization_url: '', token_url: '', userinfo_url: '',
})
const info = ref<ProviderStatus>()
const draft = ref(initialDraft())
const operation = ref<{ id: string; action: Action }>()
const confirmed = ref(false)
const replacement = ref('')
const loading = ref(false)
const saving = ref(false)
const failed = ref(false)
const error = ref('')
const notice = ref('')
const actionForm = ref<HTMLFormElement>()
const callbackField = ref<HTMLInputElement>()
const activeBuiltIn = computed(() => info.value?.builtin?.filter(item => item.enabled) ?? [])
const failedSection = computed(() => info.value?.builtin === null || (info.value?.enabled && info.value.custom === null))

async function load() {
    loading.value = true
    failed.value = false
    try {
        info.value = (await apiV1Client.get<ProviderStatus>(endpoint)).data
    } catch {
        failed.value = true
    } finally {
        loading.value = false
    }
}

const errorKeys: Record<string, string> = {
    RECENT_AUTHENTICATION_REQUIRED: 'recent_auth',
    AUTH_PROVIDER_ORIGIN_BLOCKED: 'origin_blocked',
    AUTH_PROVIDER_URL_INVALID: 'url_invalid',
    AUTH_PROVIDER_DISCOVERY_INVALID: 'discovery_invalid',
    AUTH_PROVIDER_ISSUER_MISMATCH: 'issuer_mismatch',
    AUTH_PROVIDER_CONFLICT: 'conflict',
    AUTH_PROVIDER_ADMIN_DISABLED: 'disabled_hint',
    AUTH_PROVIDER_REJECTED: 'rejected',
}

function showError(cause: unknown) {
    const code = (cause as { code?: string })?.code
    error.value = errorKeys[code ?? ''] ?? 'save_failed'
}

async function saveDraft() {
    error.value = ''
    notice.value = ''
    const fields = draft.value
    if (fields.provider_type === 'oidc' && !fields.issuer.trim() && !fields.discovery_url.trim()) {
        error.value = 'issuer_required'
        return
    }
    saving.value = true
    try {
        const base = {
            provider_type: fields.provider_type, identifier: 'custom:' + fields.identifier.trim(),
            name: fields.name, client_id: fields.client_id, client_secret: fields.client_secret,
        }
        const endpoints = fields.provider_type === 'oidc' ? {
            issuer: fields.issuer.trim() || undefined, discovery_url: fields.discovery_url.trim() || undefined,
        } : {
            authorization_url: fields.authorization_url.trim(), token_url: fields.token_url.trim(),
            userinfo_url: fields.userinfo_url.trim(),
        }
        await apiV1Client.post(endpoint, { ...base, ...endpoints })
        draft.value = initialDraft()
        notice.value = 'draft_saved'
        await load()
    } catch (cause) {
        showError(cause)
        draft.value.client_secret = ''
    } finally {
        saving.value = false
    }
}

function cancelAction() {
    operation.value = undefined
    replacement.value = ''
    confirmed.value = false
}

async function selectAction(id: string, action: Action) {
    cancelAction()
    error.value = ''
    notice.value = ''
    operation.value = { id, action }
    await nextTick()
    actionForm.value?.querySelector<HTMLElement>('input, button')?.focus()
}

async function updateProvider() {
    if (!operation.value) return
    const { id, action } = operation.value
    const fields = action === 'enable' ? { callback_confirmed: confirmed.value }
        : action === 'rotate_secret' ? { client_secret: replacement.value } : {}
    saving.value = true
    error.value = ''
    notice.value = ''
    try {
        await apiV1Client.patch(endpoint + '/' + encodeURIComponent(id), { action, ...fields })
        cancelAction()
        notice.value = 'updated'
        await load()
    } catch (cause) {
        showError(cause)
        replacement.value = ''
    } finally {
        saving.value = false
    }
}

async function copyCallback() {
    if (!info.value) return
    if (await copyToClipboard(info.value.callback_url)) notice.value = 'copied'
    else {
        callbackField.value?.focus()
        callbackField.value?.select()
        notice.value = 'copy_manually'
    }
}
onMounted(load)
</script>

<template>
    <section :class="ui.card" class="space-y-6" aria-labelledby="login-providers-title" :aria-busy="loading || saving">
        <div>
            <h3 id="login-providers-title" class="text-xl font-black">{{ $t('settings.login_providers.title') }}</h3>
            <p class="mt-1 text-sm text-gray-600">{{ $t('settings.login_providers.description') }}</p>
        </div>
        <div v-if="loading && !info" class="space-y-3" aria-hidden="true">
            <div v-for="index in 2" :key="index" class="h-16 animate-pulse rounded-2xl bg-gray-100 motion-reduce:animate-none" />
        </div>
        <p v-if="loading" role="status" class="sr-only">{{ $t('common.loading') }}</p>
        <div v-if="failed || failedSection" :class="ui.alert">
            <p role="alert" class="flex-1">{{ $t('settings.login_providers.load_failed') }}</p>
            <button type="button" :class="buttonClass" :disabled="loading" @click="load">{{ $t('settings.login_providers.retry') }}</button>
        </div>
        <template v-if="info">
            <div v-if="info.builtin !== null" class="space-y-2">
                <h4 class="font-black">{{ $t('settings.login_providers.builtin') }}</h4>
                <p v-if="!activeBuiltIn.length" class="rounded-2xl border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-600">{{ $t('settings.login_providers.no_builtin') }}</p>
                <ul v-else class="flex flex-wrap gap-2">
                    <li v-for="provider in activeBuiltIn" :key="provider.identifier" class="inline-flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm font-bold text-gray-900 shadow-sm">
                        <ProviderIcon :provider="provider.identifier" />
                        <span translate="no">{{ providerLabel(provider.identifier) }}</span>
                        <span class="sr-only">{{ $t('settings.login_providers.enabled') }}</span>
                    </li>
                </ul>
            </div>

            <div v-if="!info.enabled" role="status" class="flex items-start gap-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-5">
                <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500"><MethodIcon name="shield" /></span>
                <div class="min-w-0 text-sm">
                    <p class="font-bold text-gray-800">{{ $t('settings.login_providers.disabled_hint') }}</p>
                    <p class="mt-1 text-gray-600">{{ $t('settings.login_providers.enable_hint') }} <code translate="no" class="break-all rounded bg-white px-1.5 py-0.5 font-mono text-xs">EDULOG_AUTH_PROVIDER_ADMIN_ENABLED=true</code></p>
                </div>
            </div>
            <template v-else>
                <div>
                    <label for="provider-callback" :class="ui.label">{{ $t('settings.login_providers.callback') }}</label>
                    <div class="flex flex-wrap items-end gap-2">
                        <input id="provider-callback" ref="callbackField" dir="ltr" :value="info.callback_url" readonly :class="inputClass" class="flex-1" />
                        <button type="button" :class="buttonClass" @click="copyCallback">{{ $t('settings.login_providers.copy') }}</button>
                    </div>
                </div>

                <p v-if="error" role="alert" :class="ui.alert">{{ $t('settings.login_providers.' + error) }}</p>
                <p role="status" class="text-sm font-bold text-emerald-800">{{ notice ? $t('settings.login_providers.' + notice) : '' }}</p>

                <ul v-if="info.custom?.length" class="space-y-3" :aria-label="$t('settings.login_providers.custom_list')">
                    <li v-for="provider in info.custom" :key="provider.identifier" class="space-y-3 rounded-2xl border border-gray-100 p-4">
                        <div class="flex flex-wrap items-center gap-3">
                            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-white"><ProviderIcon :provider="provider.identifier" /></span>
                            <div class="min-w-0 flex-1">
                                <strong class="font-black">{{ provider.name }}</strong>
                                <p class="text-xs text-gray-500" translate="no">{{ provider.identifier }}</p>
                            </div>
                            <span class="rounded-full px-2 py-0.5 text-xs font-black" :class="provider.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'">{{ provider.enabled ? $t('settings.login_providers.enabled') : $t('settings.login_providers.disabled') }}</span>
                        </div>
                        <div v-if="operation?.id !== provider.identifier" class="flex flex-wrap gap-2">
                            <button type="button" :class="buttonClass" :disabled="saving" @click="selectAction(provider.identifier, provider.enabled ? 'disable' : 'enable')">
                                {{ provider.enabled ? $t('settings.login_providers.disable') : $t('settings.login_providers.enable') }}
                            </button>
                            <button type="button" :class="buttonClass" :disabled="saving" @click="selectAction(provider.identifier, 'rotate_secret')">
                                {{ $t('settings.login_providers.rotate_secret') }}
                            </button>
                        </div>
                        <form v-else :ref="el => actionForm = (el as HTMLFormElement | undefined)" class="space-y-3" @submit.prevent="updateProvider">
                            <label v-if="operation.action === 'enable'" class="flex items-start gap-2 text-sm">
                                <input v-model="confirmed" type="checkbox" class="mt-0.5" required />
                                {{ $t('settings.login_providers.confirm_callback') }}
                            </label>
                            <label v-else-if="operation.action === 'rotate_secret'" for="provider-replacement" class="block text-sm font-bold">
                                {{ $t('settings.login_providers.new_secret') }}
                                <PasswordInput id="provider-replacement" v-model="replacement" purpose="new" required :maxlength="2048" :input-class="inputClass" />
                            </label>
                            <p v-else class="text-sm">{{ $t('settings.login_providers.confirm_disable') }}</p>
                            <div class="flex flex-wrap gap-2">
                                <button type="submit" :class="buttonClass" :disabled="saving">{{ $t('settings.login_providers.' + operation.action) }}</button>
                                <button type="button" :class="buttonClass" :disabled="saving" @click="cancelAction">{{ $t('common.cancel') }}</button>
                            </div>
                        </form>
                    </li>
                </ul>
                <p v-else-if="info.custom" class="rounded-2xl border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-600">{{ $t('settings.login_providers.no_custom') }}</p>

                <form class="space-y-4 rounded-2xl border border-gray-100 bg-gray-50/50 p-5" @submit.prevent="saveDraft">
                    <h4 class="font-black">{{ $t('settings.login_providers.add') }}</h4>
                    <fieldset class="grid gap-3 md:grid-cols-2" :disabled="saving">
                        <label class="text-sm font-bold text-gray-700">
                            {{ $t('settings.login_providers.type') }}
                            <select v-model="draft.provider_type" :class="inputClass">
                                <option value="oidc">OpenID Connect (OIDC)</option>
                                <option value="oauth2">OAuth 2.0</option>
                            </select>
                        </label>
                        <label class="text-sm font-bold text-gray-700">
                            {{ $t('settings.login_providers.name') }}
                            <input v-model.trim="draft.name" required maxlength="100" :class="inputClass" />
                        </label>
                        <label class="text-sm font-bold text-gray-700">
                            {{ $t('settings.login_providers.identifier') }}
                            <span class="block font-normal text-slate-700">{{ $t('settings.login_providers.identifier_hint') }}</span>
                            <input v-model.trim="draft.identifier" dir="ltr" autocapitalize="none" spellcheck="false" required minlength="2" maxlength="43" pattern="[a-z0-9:\-]{2,43}" :class="inputClass" />
                        </label>
                        <label class="text-sm font-bold text-gray-700">
                            {{ $t('settings.login_providers.client_id') }}
                            <input v-model.trim="draft.client_id" dir="ltr" spellcheck="false" required maxlength="512" :class="inputClass" />
                        </label>
                        <label for="provider-draft-secret" class="text-sm font-bold text-gray-700">
                            {{ $t('settings.login_providers.client_secret') }}
                            <PasswordInput id="provider-draft-secret" v-model="draft.client_secret" purpose="new" required :maxlength="2048" :input-class="inputClass" />
                        </label>
                        <template v-if="draft.provider_type === 'oidc'">
                            <label v-for="key in (['issuer', 'discovery_url'] as const)" :key="key" class="text-sm font-bold text-gray-700">
                                {{ $t('settings.login_providers.' + key) }}
                                <input v-model.trim="draft[key]" dir="ltr" type="url" inputmode="url" maxlength="2048" :class="inputClass" />
                            </label>
                        </template>
                        <label v-for="key in (draft.provider_type === 'oauth2' ? (['authorization_url', 'token_url', 'userinfo_url'] as const) : [])" :key="key" class="text-sm font-bold text-gray-700">
                            {{ $t('settings.login_providers.' + key) }}
                            <input v-model.trim="draft[key]" dir="ltr" type="url" inputmode="url" required maxlength="2048" :class="inputClass" />
                        </label>
                    </fieldset>
                    <button type="submit" :class="ui.primary" :disabled="saving">{{ $t('settings.login_providers.save_draft') }}</button>
                </form>
            </template>
        </template>
    </section>
</template>
