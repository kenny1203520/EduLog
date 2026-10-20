<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import AiGenerateSettings from '@/components/report-ai/AiGenerateSettings.vue'
import AiHistoryList from '@/components/report-ai/AiHistoryList.vue'
import AiNotice from '@/components/report-ai/AiNotice.vue'
import AiResultView from '@/components/report-ai/AiResultView.vue'
import { useReportAssist } from '@/composables/useReportAssist'
import type { GenerationHistoryEntry, ReportDraftSection } from '@/services/ai/ReportAssistService'
import { copyToClipboard } from '@/utils/clipboard'

/**
 * Right-hand drawer of the AI report assistant. It never edits the report by
 * itself: the teacher inserts or replaces text, which the editor applies.
 * Results come first; the settings fold away once there is a draft, and the
 * generate / stop button stays in the bar at the bottom.
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
    status, bootstrap, errorCode, errorReason, tone, length, extraInstructions, focus, templateId, modelRowId,
    versions, currentIndex, current, preview, previewLoading, selectedSource, quotaRemaining,
    needsNotice, sourceProblem, canGenerate, visibleSections, visibleSuggestions,
    following, history, historyLoading, settingsExpanded,
} = assist

const confirmReplace = ref(false)
const copiedKey = ref<string | null>(null)
const acknowledging = ref(false)
const tab = ref<'generate' | 'history'>('generate')

const generating = computed(() => status.value === 'generating')
const hasResult = computed(() => generating.value || current.value !== null)
const ready = computed(() => Boolean(props.reportId && bootstrap.value?.enabled && !needsNotice.value && status.value !== 'loading' && status.value !== 'idle'))
const fullText = computed(() => (current.value?.draft.sections ?? []).map((section) => section.body).join('\n\n'))
const errorMessage = computed(() => {
    if (!errorCode.value) return ''
    const key = `ai.errors.${errorCode.value}`
    const message = t(key)
    return message === key ? t('ai.errors.AI_UNKNOWN_ERROR') : message
})
const sourceProblemMessage = computed(() => (errorCode.value && errorCode.value !== 'AI_QUOTA_EXHAUSTED' ? errorMessage.value : t('ai.errors.AI_QUOTA_EXHAUSTED')))
const footerError = computed(() => (errorMessage.value && !sourceProblem.value && status.value !== 'error' ? errorMessage.value : ''))
const costLabel = computed(() => {
    const source = selectedSource.value
    if (!source) return ''
    return source.credential_scope === 'site'
        ? t('ai.panel.quota_left', { n: quotaRemaining.value })
        : t('ai.panel.personal_no_quota_short')
})

watch(() => [props.show, props.reportId] as const, ([show, reportId], previous) => {
    if (show && reportId && (status.value === 'idle' || reportId !== previous?.[1])) void assist.load()
}, { immediate: true })

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

function insertAll() {
    if (!fullText.value) return
    emit('insert', fullText.value)
    void assist.recordAdoption('all', 'adopt_all')
}

async function copyAll() {
    if (fullText.value && await copyToClipboard(fullText.value)) {
        copiedKey.value = 'all'
        setTimeout(() => { if (copiedKey.value === 'all') copiedKey.value = null }, 1500)
        void assist.recordAdoption('all', 'copy')
    }
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
                            <p class="text-sm text-gray-600">{{ $t('ai.panel.subtitle') }}</p>
                        </div>
                    </div>
                    <button type="button"
                        class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-gray-600 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                        :aria-label="$t('common.close')" @click="emit('close')">
                        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                <div class="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
                    <!-- Loading -->
                    <div v-if="status === 'loading' || status === 'idle'" class="space-y-3" aria-busy="true">
                        <div v-for="n in 3" :key="n" class="h-20 animate-pulse rounded-xl bg-gray-200 motion-reduce:animate-none"></div>
                    </div>

                    <AiNotice v-else-if="!reportId" tone="info" :message="$t('ai.panel.save_first')" />

                    <AiNotice v-else-if="status === 'error' && !bootstrap" tone="error" live="alert" :message="errorMessage" :detail="errorReason">
                        <template #actions>
                            <button type="button" class="min-h-[44px] cursor-pointer rounded-lg bg-white px-3 font-semibold text-red-800 ring-1 ring-red-200 hover:bg-red-100"
                                @click="assist.load()">{{ $t('ai.panel.retry') }}</button>
                        </template>
                    </AiNotice>

                    <AiNotice v-else-if="bootstrap && !bootstrap.enabled" tone="info" :message="$t('ai.panel.disabled')" />

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

                        <div v-else id="ai-tab-panel" role="tabpanel" aria-labelledby="ai-tab-generate" class="space-y-4">
                            <AiResultView v-if="hasResult"
                                :generating="generating" :following="following"
                                :sections="visibleSections" :suggestions="visibleSuggestions" :current="current"
                                :version-index="currentIndex" :version-count="versions.length"
                                :kept-suggestions="bootstrap.kept_suggestions" :copied-key="copiedKey"
                                @insert-section="insertSection" @copy-section="copySection"
                                @insert-all="insertAll" @replace-all="replaceAll" @copy-all="copyAll"
                                @show-version="assist.showVersion" @open-history="showTab('history')"
                                @set-suggestion="assist.setSuggestionState" />

                            <AiGenerateSettings
                                v-model:focus="focus" v-model:tone="tone" v-model:length="length"
                                v-model:template-id="templateId" v-model:extra-instructions="extraInstructions" v-model:model-row-id="modelRowId"
                                :expanded="settingsExpanded" :warnings="bootstrap.warnings" :has-draft="bootstrap.has_draft"
                                :templates="templates" :sources="bootstrap.sources" :selected-source="selectedSource"
                                :quota-remaining="quotaRemaining" :source-problem="Boolean(sourceProblem)" :source-problem-message="sourceProblemMessage"
                                :preview="preview" :preview-loading="previewLoading"
                                :kept-suggestions="hasResult ? [] : bootstrap.kept_suggestions"
                                @toggle="assist.toggleSettings()" @load-preview="assist.loadPreview()" />
                        </div>
                    </template>
                </div>

                <!-- Bottom bar: the one primary action, always in reach -->
                <footer v-if="ready && bootstrap && tab === 'generate'"
                    class="shrink-0 space-y-2 border-t border-gray-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
                    <AiNotice v-if="footerError" tone="error" live="alert" :message="footerError" :detail="errorReason" />
                    <div class="flex items-center gap-3">
                        <button v-if="!generating" type="button" :disabled="!canGenerate" data-testid="ai-generate"
                            class="inline-flex min-h-[48px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-bold text-white shadow-sm transition-colors duration-200 hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                            @click="assist.generate(beforeGenerate)">
                            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            {{ versions.length ? $t('ai.panel.regenerate') : $t('ai.panel.generate') }}
                            <span v-if="selectedSource?.credential_scope === 'site'" class="text-sm font-normal">（{{ $t('ai.panel.costs', { n: selectedSource.quota_weight }) }}）</span>
                        </button>
                        <button v-else type="button" data-testid="ai-stop"
                            class="inline-flex min-h-[48px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-base font-semibold text-gray-800 transition-colors duration-200 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                            @click="assist.cancel()">
                            <span class="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent motion-reduce:animate-none" aria-hidden="true"></span>
                            {{ $t('ai.panel.cancel') }}
                        </button>
                        <span v-if="costLabel" class="shrink-0 text-sm text-gray-700" data-testid="ai-quota-left">{{ costLabel }}</span>
                    </div>
                </footer>
            </section>
        </div>

        <ConfirmModal :is-open="confirmReplace" stacked :title="$t('ai.panel.replace_confirm_title')"
            :message="$t('ai.panel.replace_confirm_message')" :confirm-text="$t('ai.panel.replace_all')"
            is-dangerous @confirm="applyReplace" @close="confirmReplace = false" />
    </Teleport>
</template>
