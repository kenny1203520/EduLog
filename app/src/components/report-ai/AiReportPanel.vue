<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import AiHistoryList from '@/components/report-ai/AiHistoryList.vue'
import AiSectionCard from '@/components/report-ai/AiSectionCard.vue'
import { useReportAssist } from '@/composables/useReportAssist'
import type { GenerationHistoryEntry, ReportAssistSource, ReportDraftSection, ReportLength, ReportTone } from '@/services/ai/ReportAssistService'
import { copyToClipboard } from '@/utils/clipboard'

/**
 * Right-hand drawer of the AI report assistant. It never edits the report by
 * itself: the teacher inserts or replaces text, which the editor applies.
 */
const props = defineProps<{
    show: boolean
    reportId?: string
    templates?: Array<{ id: string, name: string }>
    /** Whether 學習報告 already has text (replacing then needs confirmation). */
    hasContent?: boolean
    /** Flush unsaved editor changes so the server reads the latest notes. */
    beforeGenerate?: () => Promise<boolean>
}>()

const emit = defineEmits<{
    (e: 'close'): void
    (e: 'insert', text: string): void
    (e: 'replace', text: string): void
}>()

const { t } = useI18n()
const assist = useReportAssist(toRef(props, 'reportId'))
const {
    status, bootstrap, errorCode, tone, length, extraInstructions, focus, templateId, modelRowId,
    versions, currentIndex, current, preview, previewLoading, selectedSource, quotaRemaining,
    needsNotice, sourceProblem, alternativeSources, canGenerate, visibleSections, visibleSuggestions,
    following, history, historyLoading,
} = assist

const TONES: ReportTone[] = ['warm', 'formal', 'concise']
const LENGTHS: ReportLength[] = ['short', 'medium', 'long']
const confirmReplace = ref(false)
const copiedKey = ref<string | null>(null)
const acknowledging = ref(false)
const tab = ref<'generate' | 'history'>('generate')

const generating = computed(() => status.value === 'generating')
const warnings = computed(() => bootstrap.value?.warnings ?? [])
const thinContext = computed(() => warnings.value.includes('thin_class_notes') || warnings.value.includes('missing_lesson_title'))
const siteSources = computed(() => bootstrap.value?.sources.filter((source) => source.credential_scope === 'site') ?? [])
const personalSources = computed(() => bootstrap.value?.sources.filter((source) => source.credential_scope === 'user') ?? [])
const fullText = computed(() => (current.value?.draft.sections ?? []).map((section) => section.body).join('\n\n'))
const errorMessage = computed(() => {
    if (!errorCode.value) return ''
    const key = `ai.errors.${errorCode.value}`
    const message = t(key)
    return message === key ? t('ai.errors.AI_UNKNOWN_ERROR') : message
})

watch(() => [props.show, props.reportId] as const, ([show, reportId], previous) => {
    if (show && reportId && (status.value === 'idle' || reportId !== previous?.[1])) void assist.load()
}, { immediate: true })

function sourceLabel(source: ReportAssistSource) {
    const owner = source.credential_scope === 'site' ? t('ai.panel.source_site') : t('ai.panel.source_personal')
    const cost = source.credential_scope === 'site' ? ` · ${t('ai.panel.costs', { n: source.quota_weight })}` : ''
    return `${source.display_name} — ${owner}（${source.credential_label}）${cost}`
}

async function acknowledge() {
    acknowledging.value = true
    try { await assist.acknowledgeNotice() } finally { acknowledging.value = false }
}

function insertSection(section: Partial<ReportDraftSection>) {
    if (!section.body || !section.key) return
    emit('insert', section.body)
    void assist.recordAdoption(section.key, 'insert')
}

async function copySection(section: Partial<ReportDraftSection>) {
    if (!section.body || !section.key) return
    if (await copyToClipboard(section.body)) {
        copiedKey.value = section.key
        setTimeout(() => { if (copiedKey.value === section.key) copiedKey.value = null }, 1500)
        void assist.recordAdoption(section.key, 'copy')
    }
}

function appendAll() {
    if (!fullText.value) return
    emit('insert', fullText.value)
    void assist.recordAdoption('all', 'adopt_all')
}

function replaceAll() {
    if (!fullText.value) return
    if (props.hasContent) { confirmReplace.value = true; return }
    applyReplace()
}

function applyReplace() {
    confirmReplace.value = false
    emit('replace', fullText.value)
    void assist.recordAdoption('all', 'replace')
}

