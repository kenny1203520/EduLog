<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import ModelPicker from '@/components/settings/ai/ModelPicker.vue'
import { useFeedback } from '@/composables/useFeedback'
import { AiSettingsService, type AiCredentialDTO, type AiModelDTO } from '@/services/ai/AiSettingsService'

/**
 * Credentials with their models, for personal (`mode="personal"`) or site
 * (`mode="site"`) settings. Secrets are never shown: only the masked hint.
 */
const props = defineProps<{ mode: 'personal' | 'site', defaultModelId?: string | null }>()
const emit = defineEmits<{ (e: 'set-default', modelId: string | null): void }>()
const credentials = defineModel<AiCredentialDTO[]>({ required: true })
const { t } = useI18n()
const { reportError, success } = useFeedback()

const busy = ref<string | null>(null)
const testResult = ref<Record<string, 'ok' | 'failed'>>({})
const replacing = ref<Record<string, string>>({})
const newModel = reactive<Record<string, { model_id: string, display_name: string, quota_weight: number, price_input_per_mtok: string, price_output_per_mtok: string }>>({})
const pendingDelete = ref<{ kind: 'credential' | 'model', id: string, label: string } | null>(null)

const site = props.mode === 'site'

type ModelEdit = { display_name: string, quota_weight: number, price_input_per_mtok: string, price_output_per_mtok: string }
const editingId = ref<string | null>(null)
const editDraft = reactive<ModelEdit>({ display_name: '', quota_weight: 1, price_input_per_mtok: '', price_output_per_mtok: '' })
const pickers = ref<Record<string, { reset: () => void } | null>>({})

const priceString = (value: number | string | null | undefined) => (value == null || value === '' ? '' : String(value))
const priceValue = (value: string | number) => (value === '' || value == null ? null : Number(value))
/** No price means the cost is unknown, not free. */
const isUnpriced = (model: AiModelDTO) => site && (model.price_input_per_mtok == null || model.price_output_per_mtok == null)
const isFree = (model: AiModelDTO) => site && !isUnpriced(model) && Number(model.price_input_per_mtok) === 0 && Number(model.price_output_per_mtok) === 0

function replaceModel(credentialId: string, updated: AiModelDTO) {
    credentials.value = credentials.value.map((item) => item.id === credentialId ? { ...item, models: item.models.map((m) => m.id === updated.id ? updated : m) } : item)
}

function onPick(credentialId: string, picked: { id: string, name: string, priceInputPerMtok?: number, priceOutputPerMtok?: number } | null) {
    const draft = draftFor(credentialId)
    draft.model_id = picked?.id ?? ''
    draft.display_name = picked?.name ?? ''
    if (site && picked) {
        draft.price_input_per_mtok = priceString(picked.priceInputPerMtok)
        draft.price_output_per_mtok = priceString(picked.priceOutputPerMtok)
    }
}

function startEdit(model: AiModelDTO) {
    editingId.value = model.id
    Object.assign(editDraft, {
        display_name: model.display_name,
        quota_weight: Number(model.quota_weight) || 0,
        price_input_per_mtok: priceString(model.price_input_per_mtok),
        price_output_per_mtok: priceString(model.price_output_per_mtok),
    })
}

async function saveEdit(credential: AiCredentialDTO, model: AiModelDTO) {
    if (!editDraft.display_name.trim()) return
    await run(`model-edit:${model.id}`, async () => {
        const updated = site
            ? await AiSettingsService.updateSiteModel(model.id, {
                display_name: editDraft.display_name.trim(),
                quota_weight: Number(editDraft.quota_weight) || 0,
                price_input_per_mtok: priceValue(editDraft.price_input_per_mtok),
                price_output_per_mtok: priceValue(editDraft.price_output_per_mtok),
            })
            : await AiSettingsService.updateMyModel(model.id, { display_name: editDraft.display_name.trim() })
        replaceModel(credential.id, updated)
        editingId.value = null
        success('ai.settings.saved')
    })
}

async function setFree(credential: AiCredentialDTO, model: AiModelDTO) {
    await run(`model-free:${model.id}`, async () => {
        replaceModel(credential.id, await AiSettingsService.updateSiteModel(model.id, { price_input_per_mtok: 0, price_output_per_mtok: 0 }))
    })
}

function draftFor(credentialId: string) {
    return (newModel[credentialId] ??= { model_id: '', display_name: '', quota_weight: 1, price_input_per_mtok: '', price_output_per_mtok: '' })
}

async function run(key: string, work: () => Promise<void>) {
    busy.value = key
    try { await work() } catch (error) { reportError(error) } finally { busy.value = null }
}

