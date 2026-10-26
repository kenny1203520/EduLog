<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AiCredentialList from '@/components/settings/ai/AiCredentialList.vue'
import { useFeedback } from '@/composables/useFeedback'
import { AiSettingsService, PERSONAL_PROVIDERS, type AiCredentialDTO, type AiProvider } from '@/services/ai/AiSettingsService'

/** Settings → Personal → My AI credentials: own API keys and OpenRouter sign-in. */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { reportError, success } = useFeedback()

const loading = ref(true)
const credentials = ref<AiCredentialDTO[]>([])
const storageAvailable = ref(true)
const chatgptAvailable = ref(false)
const saving = ref(false)
const connecting = ref(false)
const form = reactive<{ provider: AiProvider, label: string, secret: string }>({ provider: 'anthropic', label: '', secret: '' })

async function load() {
    loading.value = true
    try {
        const data = await AiSettingsService.myCredentials()
        credentials.value = data.credentials
        storageAvailable.value = data.secret_storage_available
        chatgptAvailable.value = data.chatgpt_available === true
    } catch (error) {
        reportError(error)
    } finally {
        loading.value = false
    }
}

async function add() {
    saving.value = true
    try {
        const created = await AiSettingsService.addMyCredential({ provider: form.provider, label: form.label.trim() || t(`ai.providers.${form.provider}`), secret: form.secret.trim() })
        credentials.value = [...credentials.value, { ...created, models: [] }]
        form.secret = ''
        form.label = ''
        success('ai.settings.saved')
    } catch (error) {
        reportError(error)
    } finally {
        saving.value = false
    }
}

type OAuthFlow = 'openrouter' | 'chatgpt'

/** Remembered across the redirect: OpenRouter replaces our callback's query string, so ?ai_oauth= may not come back. */
const OAUTH_PENDING_KEY = 'edulog.aiOAuthPending'
/** Matches how long the server keeps the PKCE verifier. */
const OAUTH_PENDING_TTL_MS = 10 * 60_000

function rememberPendingFlow(flow: OAuthFlow) {
    try { sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ flow, startedAt: Date.now() })) } catch { /* storage blocked: rely on ?ai_oauth= */ }
}

/** The flow started from this tab in the last few minutes, if any; always cleared once read. */
function takePendingFlow(): OAuthFlow | null {
    try {
        const raw = sessionStorage.getItem(OAUTH_PENDING_KEY)
        sessionStorage.removeItem(OAUTH_PENDING_KEY)
        if (!raw) return null
        const pending = JSON.parse(raw) as { flow?: unknown, startedAt?: unknown }
        const fresh = typeof pending.startedAt === 'number' && Date.now() - pending.startedAt <= OAUTH_PENDING_TTL_MS
        return fresh && (pending.flow === 'openrouter' || pending.flow === 'chatgpt') ? pending.flow : null
    } catch {
        return null
    }
}

async function connect(flow: OAuthFlow, start: () => Promise<string>) {
    connecting.value = true
    try {
        const url = await start()
        rememberPendingFlow(flow)
        window.location.assign(url)
    } catch (error) {
        reportError(error)
        connecting.value = false
    }
}
const connectOpenRouter = () => connect('openrouter', AiSettingsService.startOpenRouter)
const connectChatGpt = () => connect('chatgpt', AiSettingsService.startChatGpt)

/**
 * OpenRouter and ChatGPT send the teacher back here with ?code=… (and state
 * for ChatGPT). Our ?ai_oauth= flag may be dropped on the way, so the flow
 * remembered before leaving also counts; a code with neither is ignored.
 */
