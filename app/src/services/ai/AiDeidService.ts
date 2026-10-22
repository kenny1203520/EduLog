import { apiV1Client } from '@/services/api/ApiV1Client'

/** Client for de-identification administration (/ai/admin/deid). */

export type DeidLanguage = 'zh' | 'en' | 'ja' | 'ko'
export const DEID_LANGUAGES: DeidLanguage[] = ['zh', 'en', 'ja', 'ko']
export type DeidRuleKind = 'deny_list' | 'regex'
export type DeidPlaceholderKind = 'person' | 'location' | 'organization' | 'phone' | 'email' | 'nationalId' | 'sensitive'
export const DEID_PLACEHOLDER_KINDS: DeidPlaceholderKind[] = ['person', 'location', 'organization', 'phone', 'email', 'nationalId', 'sensitive']
/** Every token kind a test may show, including known people. */
export type DeidSpanKind = DeidPlaceholderKind | 'student' | 'teacher' | 'school'

export interface DeidRuleDTO {
    id: string
    name: string
    kind: DeidRuleKind
    entries: string[]
    pattern: string | null
    placeholder_kind: DeidPlaceholderKind
    languages: DeidLanguage[]
    enabled: boolean
    score: number | string
}

export interface DeidOverview {
    connection: 'not_configured' | 'ok' | 'unreachable'
    installed_languages: DeidLanguage[]
    available_languages: DeidLanguage[]
    enabled_languages: DeidLanguage[]
    rules: DeidRuleDTO[]
    allow_list: string[]
}

export interface DeidRuleInput {
    name: string
    kind: DeidRuleKind
    entries: string[]
    pattern: string | null
    placeholder_kind: DeidPlaceholderKind
    languages: DeidLanguage[]
    enabled: boolean
}

export interface DeidTestSpan {
    start: number
    end: number
    text: string
    kind: DeidSpanKind
    token: string
    source: 'known' | 'rule' | 'ner'
    entity_type: string
    rule_name: string | null
    language: string
}

export interface DeidTestResult {
    languages: string[]
    sanitized: string
    spans: DeidTestSpan[]
    ignored_exceptions: string[]
}

export interface DeidTestInput {
    text: string
    names: Array<{ kind: 'student' | 'teacher' | 'school', name: string }>
    /** Unsaved rules used instead of the saved ones. */
    rules?: DeidRuleInput[]
    allow_list?: string[]
}

export const AiDeidService = {
    async overview() { return (await apiV1Client.get<DeidOverview>('/ai/admin/deid')).data },
    async saveLanguages(languages: DeidLanguage[]) {
        return (await apiV1Client.put<{ enabled_languages: DeidLanguage[] }>('/ai/admin/deid/languages', { languages })).data
    },
    async createRule(input: DeidRuleInput) { return (await apiV1Client.post<DeidRuleDTO>('/ai/admin/deid/rules', input)).data },
    async updateRule(id: string, input: Partial<DeidRuleInput>) { return (await apiV1Client.patch<DeidRuleDTO>(`/ai/admin/deid/rules/${id}`, input)).data },
    async deleteRule(id: string) { await apiV1Client.delete(`/ai/admin/deid/rules/${id}`) },
    async saveAllowList(entries: string[]) {
        return (await apiV1Client.put<{ allow_list: string[] }>('/ai/admin/deid/allow-list', { entries })).data
    },
    async test(input: DeidTestInput) { return (await apiV1Client.post<DeidTestResult>('/ai/admin/deid/test', input)).data },
}
