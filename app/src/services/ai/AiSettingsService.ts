import { apiV1Client } from '@/services/api/ApiV1Client'

/** Client for personal (/ai/me) and admin (/ai/admin) AI settings. */

export type AiProvider = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'ollama'
export const PERSONAL_PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'google', 'openrouter', 'ollama']
export const SITE_PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'google', 'openrouter', 'ollama']

/** A model offered by the provider's own list (see server/src/ai/providers/modelCatalog.ts). */
export interface CatalogModel {
    id: string
    name: string
    textCapable: boolean
    priceInputPerMtok?: number
    priceOutputPerMtok?: number
    supportsStructuredOutput?: boolean
}

export type ModelCatalog = { supported: true, models: CatalogModel[], fetchedAt: string } | { supported: false, reason: string }

/** Outcome of the test call; status and message are what the provider said, without secrets. */
export interface CredentialTestResult {
    ok: boolean
    error: string | null
    failure?: 'RATE_LIMITED' | 'MODEL_UNSUPPORTED' | 'DATA_POLICY' | 'AUTH_FAILED' | 'PROVIDER_ERROR' | null
    status?: number | null
    message?: string | null
}

export interface AiModelDTO {
    id: string
    credential_id: string
    model_id: string
    display_name: string
    enabled: boolean
    quota_weight: number | string
    price_input_per_mtok: number | string | null
    price_output_per_mtok: number | string | null
    /** false: the model rejects JSON schema output and is called in compatibility mode. */
    supports_structured_output?: boolean | null
}

export interface AiCredentialDTO {
    id: string
    scope: 'site' | 'user'
    provider: AiProvider
    auth_type: 'api_key' | 'oauth' | 'none'
    secret_hint: string | null
    base_url: string | null
    label: string
    status: 'active' | 'invalid' | 'disabled'
    last_verified_at: string | null
    models: AiModelDTO[]
}

export interface PromptVersionDTO {
    id: string
    version: number
    body: string
    source: 'code' | 'override'
    is_active: boolean
    created_at: string
}

export interface QuotaPolicyDTO {
    id: string
    scope: 'default' | 'role' | 'user'
    target_id: string | null
    one_time_total: number | string | null
    period: 'none' | 'day' | 'week' | 'month'
    period_amount: number | string | null
}

export interface AiAdminOverview {
    settings: { enabled: boolean, notice_version: number, default_model_id: string | null } | null
    secret_storage_available: boolean
    deidentification_available: boolean
    credentials: AiCredentialDTO[]
    prompt: { key: string, default_body: string, versions: PromptVersionDTO[] }
    quota_policies: QuotaPolicyDTO[]
    user_names: Record<string, string>
}

export interface UsageBucket {
    key: string
    generations: number
    succeeded: number
    failed: number
    cancelled: number
    tokensIn: number
    tokensOut: number
    estCost: number
    /** Succeeded generations on unpriced models, left out of estCost. */
    unpricedGenerations: number
    quotaCharged: number
    adopted: number
    adoptionRate: number | null
    avgFinalSimilarity: number | null
}

export interface UsageReport {
    totals: UsageBucket
    byUser: UsageBucket[]
    byModel: UsageBucket[]
    user_names: Record<string, string>
}

export interface GenerationLogRow {
    id: string
    created_at: string
    user_id: string | null
    credential_scope: 'site' | 'user'
    provider: string
    model_id: string
    prompt_versions: Record<string, string>
    status: 'running' | 'succeeded' | 'failed' | 'cancelled'
    error_code: string | null
    error_detail: { status: number | null, message: string | null } | null
    system_prompt: string | null
    sanitized_input: { prompt?: string } | null
    options: Record<string, unknown> | null
    tokens_in: number | null
    tokens_out: number | null
    est_cost: number | string | null
    quota_charged: number | string
    latency_ms: number | null
    sanitized_output: { sections?: Array<{ title: string, body: string }>, teachingSuggestions?: string[] } | null
    adoption_count: number
}

export interface ModelInput {
    model_id: string
    display_name: string
    enabled?: boolean
    quota_weight?: number
    price_input_per_mtok?: number | null
    price_output_per_mtok?: number | null
}

