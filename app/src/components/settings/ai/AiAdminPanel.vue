<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AiCredentialList from '@/components/settings/ai/AiCredentialList.vue'
import AiQuotaSettings from '@/components/settings/ai/AiQuotaSettings.vue'
import AiUsagePanel from '@/components/settings/ai/AiUsagePanel.vue'
import { useFeedback } from '@/composables/useFeedback'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import { AiSettingsService, SITE_PROVIDERS, type AiAdminOverview, type AiProvider } from '@/services/ai/AiSettingsService'

/** Settings → System → AI: switch, providers and models, prompt, quota, usage and logs. */
const { t } = useI18n()
const { reportError, success } = useFeedback()

type Section = 'general' | 'providers' | 'prompt' | 'quota' | 'usage'
const section = ref<Section>('general')
const overview = ref<AiAdminOverview | null>(null)
const loading = ref(true)
const forbidden = ref(false)
const saving = ref(false)
const credentialForm = reactive<{ provider: AiProvider, label: string, secret: string, base_url: string }>({ provider: 'anthropic', label: '', secret: '', base_url: '' })
const promptDraft = ref('')

const siteModels = computed(() => (overview.value?.credentials ?? []).flatMap((credential) =>
    credential.models.map((model) => ({ id: model.id, label: `${model.display_name}（${credential.label}）` }))))
const activePrompt = computed(() => overview.value?.prompt.versions.find((version) => version.is_active) ?? null)
const credentials = computed({
    get: () => overview.value?.credentials ?? [],
    set: (value) => { if (overview.value) overview.value = { ...overview.value, credentials: value } },
})

async function load() {
    loading.value = true
    try {
        overview.value = await AiSettingsService.overview()
        promptDraft.value = activePrompt.value?.body ?? overview.value.prompt.default_body
    } catch (error) {
        if (error instanceof ApiV1Error && error.status === 403) { forbidden.value = true; section.value = 'usage' } else reportError(error)
    } finally {
        loading.value = false
    }
}

async function save(work: () => Promise<void>) {
    saving.value = true
    try { await work(); success('ai.settings.saved') } catch (error) { reportError(error) } finally { saving.value = false }
}

const saveSettings = (input: Parameters<typeof AiSettingsService.saveSettings>[0]) => save(async () => {
    const settings = await AiSettingsService.saveSettings(input)
    if (overview.value) overview.value = { ...overview.value, settings }
})

const addCredential = () => save(async () => {
    const created = await AiSettingsService.addSiteCredential({
        provider: credentialForm.provider,
        label: credentialForm.label.trim() || t(`ai.providers.${credentialForm.provider}`),
        secret: credentialForm.secret.trim() || undefined,
        base_url: credentialForm.base_url.trim() || null,
    })
    credentials.value = [...credentials.value, { ...created, models: [] }]
    Object.assign(credentialForm, { label: '', secret: '', base_url: '' })
})

const savePrompt = () => save(async () => { await AiSettingsService.savePrompt(promptDraft.value); await load() })
const activatePrompt = (id: string) => save(async () => { await AiSettingsService.activatePrompt(id); await load() })
const resetPrompt = () => save(async () => { await AiSettingsService.resetPrompt(); await load() })

onMounted(load)
</script>