function replaceCredential(updated: AiCredentialDTO) {
    credentials.value = credentials.value.map((item) => item.id === updated.id ? { ...updated, models: item.models } : item)
}

async function test(credential: AiCredentialDTO) {
    const model = credential.models[0]
    if (!model) return
    await run(`test:${credential.id}`, async () => {
        const result = site
            ? await AiSettingsService.testSiteCredential(credential.id, model.model_id)
            : await AiSettingsService.testMyCredential(credential.id, model.model_id)
        testResult.value = { ...testResult.value, [credential.id]: result.ok ? 'ok' : 'failed' }
        replaceCredential({ ...credential, status: result.ok ? 'active' : 'invalid', last_verified_at: result.ok ? new Date().toISOString() : credential.last_verified_at })
    })
}

async function toggle(credential: AiCredentialDTO) {
    const status = credential.status === 'disabled' ? 'active' : 'disabled'
    await run(`toggle:${credential.id}`, async () => {
        replaceCredential(site
            ? await AiSettingsService.updateSiteCredential(credential.id, { status })
            : await AiSettingsService.updateMyCredential(credential.id, { status }))
    })
}

async function saveSecret(credential: AiCredentialDTO) {
    const secret = replacing.value[credential.id]?.trim()
    if (!secret) return
    await run(`secret:${credential.id}`, async () => {
        replaceCredential(site
            ? await AiSettingsService.updateSiteCredential(credential.id, { secret })
            : await AiSettingsService.updateMyCredential(credential.id, { secret }))
        const { [credential.id]: _removed, ...rest } = replacing.value
        replacing.value = rest
        success('ai.settings.saved')
    })
}

async function addModel(credential: AiCredentialDTO) {
    const draft = draftFor(credential.id)
    if (!draft.model_id.trim()) return
    const input = { model_id: draft.model_id.trim(), display_name: draft.display_name.trim() || draft.model_id.trim() }
    await run(`model:${credential.id}`, async () => {
        const model: AiModelDTO = site
            ? await AiSettingsService.addSiteModel(credential.id, {
                ...input,
                quota_weight: Number(draft.quota_weight) || 0,
                price_input_per_mtok: draft.price_input_per_mtok === '' ? null : Number(draft.price_input_per_mtok),
                price_output_per_mtok: draft.price_output_per_mtok === '' ? null : Number(draft.price_output_per_mtok),
            })
            : await AiSettingsService.addMyModel(credential.id, input)
        credentials.value = credentials.value.map((item) => item.id === credential.id ? { ...item, models: [...item.models, model] } : item)
        newModel[credential.id] = { model_id: '', display_name: '', quota_weight: 1, price_input_per_mtok: '', price_output_per_mtok: '' }
        pickers.value[credential.id]?.reset()
    })
}

async function toggleModel(credential: AiCredentialDTO, model: AiModelDTO) {
    await run(`model-toggle:${model.id}`, async () => {
        const updated = site
            ? await AiSettingsService.updateSiteModel(model.id, { enabled: !model.enabled })
            : await AiSettingsService.updateMyModel(model.id, { enabled: !model.enabled })
        replaceModel(credential.id, updated)
    })
}

async function confirmDelete() {
    const target = pendingDelete.value
    if (!target) return
    await run(`delete:${target.id}`, async () => {
        if (target.kind === 'credential') {
            await (site ? AiSettingsService.deleteSiteCredential(target.id) : AiSettingsService.deleteMyCredential(target.id))
            credentials.value = credentials.value.filter((item) => item.id !== target.id)
        } else {
            await (site ? AiSettingsService.deleteSiteModel(target.id) : AiSettingsService.deleteMyModel(target.id))
            credentials.value = credentials.value.map((item) => ({ ...item, models: item.models.filter((model) => model.id !== target.id) }))
        }
    })
    pendingDelete.value = null
}

const statusClass: Record<AiCredentialDTO['status'], string> = {
    active: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    invalid: 'bg-red-50 text-red-800 ring-red-200',
    disabled: 'bg-gray-100 text-gray-700 ring-gray-200',
}
</script>