export const AiSettingsService = {
    // Personal --------------------------------------------------------------
    async myCredentials() {
        return (await apiV1Client.get<{ credentials: AiCredentialDTO[], secret_storage_available: boolean, chatgpt_available?: boolean }>('/ai/me/credentials')).data
    },
    async addMyCredential(input: { provider: AiProvider, label: string, secret?: string, base_url?: string }) {
        return (await apiV1Client.post<AiCredentialDTO>('/ai/me/credentials', input)).data
    },
    async updateMyCredential(id: string, patch: { label?: string, secret?: string | null, base_url?: string, status?: 'active' | 'disabled' }) {
        return (await apiV1Client.patch<AiCredentialDTO>(`/ai/me/credentials/${id}`, patch)).data
    },
    async deleteMyCredential(id: string) { await apiV1Client.delete(`/ai/me/credentials/${id}`) },
    async addMyModel(credentialId: string, input: { model_id: string, display_name: string }) {
        return (await apiV1Client.post<AiModelDTO>(`/ai/me/credentials/${credentialId}/models`, input)).data
    },
    async deleteMyModel(id: string) { await apiV1Client.delete(`/ai/me/models/${id}`) },
    async updateMyModel(id: string, patch: { display_name?: string, enabled?: boolean }) { return (await apiV1Client.patch<AiModelDTO>(`/ai/me/models/${id}`, patch)).data },
    /** Provider model list for a credential; `scope` picks the personal or site route. */
    async catalog(scope: 'personal' | 'site', credentialId: string, refresh = false) {
        const base = scope === 'site' ? '/ai/admin/credentials' : '/ai/me/credentials'
        return (await apiV1Client.get<ModelCatalog>(`${base}/${credentialId}/catalog${refresh ? '?refresh=1' : ''}`)).data
    },
    async testMyCredential(id: string, modelId: string) {
        return (await apiV1Client.post<CredentialTestResult>(`/ai/me/credentials/${id}/test`, { model_id: modelId })).data
    },
    async startOpenRouter() { return (await apiV1Client.post<{ url: string }>('/ai/me/openrouter/start', {})).data.url },
    async finishOpenRouter(code: string) { return (await apiV1Client.post<AiCredentialDTO>('/ai/me/openrouter/exchange', { code })).data },
    async startChatGpt() { return (await apiV1Client.post<{ url: string }>('/ai/me/chatgpt/start', {})).data.url },
    async finishChatGpt(code: string, state: string) { return (await apiV1Client.post<AiCredentialDTO>('/ai/me/chatgpt/exchange', { code, state })).data },

    // Admin -----------------------------------------------------------------
    async overview() { return (await apiV1Client.get<AiAdminOverview>('/ai/admin/overview')).data },
    async saveSettings(input: { enabled?: boolean, default_model_id?: string | null, bump_notice_version?: boolean }) {
        return (await apiV1Client.put<AiAdminOverview['settings']>('/ai/admin/settings', input)).data
    },
    async addSiteCredential(input: { provider: AiProvider, label: string, secret?: string, base_url?: string | null }) {
        return (await apiV1Client.post<AiCredentialDTO>('/ai/admin/credentials', input)).data
    },
    async updateSiteCredential(id: string, patch: { label?: string, secret?: string, base_url?: string | null, status?: 'active' | 'disabled' }) {
        return (await apiV1Client.patch<AiCredentialDTO>(`/ai/admin/credentials/${id}`, patch)).data
    },
    async deleteSiteCredential(id: string) { await apiV1Client.delete(`/ai/admin/credentials/${id}`) },
    async testSiteCredential(id: string, modelId: string) {
        return (await apiV1Client.post<CredentialTestResult>(`/ai/admin/credentials/${id}/test`, { model_id: modelId })).data
    },
    async addSiteModel(credentialId: string, input: ModelInput) {
        return (await apiV1Client.post<AiModelDTO>(`/ai/admin/credentials/${credentialId}/models`, input)).data
    },
    async updateSiteModel(id: string, patch: Partial<ModelInput>) { return (await apiV1Client.patch<AiModelDTO>(`/ai/admin/models/${id}`, patch)).data },
    async deleteSiteModel(id: string) { await apiV1Client.delete(`/ai/admin/models/${id}`) },
    async savePrompt(body: string) { return (await apiV1Client.post<PromptVersionDTO>('/ai/admin/prompts', { body })).data },
    async activatePrompt(id: string) { await apiV1Client.post(`/ai/admin/prompts/${id}/activate`, {}) },
    async resetPrompt() { await apiV1Client.post('/ai/admin/prompts/reset', {}) },
    async savePolicy(input: Omit<QuotaPolicyDTO, 'id'>) { return (await apiV1Client.put<QuotaPolicyDTO>('/ai/admin/quota/policies', input)).data },
    async deletePolicy(id: string) { await apiV1Client.delete(`/ai/admin/quota/policies/${id}`) },
    async adjustQuota(input: { user_id: string, kind: 'grant' | 'reset', delta?: number, note?: string }) {
        await apiV1Client.post('/ai/admin/quota/ledger', input)
    },
    async userQuota(userId: string) {
        return (await apiV1Client.get<{ remaining: number, periodic: { remaining: number, limit: number } | null, oneTime: { total: number, used: number, remaining: number } }>(`/ai/admin/quota/users/${userId}`)).data
    },
    async usage(from: string, to: string) {
        const response = await apiV1Client.get<UsageReport>(`/ai/admin/usage?from=${from}&to=${to}`)
        return { report: response.data, truncated: Boolean(response.meta?.truncated) }
    },
    async generations(options: { limit: number, offset: number, status?: string }) {
        const params = new URLSearchParams({ limit: String(options.limit), offset: String(options.offset) })
        if (options.status) params.set('status', options.status)
        const response = await apiV1Client.get<{ rows: GenerationLogRow[], user_names: Record<string, string> }>(`/ai/admin/generations?${params}`)
        return { ...response.data, total: typeof response.meta?.total === 'number' ? response.meta.total : null }
    },
}