async function finishOAuthIfReturning() {
    const pending = takePendingFlow()
    const code = typeof route.query.code === 'string' ? route.query.code : null
    const flagged = route.query.ai_oauth === 'openrouter' || route.query.ai_oauth === 'chatgpt' ? route.query.ai_oauth : null
    const flow = flagged ?? pending
    if (!flow || !code) return
    const state = typeof route.query.state === 'string' ? route.query.state : ''
    // Drop the one-time code from the address bar before using it.
    const { code: _code, state: _state, ai_oauth: _flag, ...rest } = route.query
    await router.replace({ query: { ...rest, tab: 'personal' } })
    try {
        if (flow === 'chatgpt') {
            await AiSettingsService.finishChatGpt(code, state)
            success('ai.settings.chatgpt_connected')
        } else {
            await AiSettingsService.finishOpenRouter(code)
            success('ai.settings.openrouter_connected')
        }
    } catch (error) {
        reportError(error)
    }
}

onMounted(async () => {
    await finishOAuthIfReturning()
    await load()
})
</script>

<template>
    <div class="space-y-5">
        <p class="text-sm text-gray-600">{{ t('ai.settings.personal_description') }}</p>
        <p v-if="!storageAvailable" role="alert" class="rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{{ t('ai.settings.storage_unavailable') }}</p>

        <div v-if="chatgptAvailable" class="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
            <h3 class="font-black text-gray-900">{{ t('ai.settings.chatgpt_title') }}</h3>
            <p class="mt-1 text-sm text-gray-700">{{ t('ai.settings.chatgpt_description') }}</p>
            <button type="button" data-testid="connect-chatgpt" class="mt-4 min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-50"
                :disabled="connecting || !storageAvailable" @click="connectChatGpt">
                {{ connecting ? t('ai.settings.redirecting') : t('ai.settings.chatgpt_connect') }}
            </button>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <div class="rounded-2xl border border-gray-200 p-5">
                <h3 class="font-black text-gray-900">{{ t('ai.settings.openrouter_title') }}</h3>
                <p class="mt-1 text-sm text-gray-600">{{ t('ai.settings.openrouter_description') }}</p>
                <button type="button" data-testid="connect-openrouter" class="mt-4 min-h-11 rounded-xl bg-gray-900 px-4 text-sm font-black text-white hover:bg-gray-800 disabled:opacity-50"
                    :disabled="connecting || !storageAvailable" @click="connectOpenRouter">
                    {{ connecting ? t('ai.settings.redirecting') : t('ai.settings.openrouter_connect') }}
                </button>
            </div>
            <form class="space-y-3 rounded-2xl border border-gray-200 p-5" @submit.prevent="add">
                <h3 class="font-black text-gray-900">{{ t('ai.settings.add_key_title') }}</h3>
                <label class="block text-sm font-bold text-gray-700">{{ t('ai.settings.provider') }}
                    <select v-model="form.provider" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
                        <option v-for="provider in PERSONAL_PROVIDERS" :key="provider" :value="provider">{{ t(`ai.providers.${provider}`) }}</option>
                    </select>
                </label>
                <label class="block text-sm font-bold text-gray-700">{{ t('ai.settings.label') }}
                    <input v-model="form.label" maxlength="120" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" :placeholder="t(`ai.providers.${form.provider}`)"  :aria-label="t(`ai.providers.${form.provider}`)"/>
                </label>
                <label class="block text-sm font-bold text-gray-700">{{ t('ai.settings.api_key') }}
                    <input v-model="form.secret" type="password" autocomplete="off" required maxlength="4096" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" />
                </label>
                <p class="text-xs text-gray-600">{{ t('ai.settings.key_storage_note') }}</p>
                <p class="text-xs text-gray-600">{{ t('ai.settings.gemini_note') }}</p>
                <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50" :disabled="saving || !form.secret.trim() || !storageAvailable">
                    {{ saving ? t('common.saving') : t('ai.settings.add_key') }}
                </button>
            </form>
        </div>

        <div v-if="loading" class="h-24 animate-pulse rounded-2xl bg-gray-100 motion-reduce:animate-none" aria-busy="true"></div>
        <AiCredentialList v-else v-model="credentials" mode="personal" />
    </div>
</template>
