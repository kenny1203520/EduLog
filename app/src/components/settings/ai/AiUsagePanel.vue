<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Pagination from '@/components/ui/Pagination.vue'
import { useFeedback } from '@/composables/useFeedback'
import { AiSettingsService, type GenerationLogRow, type UsageReport } from '@/services/ai/AiSettingsService'
import { copyToClipboard } from '@/utils/clipboard'

/** Usage statistics for a date range, and the de-identified generation log. */
const { t, n } = useI18n()
const { reportError } = useFeedback()

const today = new Date()
const iso = (date: Date) => date.toISOString().slice(0, 10)
const from = ref(iso(new Date(today.getFullYear(), today.getMonth(), 1)))
const to = ref(iso(today))
const report = ref<UsageReport | null>(null)
const truncated = ref(false)
const loading = ref(false)

const PAGE_SIZE = 20
const page = ref(1)
const statusFilter = ref('')
const log = ref<{ rows: GenerationLogRow[], user_names: Record<string, string>, total: number | null }>({ rows: [], user_names: {}, total: null })
const expanded = ref<string | null>(null)
const copied = ref<string | null>(null)

/** Copy a stored prompt (already de-identified) for review elsewhere. */
async function copyText(key: string, text: string | null | undefined) {
    if (!text || !await copyToClipboard(text)) return
    copied.value = key
    setTimeout(() => { if (copied.value === key) copied.value = null }, 1500)
}

function errorDetailText(row: GenerationLogRow) {
    const detail = row.error_detail
    if (!detail) return ''
    return [detail.status ? `HTTP ${detail.status}` : null, detail.message].filter(Boolean).join(' – ')
}

const totalPages = computed(() => Math.max(1, Math.ceil((log.value.total ?? 0) / PAGE_SIZE)))
const percent = (value: number | null) => value == null ? '—' : n(value, 'percent')
const money = (value: number | string | null) => value == null ? '—' : `$${Number(value).toFixed(4)}`

async function loadUsage() {
    loading.value = true
    try {
        const result = await AiSettingsService.usage(from.value, to.value)
        report.value = result.report
        truncated.value = result.truncated
    } catch (error) { reportError(error) } finally { loading.value = false }
}

async function loadLog() {
    try {
        log.value = await AiSettingsService.generations({ limit: PAGE_SIZE, offset: (page.value - 1) * PAGE_SIZE, status: statusFilter.value || undefined })
    } catch (error) { reportError(error) }
}

watch([page, statusFilter], loadLog)
onMounted(() => { void loadUsage(); void loadLog() })
</script>