function showTab(next: 'generate' | 'history') {
    tab.value = next
    if (next === 'history') void assist.loadHistory()
}

function openFromHistory(entry: GenerationHistoryEntry) {
    assist.addVersion(entry)
    tab.value = 'generate'
}

function onPreviewToggle(event: Event) {
    if ((event.target as HTMLDetailsElement).open) void assist.loadPreview()
}

function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && props.show && !confirmReplace.value) emit('close')
}
onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown)
    // Leaving does not stop a generation; it is saved and shows up when the panel reopens.
    assist.dispose()
})
</script>

<template>
    <Teleport to="body">
        <div v-if="show" class="fixed inset-0 z-[120] overflow-hidden pointer-events-none">
            <div class="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto cursor-pointer"
                @click="emit('close')"></div>

            <section role="dialog" aria-modal="true" aria-labelledby="ai-panel-title"
                class="absolute inset-y-0 right-0 z-[130] flex w-full flex-col bg-gray-50 shadow-[-20px_0_60px_rgba(0,0,0,0.15)] ring-1 ring-black/5 pointer-events-auto sm:w-[600px]">
                <!-- Header -->
                <header class="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
                    <div class="flex items-center gap-3">
                        <div class="rounded-xl bg-emerald-50 p-2 ring-1 ring-emerald-100">
                            <svg class="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                            </svg>
                        </div>
                        <div>
                            <h2 id="ai-panel-title" class="text-lg font-bold leading-tight text-gray-900">{{ $t('ai.panel.title') }}</h2>
                            <p class="text-xs text-gray-600">{{ $t('ai.panel.subtitle') }}</p>
                        </div>
                    </div>
                    <button type="button"
                        class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-gray-500 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                        :aria-label="$t('common.close')" @click="emit('close')">
                        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                <div class="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
                    <!-- Loading -->
                    <div v-if="status === 'loading' || status === 'idle'" class="space-y-3" aria-busy="true">
                        <div v-for="n in 3" :key="n" class="h-20 animate-pulse rounded-xl bg-gray-200 motion-reduce:animate-none"></div>
                    </div>

                    <div v-else-if="!reportId" class="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                        {{ $t('ai.panel.save_first') }}
                    </div>

                    <div v-else-if="status === 'error' && !bootstrap" role="alert"
                        class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        <p>{{ errorMessage }}</p>
                        <button type="button" class="mt-3 min-h-[44px] cursor-pointer rounded-lg bg-white px-3 font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-100"
                            @click="assist.load()">{{ $t('ai.panel.retry') }}</button>
                    </div>

                    <div v-else-if="bootstrap && !bootstrap.enabled" class="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                        {{ $t('ai.panel.disabled') }}
                    </div>

                    <!-- First-use notice -->
                    <section v-else-if="needsNotice" class="space-y-4 rounded-xl border border-emerald-200 bg-white p-5" aria-labelledby="ai-notice-title">
                        <h3 id="ai-notice-title" class="text-base font-bold text-gray-900">{{ $t('ai.notice.title') }}</h3>
                        <ul class="list-disc space-y-2 pl-5 text-sm leading-relaxed text-gray-700">
                            <li>{{ $t('ai.notice.what_is_sent') }}</li>
                            <li>{{ $t('ai.notice.deidentified') }}</li>
                            <li>{{ $t('ai.notice.providers') }}</li>
                            <li>{{ $t('ai.notice.logged') }}</li>
                            <li>{{ $t('ai.notice.responsibility') }}</li>
                        </ul>
                        <button type="button" :disabled="acknowledging"
                            class="min-h-[44px] w-full cursor-pointer rounded-lg bg-emerald-600 px-4 font-semibold text-white transition-colors duration-200 hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50"
                            @click="acknowledge">{{ $t('ai.notice.acknowledge') }}</button>
                    </section>

                    <template v-else-if="bootstrap">
                        <div role="tablist" :aria-label="$t('ai.history.tabs_label')" class="grid grid-cols-2 gap-1 rounded-xl bg-gray-200 p-1">
                            <button v-for="name in (['generate', 'history'] as const)" :key="name" type="button" role="tab"
                                :id="`ai-tab-${name}`" :aria-selected="tab === name" aria-controls="ai-tab-panel"
                                class="min-h-[44px] cursor-pointer rounded-lg text-sm font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                                :class="tab === name ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-700 hover:text-gray-900'"
                                @click="showTab(name)">{{ $t(`ai.history.tab_${name}`) }}</button>
                        </div>

                        <div v-if="tab === 'history'" id="ai-tab-panel" role="tabpanel" aria-labelledby="ai-tab-history">
                            <AiHistoryList :entries="history" :loading="historyLoading" @open="openFromHistory" />
                        </div>

                        <div v-else id="ai-tab-panel" role="tabpanel" aria-labelledby="ai-tab-generate" class="space-y-5">
                        <!-- Kept suggestions from earlier lessons -->
                        <details v-if="bootstrap.kept_suggestions.length" class="rounded-xl border border-slate-300 bg-slate-100 p-4">
                            <summary class="cursor-pointer text-sm font-semibold text-slate-800">
                                {{ $t('ai.panel.previous_suggestions') }}
                                <span class="ml-1 text-xs font-normal text-slate-600">{{ $t('ai.panel.internal_only') }}</span>
                            </summary>
                            <div v-for="item in bootstrap.kept_suggestions" :key="item.generationId" class="mt-3">
                                <p class="text-xs font-semibold text-slate-600">{{ item.date }}</p>
                                <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">
                                    <li v-for="(text, i) in item.suggestions" :key="i">{{ text }}</li>
                                </ul>
                            </div>
                        </details>

                        <!-- Context check -->
                        <section class="space-y-3 rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="ai-context-title">
                            <h3 id="ai-context-title" class="text-sm font-bold text-gray-900">{{ $t('ai.panel.context_title') }}</h3>
                            <ul v-if="warnings.length" class="space-y-1 text-sm text-amber-800">
                                <li v-for="code in warnings" :key="code" class="flex items-start gap-2">
                                    <svg class="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                    </svg>
                                    {{ $t(`ai.warnings.${code}`) }}
                                </li>
                            </ul>
                            <p v-else class="flex items-center gap-2 text-sm text-emerald-700">
                                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                                </svg>
                                {{ $t('ai.panel.context_ok') }}
                            </p>
                            <label class="block">
                                <span class="text-sm font-medium text-gray-800">{{ $t('ai.panel.focus_label') }}</span>
                                <textarea v-model="focus" rows="3" maxlength="4000"
                                    class="mt-1 w-full rounded-lg border px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                    :class="thinContext ? 'border-amber-400 bg-amber-50' : 'border-gray-300'"
                                    :placeholder="$t('ai.panel.focus_placeholder')"></textarea>
                            </label>
                        </section>

                        <!-- Style -->
                        <section class="space-y-3 rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="ai-style-title">
                            <h3 id="ai-style-title" class="text-sm font-bold text-gray-900">{{ $t('ai.panel.style_title') }}</h3>
                            <fieldset>
                                <legend class="text-sm font-medium text-gray-800">{{ $t('ai.panel.tone') }}</legend>
                                <div class="mt-1 flex flex-wrap gap-2">
                                    <label v-for="option in TONES" :key="option"
                                        class="inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500"
                                        :class="tone === option ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'">
                                        <input v-model="tone" type="radio" name="ai-tone" :value="option" class="sr-only" />
                                        {{ $t(`ai.tone.${option}`) }}
                                    </label>
                                </div>
                            </fieldset>
                            <fieldset>
                                <legend class="text-sm font-medium text-gray-800">{{ $t('ai.panel.length') }}</legend>
                                <div class="mt-1 flex flex-wrap gap-2">
                                    <label v-for="option in LENGTHS" :key="option"
                                        class="inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500"
                                        :class="length === option ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'">
                                        <input v-model="length" type="radio" name="ai-length" :value="option" class="sr-only" />
                                        {{ $t(`ai.length.${option}`) }}
                                    </label>
                                </div>
                            </fieldset>
                            <label v-if="templates?.length" class="block">
                                <span class="text-sm font-medium text-gray-800">{{ $t('ai.panel.template') }}</span>
                                <select v-model="templateId"
                                    class="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                                    <option value="">{{ $t('ai.panel.template_none') }}</option>
                                    <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option>
                                </select>
                            </label>
                            <label class="block">
                                <span class="text-sm font-medium text-gray-800">{{ $t('ai.panel.extra_label') }}</span>
                                <textarea v-model="extraInstructions" rows="2" maxlength="2000"
                                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                    :placeholder="$t('ai.panel.extra_placeholder')"></textarea>
                            </label>
                        </section>

                        <!-- Source -->
                        <section class="space-y-2 rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="ai-source-title">
                            <h3 id="ai-source-title" class="text-sm font-bold text-gray-900">{{ $t('ai.panel.source_title') }}</h3>
                            <p v-if="!bootstrap.sources.length" class="text-sm text-gray-700">{{ $t('ai.panel.no_sources') }}</p>
                            <template v-else>
                                <select :value="modelRowId" :aria-label="$t('ai.panel.source_title')"
                                    class="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                    @change="assist.selectSource(($event.target as HTMLSelectElement).value)">
                                    <optgroup v-if="siteSources.length" :label="$t('ai.panel.source_site')">
                                        <option v-for="source in siteSources" :key="source.model_row_id" :value="source.model_row_id">{{ sourceLabel(source) }}</option>
                                    </optgroup>
                                    <optgroup v-if="personalSources.length" :label="$t('ai.panel.source_personal')">
                                        <option v-for="source in personalSources" :key="source.model_row_id" :value="source.model_row_id">{{ sourceLabel(source) }}</option>
                                    </optgroup>
                                </select>
                                <p class="text-sm text-gray-600">
                                    <template v-if="selectedSource?.credential_scope === 'site'">{{ $t('ai.panel.quota_remaining', { n: quotaRemaining }) }}</template>
                                    <template v-else>{{ $t('ai.panel.personal_no_quota') }}</template>
                                </p>
                            </template>
                            <div v-if="sourceProblem" role="alert" class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                <p>{{ errorCode === 'AI_QUOTA_EXHAUSTED' || !errorCode ? $t('ai.errors.AI_QUOTA_EXHAUSTED') : errorMessage }}</p>
                                <div v-if="alternativeSources.length" class="mt-2 flex flex-wrap gap-2">
                                    <button v-for="source in alternativeSources" :key="source.model_row_id" type="button"
                                        class="min-h-[44px] cursor-pointer rounded-lg bg-white px-3 text-left font-semibold text-amber-900 ring-1 ring-amber-300 transition-colors duration-200 hover:bg-amber-100"
                                        @click="assist.selectSource(source.model_row_id)">{{ $t('ai.panel.switch_to', { name: sourceLabel(source) }) }}</button>
                                </div>
                                <p v-else class="mt-1">{{ $t('ai.panel.no_alternative') }}</p>
                            </div>
                        </section>

                        <!-- De-identified preview -->
                        <details class="rounded-xl border border-gray-200 bg-white p-4" @toggle="onPreviewToggle">
                            <summary class="cursor-pointer text-sm font-semibold text-gray-800">{{ $t('ai.panel.preview_title') }}</summary>
                            <p class="mt-2 text-xs text-gray-600">{{ $t('ai.panel.preview_hint') }}</p>
                            <p v-if="previewLoading" class="mt-2 text-sm text-gray-600" role="status">{{ $t('ai.panel.preview_loading') }}</p>
                            <pre v-else-if="preview" class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-100 p-3 text-xs text-gray-800">{{ preview.prompt }}</pre>
                        </details>

                        <!-- Generate -->
                        <div class="space-y-2">
                            <button v-if="!generating" type="button" :disabled="!canGenerate"
                                class="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-bold text-white shadow-sm transition-colors duration-200 hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                                @click="assist.generate(beforeGenerate)">
                                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                {{ versions.length ? $t('ai.panel.regenerate') : $t('ai.panel.generate') }}
                                <span v-if="selectedSource?.credential_scope === 'site'" class="text-sm font-normal opacity-90">
                                    （{{ $t('ai.panel.costs', { n: selectedSource.quota_weight }) }}）</span>
                            </button>
                            <button v-else type="button"
                                class="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-base font-semibold text-gray-800 transition-colors duration-200 hover:bg-gray-50"
                                @click="assist.cancel()">
                                <span class="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent motion-reduce:animate-none" aria-hidden="true"></span>
                                {{ $t('ai.panel.cancel') }}
                            </button>
                            <p v-if="errorMessage && !sourceProblem" role="alert" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ errorMessage }}</p>
                        </div>

                        <!-- Results -->
                        <section v-if="generating || current" class="space-y-3" aria-labelledby="ai-result-title" aria-live="polite" :aria-busy="generating">
                            <div class="flex items-center justify-between">
                                <h3 id="ai-result-title" class="text-sm font-bold text-gray-900">
                                    {{ generating ? $t('ai.panel.generating') : $t('ai.panel.result_title') }}
                                </h3>
                                <div v-if="versions.length > 1 && !generating" class="flex items-center gap-1">
                                    <button type="button" :disabled="currentIndex === 0" :aria-label="$t('ai.panel.previous_version')"
                                        class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                                        @click="assist.showVersion(currentIndex - 1)">‹</button>
                                    <span class="text-sm tabular-nums text-gray-700">{{ currentIndex + 1 }} / {{ versions.length }}</span>
                                    <button type="button" :disabled="currentIndex === versions.length - 1" :aria-label="$t('ai.panel.next_version')"
                                        class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                                        @click="assist.showVersion(currentIndex + 1)">›</button>
                                </div>
                            </div>

                            <p v-if="following" role="status" class="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                                <span class="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-sky-600 border-t-transparent motion-reduce:animate-none" aria-hidden="true"></span>
                                {{ $t('ai.panel.following') }}
                            </p>

                            <p v-if="current?.unresolved_placeholders.length && !generating" class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                {{ $t('ai.panel.unresolved', { tokens: current.unresolved_placeholders.join('、') }) }}
                            </p>

                            <AiSectionCard v-for="(section, i) in visibleSections" :key="section.key ?? i"
                                :title="section.title" :body="section.body" :streaming="generating"
                                @insert="insertSection(section)" @copy="copySection(section)" />
                            <p v-if="copiedKey" class="text-sm text-emerald-700" role="status">{{ $t('ai.panel.copied') }}</p>

                            <div v-if="current && !generating" class="flex flex-wrap gap-2">
                                <button type="button"
                                    class="min-h-[44px] cursor-pointer rounded-lg border border-emerald-600 bg-white px-4 text-sm font-semibold text-emerald-700 transition-colors duration-200 hover:bg-emerald-50"
                                    @click="appendAll">{{ $t('ai.panel.append_all') }}</button>
                                <button type="button"
                                    class="min-h-[44px] cursor-pointer rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-emerald-700"
                                    @click="replaceAll">{{ $t('ai.panel.replace_all') }}</button>
                            </div>

                            <!-- Internal teaching suggestions -->
                            <article v-if="visibleSuggestions.length || (current && !generating)"
                                class="rounded-xl border border-slate-300 bg-slate-100 p-4">
                                <h4 class="flex items-center gap-2 text-sm font-bold text-slate-900">
                                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                    {{ $t('ai.panel.suggestions_title') }}
                                    <span class="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-semibold text-white">{{ $t('ai.panel.internal_only') }}</span>
                                </h4>
                                <p v-if="!visibleSuggestions.length" class="mt-2 text-sm text-slate-700">{{ $t('ai.panel.no_suggestions') }}</p>
                                <ul class="mt-2 space-y-3">
                                    <li v-for="(text, index) in visibleSuggestions" :key="index" class="text-sm text-slate-800">
                                        <p class="whitespace-pre-wrap">{{ text }}</p>
                                        <div v-if="current && !generating" class="mt-2 flex gap-2">
                                            <button type="button" :aria-pressed="current.suggestionStates[index] === 'kept'"
                                                class="min-h-[44px] cursor-pointer rounded-lg px-3 text-sm font-semibold transition-colors duration-200"
                                                :class="current.suggestionStates[index] === 'kept' ? 'bg-slate-800 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50'"
                                                @click="assist.setSuggestionState(index, 'kept')">{{ $t('ai.panel.keep') }}</button>
                                            <button type="button" :aria-pressed="current.suggestionStates[index] === 'dismissed'"
                                                class="min-h-[44px] cursor-pointer rounded-lg px-3 text-sm font-semibold transition-colors duration-200"
                                                :class="current.suggestionStates[index] === 'dismissed' ? 'bg-slate-500 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'"
                                                @click="assist.setSuggestionState(index, 'dismissed')">{{ $t('ai.panel.dismiss') }}</button>
                                        </div>
                                    </li>
                                </ul>
                            </article>
                        </section>
                        </div>
                    </template>
                </div>
            </section>
        </div>

        <ConfirmModal :is-open="confirmReplace" stacked :title="$t('ai.panel.replace_confirm_title')"
            :message="$t('ai.panel.replace_confirm_message')" :confirm-text="$t('ai.panel.replace_all')"
            is-dangerous @confirm="applyReplace" @close="confirmReplace = false" />
    </Teleport>
</template>