<template>
    <div class="space-y-4">
        <p v-if="!credentials.length" class="rounded-2xl border border-dashed border-gray-300 p-5 text-sm text-gray-600">{{ t('ai.settings.no_credentials') }}</p>
        <article v-for="credential in credentials" :key="credential.id" class="rounded-2xl border border-gray-200 bg-white p-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                    <h4 class="flex flex-wrap items-center gap-2 font-black text-gray-900">
                        {{ credential.label }}
                        <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-700">{{ t(`ai.providers.${credential.provider}`) }}</span>
                        <span class="rounded-full px-2 py-0.5 text-xs font-bold ring-1" :class="statusClass[credential.status]">{{ t(`ai.settings.status.${credential.status}`) }}</span>
                    </h4>
                    <p class="mt-1 text-sm text-gray-600">
                        <template v-if="credential.auth_type === 'oauth'">{{ t('ai.settings.oauth_connected') }}</template>
                        <template v-else-if="credential.secret_hint">{{ t('ai.settings.key_hint', { hint: credential.secret_hint }) }}</template>
                        <template v-if="credential.base_url"> · {{ credential.base_url }}</template>
                    </p>
                    <p v-if="testResult[credential.id]" role="status" class="mt-1 text-sm font-bold" :class="testResult[credential.id] === 'ok' ? 'text-emerald-700' : 'text-red-700'">
                        {{ testResult[credential.id] === 'ok' ? t('ai.settings.test_ok') : t('ai.settings.test_failed') }}
                    </p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button type="button" class="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        :disabled="!credential.models.length || busy !== null" :title="credential.models.length ? '' : t('ai.settings.test_needs_model')" @click="test(credential)">
                        {{ busy === `test:${credential.id}` ? t('ai.settings.testing') : t('ai.settings.test') }}
                    </button>
                    <button type="button" class="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50" :disabled="busy !== null" @click="toggle(credential)">
                        {{ credential.status === 'disabled' ? t('ai.settings.enable') : t('ai.settings.disable') }}
                    </button>
                    <button type="button" class="min-h-11 rounded-xl border border-red-200 px-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50" :disabled="busy !== null"
                        @click="pendingDelete = { kind: 'credential', id: credential.id, label: credential.label }">{{ t('ai.settings.delete') }}</button>
                </div>
            </div>

            <form v-if="credential.auth_type === 'api_key'" class="mt-3 flex flex-wrap gap-2" @submit.prevent="saveSecret(credential)">
                <label class="sr-only" :for="`replace-${credential.id}`">{{ t('ai.settings.replace_key') }}</label>
                <input :id="`replace-${credential.id}`" v-model="replacing[credential.id]" type="password" autocomplete="off" maxlength="4096"
                    class="min-h-11 min-w-0 flex-1 rounded-xl border border-gray-200 px-3 text-sm" :placeholder="t('ai.settings.replace_key')" />
                <button type="submit" class="min-h-11 rounded-xl bg-gray-800 px-3 text-sm font-bold text-white disabled:opacity-50" :disabled="!replacing[credential.id] || busy !== null">{{ t('ai.settings.save') }}</button>
            </form>

            <div class="mt-4 border-t border-gray-100 pt-4">
                <h5 class="text-sm font-black text-gray-800">{{ t('ai.settings.models') }}</h5>
                <ul class="mt-2 space-y-2">
                    <li v-for="model in credential.models" :key="model.id" class="rounded-xl bg-gray-50 px-3 py-2 text-sm">
                        <form v-if="editingId === model.id" class="grid gap-2 py-1" :class="site ? 'sm:grid-cols-[1fr_6rem_7rem_7rem]' : ''"
                            :aria-label="t('ai.settings.edit_model', { name: model.display_name })" @submit.prevent="saveEdit(credential, model)" @keydown.esc="editingId = null">
                            <label class="block text-xs font-bold text-gray-700">{{ t('ai.settings.display_name') }}
                                <input v-model="editDraft.display_name" required maxlength="120" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm" />
                            </label>
                            <template v-if="site">
                                <label class="block text-xs font-bold text-gray-700">{{ t('ai.settings.quota_weight') }}
                                    <input v-model.number="editDraft.quota_weight" type="number" min="0" step="0.5" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm" />
                                </label>
                                <label class="block text-xs font-bold text-gray-700">{{ t('ai.settings.price_input') }}
                                    <input v-model="editDraft.price_input_per_mtok" type="number" min="0" step="0.01" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm" :placeholder="t('ai.settings.unpriced')" />
                                </label>
                                <label class="block text-xs font-bold text-gray-700">{{ t('ai.settings.price_output') }}
                                    <input v-model="editDraft.price_output_per_mtok" type="number" min="0" step="0.01" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm" :placeholder="t('ai.settings.unpriced')" />
                                </label>
                            </template>
                            <p class="text-xs text-gray-600" :class="site ? 'sm:col-span-4' : ''">{{ t('ai.settings.model_id_fixed', { id: model.model_id }) }}</p>
                            <div class="flex flex-wrap gap-2" :class="site ? 'sm:col-span-4' : ''">
                                <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50" :disabled="busy !== null || !editDraft.display_name.trim()">
                                    {{ busy === `model-edit:${model.id}` ? t('common.saving') : t('ai.settings.save') }}
                                </button>
                                <button type="button" class="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50" @click="editingId = null">{{ t('common.cancel') }}</button>
                            </div>
                        </form>
                        <div v-else class="flex flex-wrap items-center justify-between gap-2">
                            <span class="min-w-0">
                                <span class="font-bold text-gray-900">{{ model.display_name }}</span>
                                <span class="ml-1 text-gray-600">{{ model.model_id }}</span>
                                <span v-if="site && defaultModelId === model.id" class="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">{{ t('ai.settings.default_badge') }}</span>
                                <span v-if="isUnpriced(model)" class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">{{ t('ai.settings.unpriced') }}</span>
                                <span v-else-if="isFree(model)" class="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-900">{{ t('ai.settings.free') }}</span>
                                <span v-if="model.supports_structured_output === false" class="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-700" :title="t('ai.settings.compat_mode_hint')">{{ t('ai.settings.compat_mode') }}</span>
                                <span v-if="site" class="ml-2 text-xs text-gray-600">{{ t('ai.settings.model_meta', { weight: model.quota_weight, input: model.price_input_per_mtok ?? '—', output: model.price_output_per_mtok ?? '—' }) }}</span>
                            </span>
                            <span class="flex flex-wrap gap-1">
                                <button type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold text-gray-700 hover:bg-gray-100" @click="startEdit(model)">{{ t('ai.settings.edit') }}</button>
                                <button v-if="isUnpriced(model)" type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold text-sky-800 hover:bg-sky-50" :disabled="busy !== null" @click="setFree(credential, model)">{{ t('ai.settings.set_free') }}</button>
                                <button v-if="site && defaultModelId !== model.id" type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50" @click="emit('set-default', model.id)">{{ t('ai.settings.set_default') }}</button>
                                <button type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold text-gray-700 hover:bg-gray-100" :aria-pressed="model.enabled" @click="toggleModel(credential, model)">
                                    {{ model.enabled ? t('ai.settings.model_enabled') : t('ai.settings.model_disabled') }}
                                </button>
                                <button type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50"
                                    @click="pendingDelete = { kind: 'model', id: model.id, label: model.display_name }">{{ t('ai.settings.delete') }}</button>
                            </span>
                        </div>
                    </li>
                </ul>
                <form class="mt-3 space-y-2 rounded-xl border border-dashed border-gray-300 p-3" @submit.prevent="addModel(credential)">
                    <p class="text-xs font-bold text-gray-700">{{ t('ai.settings.add_model') }}</p>
                    <ModelPicker :ref="(el) => { pickers[credential.id] = el as unknown as { reset: () => void } | null }" :scope="mode" :credential-id="credential.id"
                        @pick="onPick(credential.id, $event)" />
                    <div class="grid gap-2" :class="site ? 'sm:grid-cols-[1fr_5rem_6rem_6rem_auto]' : 'sm:grid-cols-[1fr_auto]'">
                        <input v-model="draftFor(credential.id).display_name" maxlength="120" class="min-h-11 rounded-xl border border-gray-200 px-3 text-sm" :placeholder="t('ai.settings.display_name')" :aria-label="t('ai.settings.display_name')" />
                        <template v-if="site">
                            <input v-model.number="draftFor(credential.id).quota_weight" type="number" min="0" step="0.5" class="min-h-11 rounded-xl border border-gray-200 px-3 text-sm" :aria-label="t('ai.settings.quota_weight')" :title="t('ai.settings.quota_weight')" />
                            <input v-model="draftFor(credential.id).price_input_per_mtok" type="number" min="0" step="0.01" class="min-h-11 rounded-xl border border-gray-200 px-3 text-sm" :placeholder="t('ai.settings.price_input')" :aria-label="t('ai.settings.price_input')" />
                            <input v-model="draftFor(credential.id).price_output_per_mtok" type="number" min="0" step="0.01" class="min-h-11 rounded-xl border border-gray-200 px-3 text-sm" :placeholder="t('ai.settings.price_output')" :aria-label="t('ai.settings.price_output')" />
                        </template>
                        <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50" :disabled="busy !== null || !draftFor(credential.id).model_id">{{ t('ai.settings.add_model') }}</button>
                    </div>
                    <p v-if="site" class="text-xs text-gray-600">{{ t('ai.settings.price_hint') }}</p>
                </form>
            </div>
        </article>

        <ConfirmModal :is-open="pendingDelete !== null" is-dangerous :title="t('ai.settings.delete_title', { name: pendingDelete?.label ?? '' })"
            :message="pendingDelete?.kind === 'credential' ? t('ai.settings.delete_credential_message') : t('ai.settings.delete_model_message')"
            :confirm-text="t('ai.settings.delete')" :is-loading="busy?.startsWith('delete:')" @confirm="confirmDelete" @close="pendingDelete = null" />
    </div>
</template>