<template>
    <div class="space-y-6">
        <section class="space-y-5 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm" :aria-busy="loading">
            <form class="flex flex-wrap items-end gap-3" @submit.prevent="loadUsage">
                <label class="text-sm font-bold text-gray-700">{{ t('ai.settings.usage_from') }}
                    <input v-model="from" type="date" required class="mt-1 block min-h-11 rounded-xl border border-gray-200 px-3 text-sm" />
                </label>
                <label class="text-sm font-bold text-gray-700">{{ t('ai.settings.usage_to') }}
                    <input v-model="to" type="date" required :min="from" class="mt-1 block min-h-11 rounded-xl border border-gray-200 px-3 text-sm" />
                </label>
                <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white">{{ t('ai.settings.usage_apply') }}</button>
            </form>
            <p v-if="truncated" class="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900">{{ t('ai.settings.usage_truncated') }}</p>

            <dl v-if="report" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div class="rounded-2xl bg-gray-50 p-4"><dt class="text-xs font-bold text-gray-600">{{ t('ai.settings.usage_generations') }}</dt>
                    <dd class="mt-1 text-2xl font-black tabular-nums text-gray-900">{{ report.totals.generations }}</dd>
                    <dd class="text-xs text-gray-600">{{ t('ai.settings.usage_outcomes', { ok: report.totals.succeeded, failed: report.totals.failed, cancelled: report.totals.cancelled }) }}</dd></div>
                <div class="rounded-2xl bg-gray-50 p-4"><dt class="text-xs font-bold text-gray-600">{{ t('ai.settings.usage_tokens') }}</dt>
                    <dd class="mt-1 text-2xl font-black tabular-nums text-gray-900">{{ n(report.totals.tokensIn + report.totals.tokensOut, 'decimal') }}</dd>
                    <dd class="text-xs text-gray-600">{{ t('ai.settings.usage_tokens_split', { input: n(report.totals.tokensIn, 'decimal'), output: n(report.totals.tokensOut, 'decimal') }) }}</dd></div>
                <div class="rounded-2xl bg-gray-50 p-4"><dt class="text-xs font-bold text-gray-600">{{ t('ai.settings.usage_cost') }}</dt>
                    <dd class="mt-1 text-2xl font-black tabular-nums text-gray-900">{{ money(report.totals.estCost) }}</dd>
                    <dd class="text-xs text-gray-600">{{ t('ai.settings.usage_quota_charged', { n: report.totals.quotaCharged }) }}</dd>
                    <dd v-if="report.totals.unpricedGenerations" class="mt-1 text-xs font-bold text-amber-800">{{ t('ai.settings.usage_unpriced', { n: report.totals.unpricedGenerations }) }}</dd></div>
                <div class="rounded-2xl bg-gray-50 p-4"><dt class="text-xs font-bold text-gray-600">{{ t('ai.settings.usage_adoption') }}</dt>
                    <dd class="mt-1 text-2xl font-black tabular-nums text-gray-900">{{ percent(report.totals.adoptionRate) }}</dd>
                    <dd class="text-xs text-gray-600">{{ t('ai.settings.usage_similarity', { value: percent(report.totals.avgFinalSimilarity) }) }}</dd></div>
            </dl>

            <div v-for="group in report ? [{ key: 'user', rows: report.byUser }, { key: 'model', rows: report.byModel }] : []" :key="group.key" class="overflow-x-auto">
                <table class="w-full min-w-[36rem] text-left text-sm">
                    <caption class="mb-2 text-left font-black text-gray-900">{{ t(`ai.settings.usage_by_${group.key}`) }}</caption>
                    <thead class="text-xs text-gray-600"><tr>
                        <th scope="col" class="py-2 pr-3">{{ group.key === 'user' ? t('ai.settings.usage_col_user') : t('ai.settings.usage_col_model') }}</th>
                        <th scope="col" class="py-2 pr-3 text-right">{{ t('ai.settings.usage_generations') }}</th>
                        <th scope="col" class="py-2 pr-3 text-right">{{ t('ai.settings.usage_tokens') }}</th>
                        <th scope="col" class="py-2 pr-3 text-right">{{ t('ai.settings.usage_cost') }}</th>
                        <th scope="col" class="py-2 pr-3 text-right">{{ t('ai.settings.usage_adoption') }}</th>
                    </tr></thead>
                    <tbody>
                        <tr v-for="row in group.rows" :key="row.key" class="border-t border-gray-100">
                            <td class="py-2 pr-3 font-bold text-gray-900">{{ group.key === 'user' ? (report!.user_names[row.key] ?? row.key) : row.key }}</td>
                            <td class="py-2 pr-3 text-right tabular-nums">{{ row.generations }}</td>
                            <td class="py-2 pr-3 text-right tabular-nums">{{ n(row.tokensIn + row.tokensOut, 'decimal') }}</td>
                            <td class="py-2 pr-3 text-right tabular-nums">{{ money(row.estCost) }}</td>
                            <td class="py-2 pr-3 text-right tabular-nums">{{ percent(row.adoptionRate) }}</td>
                        </tr>
                        <tr v-if="!group.rows.length"><td colspan="5" class="py-3 text-gray-600">{{ t('ai.settings.usage_empty') }}</td></tr>
                    </tbody>
                </table>
            </div>
        </section>

        <section class="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <h3 class="font-black text-gray-900">{{ t('ai.settings.log_title') }}</h3>
                <select v-model="statusFilter" class="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm" :aria-label="t('ai.settings.log_status')" @change="page = 1">
                    <option value="">{{ t('ai.settings.log_all') }}</option>
                    <option v-for="status in ['running', 'succeeded', 'failed', 'cancelled']" :key="status" :value="status">{{ t(`ai.settings.log_status_${status}`) }}</option>
                </select>
            </div>
            <p class="text-xs text-gray-600">{{ t('ai.settings.log_privacy') }}</p>
            <ul class="divide-y divide-gray-100">
                <li v-for="row in log.rows" :key="row.id" class="py-3 text-sm">
                    <button type="button" class="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 text-left" :aria-expanded="expanded === row.id" @click="expanded = expanded === row.id ? null : row.id">
                        <span>
                            <span class="font-bold text-gray-900">{{ log.user_names[row.user_id ?? ''] ?? row.user_id ?? '—' }}</span>
                            <span class="ml-2 text-gray-600">{{ new Date(row.created_at).toLocaleString() }}</span>
                        </span>
                        <span class="flex flex-wrap items-center gap-2 text-xs">
                            <span class="rounded-full px-2 py-0.5 font-bold" :class="row.status === 'succeeded' ? 'bg-emerald-50 text-emerald-800' : row.status === 'failed' ? 'bg-red-50 text-red-800' : row.status === 'running' ? 'bg-sky-50 text-sky-800' : 'bg-gray-100 text-gray-700'">{{ t(`ai.settings.log_status_${row.status}`) }}</span>
                            <span class="text-gray-700">{{ row.provider }}/{{ row.model_id }}</span>
                            <span class="text-gray-600">{{ t('ai.settings.log_adoptions', { n: row.adoption_count }) }}</span>
                        </span>
                    </button>
                    <div v-if="expanded === row.id" class="mt-2 space-y-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-800">
                        <p>{{ t('ai.settings.log_meta', { tin: row.tokens_in ?? '—', tout: row.tokens_out ?? '—', cost: money(row.est_cost), quota: row.quota_charged, ms: row.latency_ms ?? '—', prompt: Object.values(row.prompt_versions).join(', ') }) }}</p>
                        <p v-if="row.error_code" class="font-bold text-red-700">{{ row.error_code }}</p>
                        <p v-if="row.error_detail" class="break-words text-red-700">{{ t('ai.panel.provider_reason', { reason: errorDetailText(row) }) }}</p>
                        <p v-if="row.options?.output_mode === 'json_text'" class="text-gray-600">{{ t('ai.settings.log_compat_mode') }}</p>
                        <details class="rounded-lg border border-gray-200 bg-white p-2">
                            <summary class="min-h-11 cursor-pointer content-center font-bold">{{ t('ai.settings.log_input') }}</summary>
                            <div class="mt-2 flex items-center justify-between gap-2">
                                <p class="font-bold">{{ t('ai.history.system_prompt') }}</p>
                                <button v-if="row.system_prompt" type="button" class="min-h-11 rounded-lg px-2 font-bold text-emerald-700 hover:bg-emerald-50" @click="copyText(`${row.id}:system`, row.system_prompt)">{{ copied === `${row.id}:system` ? t('ai.panel.copied') : t('ai.panel.copy') }}</button>
                            </div>
                            <pre v-if="row.system_prompt" class="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2">{{ row.system_prompt }}</pre>
                            <p v-else class="text-gray-600">{{ t('ai.history.system_prompt_version_only', { version: Object.values(row.prompt_versions).join(', ') || '—' }) }}</p>
                            <div class="mt-2 flex items-center justify-between gap-2">
                                <p class="font-bold">{{ t('ai.history.prompt') }}</p>
                                <button v-if="row.sanitized_input?.prompt" type="button" class="min-h-11 rounded-lg px-2 font-bold text-emerald-700 hover:bg-emerald-50" @click="copyText(`${row.id}:prompt`, row.sanitized_input?.prompt)">{{ copied === `${row.id}:prompt` ? t('ai.panel.copied') : t('ai.panel.copy') }}</button>
                            </div>
                            <pre class="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2">{{ row.sanitized_input?.prompt ?? '—' }}</pre>
                        </details>
                        <div v-for="(section, i) in row.sanitized_output?.sections ?? []" :key="i"><p class="font-bold">{{ section.title }}</p><p class="whitespace-pre-wrap">{{ section.body }}</p></div>
                        <div v-if="row.sanitized_output?.teachingSuggestions?.length"><p class="font-bold">{{ t('ai.panel.suggestions_title') }}</p>
                            <ul class="list-disc pl-5"><li v-for="(text, i) in row.sanitized_output.teachingSuggestions" :key="i">{{ text }}</li></ul></div>
                    </div>
                </li>
                <li v-if="!log.rows.length" class="py-3 text-sm text-gray-600">{{ t('ai.settings.usage_empty') }}</li>
            </ul>
            <Pagination v-if="totalPages > 1" v-model="page" :per-page="PAGE_SIZE" :total-items="log.total ?? 0" />
        </section>
    </div>
</template>
