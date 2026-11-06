<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AiNotice from '@/components/report/ai/AiNotice.vue'
import { endedErrorCode, providerReason } from '@/composables/useReportAssist'
import type { GenerationHistoryEntry } from '@/services/ai/ReportAssistService'

/**
 * The teacher's earlier generations on this report, newest first. Opening one
 * puts it in the result area, where it can be inserted, copied or kept.
 */
defineProps<{
    entries: GenerationHistoryEntry[]
    loading: boolean
}>()

const emit = defineEmits<{ (e: 'open', entry: GenerationHistoryEntry): void }>()

const { t, d } = useI18n()

const STATUS_CLASS: Record<GenerationHistoryEntry['status'], string> = {
    running: 'bg-sky-100 text-sky-800 ring-sky-200',
    succeeded: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    failed: 'bg-red-100 text-red-800 ring-red-200',
    cancelled: 'bg-gray-100 text-gray-700 ring-gray-200',
}

function when(entry: GenerationHistoryEntry) {
    return d(new Date(entry.created_at), 'long')
}

function reason(entry: GenerationHistoryEntry) {
    const key = `ai.errors.${endedErrorCode(entry)}`
    const message = t(key)
    return message === key ? t('ai.errors.AI_UNKNOWN_ERROR') : message
}
</script>

<template>
    <div class="space-y-3">
        <div v-if="loading && !entries.length" class="space-y-3" aria-busy="true">
            <div v-for="n in 3" :key="n" class="h-16 animate-pulse rounded-xl bg-gray-200 motion-reduce:animate-none"></div>
        </div>
        <p v-else-if="!entries.length" class="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
            {{ $t('ai.history.empty') }}
        </p>
        <details v-for="entry in entries" :key="entry.generation_id"
            class="group rounded-xl border border-gray-200 bg-white" data-testid="ai-history-entry">
            <summary class="flex min-h-[44px] cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
                <span class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1"
                    :class="STATUS_CLASS[entry.status]">
                    <span v-if="entry.status === 'running'" class="h-3 w-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent motion-reduce:animate-none" aria-hidden="true"></span>
                    {{ $t(`ai.history.status.${entry.status}`) }}
                </span>
                <span class="min-w-0 flex-1">
                    <span class="block text-sm font-medium text-gray-900">{{ when(entry) }}</span>
                    <span class="block truncate text-sm text-gray-600">
                        {{ entry.model_id }}
                        <template v-if="entry.quota_charged > 0"> · {{ $t('ai.panel.costs', { n: entry.quota_charged }) }}</template>
                        <template v-if="entry.adoption_count > 0"> · {{ $t('ai.history.adopted', { n: entry.adoption_count }) }}</template>
                    </span>
                </span>
                <svg class="h-4 w-4 shrink-0 text-gray-500 transition-transform duration-200 group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
            </summary>

            <div class="space-y-3 border-t border-gray-100 px-4 py-3">
                <AiNotice v-if="entry.status === 'running'" tone="info" live="status" :message="$t('ai.history.running_hint')" />
                <AiNotice v-else-if="entry.status !== 'succeeded'" :tone="entry.status === 'cancelled' ? 'info' : 'error'"
                    :message="reason(entry)" :detail="providerReason(entry.error_detail)" />

                <template v-if="entry.draft">
                    <AiNotice v-if="entry.unresolved_placeholders.length" tone="warning"
                        :message="$t('ai.history.unrestorable', { tokens: entry.unresolved_placeholders.join('、') })" />
                    <div v-for="section in entry.draft.sections" :key="section.key">
                        <h4 class="text-sm font-semibold text-gray-700">{{ section.title }}</h4>
                        <p class="whitespace-pre-wrap text-sm text-gray-900">{{ section.body }}</p>
                    </div>
                    <div v-if="entry.draft.teachingSuggestions.length" class="rounded-lg bg-slate-100 p-3">
                        <h4 class="text-sm font-semibold text-slate-800">
                            {{ $t('ai.panel.suggestions_title') }} · {{ $t('ai.panel.internal_only') }}
                        </h4>
                        <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">
                            <li v-for="(text, index) in entry.draft.teachingSuggestions" :key="index">
                                {{ text }}
                                <span v-if="entry.suggestion_states[index] === 'kept'" class="ml-1 rounded bg-slate-700 px-1.5 text-xs font-semibold text-white">{{ $t('ai.history.kept') }}</span>
                            </li>
                        </ul>
                    </div>
                    <button type="button"
                        class="min-h-[44px] w-full cursor-pointer rounded-lg border border-emerald-600 bg-white px-4 text-sm font-semibold text-emerald-700 transition-colors duration-200 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                        @click="emit('open', entry)">{{ $t('ai.history.open') }}</button>
                </template>

                <details v-if="entry.input?.prompt || entry.input?.system_prompt" class="rounded-lg border border-gray-200 bg-gray-50 p-2" data-testid="ai-history-input">
                    <summary class="min-h-[44px] cursor-pointer content-center text-sm font-semibold text-gray-800">{{ $t('ai.history.input_title') }}</summary>
                    <h4 class="mt-2 text-sm font-semibold text-gray-700">{{ $t('ai.history.system_prompt') }}</h4>
                    <pre v-if="entry.input.system_prompt" class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-sm text-gray-800">{{ entry.input.system_prompt }}</pre>
                    <p v-else class="mt-1 text-sm text-gray-600">{{ $t('ai.history.system_prompt_version_only', { version: entry.input.prompt_version ?? '—' }) }}</p>
                    <h4 class="mt-2 text-sm font-semibold text-gray-700">{{ $t('ai.history.prompt') }}</h4>
                    <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-sm text-gray-800">{{ entry.input.prompt }}</pre>
                </details>
            </div>
        </details>
    </div>
</template>