<template>
    <div class="space-y-6">
        <div class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 class="text-xl font-black text-gray-900">{{ t('ai.settings.admin_title') }}</h2>
            <p class="mt-1 text-sm text-gray-600">{{ t('ai.settings.admin_description') }}</p>
            <nav class="mt-5 flex flex-wrap gap-2" role="group" :aria-label="t('ai.settings.admin_title')">
                <button v-for="item in (forbidden ? ['usage'] : ['general', 'providers', 'prompt', 'quota', 'usage']) as Section[]" :key="item" type="button"
                    :aria-pressed="section === item" class="min-h-11 rounded-xl px-4 py-2 text-sm font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    :class="section === item ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'" @click="section = item">
                    {{ t(`ai.settings.sections.${item}`) }}
                </button>
            </nav>
        </div>

        <div v-if="loading" class="h-40 animate-pulse rounded-3xl bg-gray-100 motion-reduce:animate-none" aria-busy="true"></div>

        <template v-else-if="overview">
            <!-- General -->
            <section v-if="section === 'general'" class="space-y-5 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <ul class="grid gap-2 text-sm sm:grid-cols-2">
                    <li class="rounded-xl px-4 py-3 font-bold" :class="overview.deidentification_available ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'">
                        {{ overview.deidentification_available ? t('ai.settings.presidio_ok') : t('ai.settings.presidio_missing') }}
                    </li>
                    <li class="rounded-xl px-4 py-3 font-bold" :class="overview.secret_storage_available ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'">
                        {{ overview.secret_storage_available ? t('ai.settings.secret_ok') : t('ai.settings.storage_unavailable') }}
                    </li>
                </ul>
                <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-bold text-gray-800">
                    <input type="checkbox" class="h-5 w-5 accent-emerald-600" :checked="overview.settings?.enabled" :disabled="saving"
                        @change="saveSettings({ enabled: ($event.target as HTMLInputElement).checked })" />
                    {{ t('ai.settings.enabled') }}
                </label>
                <label class="block text-sm font-bold text-gray-700">{{ t('ai.settings.default_model') }}
                    <select class="mt-1 min-h-11 w-full max-w-md rounded-xl border border-gray-200 bg-white px-3 text-sm" :value="overview.settings?.default_model_id ?? ''" :disabled="saving"
                        @change="saveSettings({ default_model_id: ($event.target as HTMLSelectElement).value || null })">
                        <option value="">{{ t('ai.settings.no_default_model') }}</option>
                        <option v-for="model in siteModels" :key="model.id" :value="model.id">{{ model.label }}</option>
                    </select>
                </label>
                <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 p-4">
                    <p class="text-sm text-gray-700">{{ t('ai.settings.notice_version', { n: overview.settings?.notice_version ?? 1 }) }}</p>
                    <button type="button" class="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50" :disabled="saving"
                        @click="saveSettings({ bump_notice_version: true })">{{ t('ai.settings.bump_notice') }}</button>
                </div>
            </section>

            <!-- Providers -->
            <section v-else-if="section === 'providers'" class="space-y-5 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <form class="grid gap-3 rounded-2xl border border-gray-200 p-5 md:grid-cols-2" @submit.prevent="addCredential">
                    <h3 class="font-black text-gray-900 md:col-span-2">{{ t('ai.settings.add_site_credential') }}</h3>
                    <label class="block text-sm font-bold text-gray-700">{{ t('ai.settings.provider') }}
                        <select v-model="credentialForm.provider" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
                            <option v-for="provider in SITE_PROVIDERS" :key="provider" :value="provider">{{ t(`ai.providers.${provider}`) }}</option>
                        </select>
                    </label>
                    <label class="block text-sm font-bold text-gray-700">{{ t('ai.settings.label') }}
                        <input v-model="credentialForm.label" maxlength="120" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" :placeholder="t(`ai.providers.${credentialForm.provider}`)" />
                    </label>
                    <label class="block text-sm font-bold text-gray-700">{{ credentialForm.provider === 'ollama' ? t('ai.settings.api_key_optional') : t('ai.settings.api_key') }}
                        <input v-model="credentialForm.secret" type="password" autocomplete="off" maxlength="4096" :required="credentialForm.provider !== 'ollama'"
                            class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" />
                    </label>
                    <label class="block text-sm font-bold text-gray-700">{{ credentialForm.provider === 'ollama' ? t('ai.settings.base_url') : t('ai.settings.base_url_optional') }}
                        <input v-model="credentialForm.base_url" type="url" maxlength="2048" :required="credentialForm.provider === 'ollama'"
                            class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" :placeholder="credentialForm.provider === 'ollama' ? 'http://ollama:11434' : ''" />
                    </label>
                    <div class="md:col-span-2">
                        <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50" :disabled="saving || !overview.secret_storage_available">{{ t('ai.settings.add_key') }}</button>
                    </div>
                </form>
                <AiCredentialList v-model="credentials" mode="site" :default-model-id="overview.settings?.default_model_id ?? null" @set-default="saveSettings({ default_model_id: $event })" />
            </section>

            <!-- Prompt -->
            <section v-else-if="section === 'prompt'" class="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <p class="text-sm text-gray-700">
                    {{ activePrompt ? t('ai.settings.prompt_active_override', { n: activePrompt.version }) : t('ai.settings.prompt_active_default') }}
                </p>
                <p class="text-xs text-gray-600">{{ t('ai.settings.prompt_hint') }}</p>
                <label class="block text-sm font-bold text-gray-700">{{ t('ai.settings.prompt_body') }}
                    <textarea v-model="promptDraft" rows="14" maxlength="100000" class="mt-1 w-full rounded-xl border border-gray-200 p-3 font-mono text-sm leading-relaxed"></textarea>
                </label>
                <div class="flex flex-wrap gap-2">
                    <button type="button" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50" :disabled="saving || !promptDraft.trim()" @click="savePrompt">{{ t('ai.settings.prompt_save') }}</button>
                    <button type="button" class="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-700 hover:bg-gray-50" @click="promptDraft = overview.prompt.default_body">{{ t('ai.settings.prompt_load_default') }}</button>
                    <button v-if="activePrompt" type="button" class="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50" :disabled="saving" @click="resetPrompt">{{ t('ai.settings.prompt_use_default') }}</button>
                </div>
                <div v-if="overview.prompt.versions.length" class="border-t border-gray-100 pt-4">
                    <h3 class="text-sm font-black text-gray-800">{{ t('ai.settings.prompt_history') }}</h3>
                    <ul class="mt-2 space-y-2">
                        <li v-for="version in overview.prompt.versions" :key="version.id" class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                            <span>v{{ version.version }} · {{ new Date(version.created_at).toLocaleString() }}
                                <span v-if="version.is_active" class="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">{{ t('ai.settings.prompt_in_use') }}</span></span>
                            <span class="flex gap-2">
                                <button type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold text-gray-700 hover:bg-gray-100" @click="promptDraft = version.body">{{ t('ai.settings.prompt_view') }}</button>
                                <button v-if="!version.is_active" type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50" :disabled="saving" @click="activatePrompt(version.id)">{{ t('ai.settings.prompt_activate') }}</button>
                            </span>
                        </li>
                    </ul>
                </div>
            </section>

            <AiQuotaSettings v-else-if="section === 'quota'" v-model:policies="overview.quota_policies" :user-names="overview.user_names" />
        </template>

        <AiUsagePanel v-if="section === 'usage' && !loading" />
    </div>
</template>
