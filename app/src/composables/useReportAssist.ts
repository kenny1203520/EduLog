import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import {
    ReportAssistService,
    type GenerationHistoryEntry,
    type GenerationResult,
    type PartialReportDraft,
    type ReportAssistBootstrap,
    type ReportAssistPreview,
    type ReportDraftSection,
    type ReportLength,
    type ReportSectionKey,
    type ReportTone,
} from '@/services/ai/ReportAssistService'

export type ReportAssistStatus = 'idle' | 'loading' | 'ready' | 'generating' | 'error'

/** Quota-related errors that the panel answers by offering another source. */
const SOURCE_ERRORS = new Set(['AI_QUOTA_EXHAUSTED', 'AI_PLAN_LIMIT_REACHED', 'AI_CREDENTIAL_INVALID', 'AI_MODEL_NOT_FOUND', 'AI_SECRET_KEY_MISSING'])

/** How often, and for how long, the panel checks on a generation whose stream it lost. */
export const FOLLOW_INTERVAL_MS = 5_000
export const FOLLOW_LIMIT_MS = 5 * 60_000

/** Panel error codes for how a generation ended, keyed by its logged error code. */
const ENDED_ERRORS: Record<string, string> = {
    CANCELLED: 'AI_GENERATION_CANCELLED',
    TIMEOUT: 'AI_GENERATION_TIMEOUT',
    PLAN_LIMIT: 'AI_PLAN_LIMIT_REACHED',
    EMPTY_OUTPUT: 'AI_EMPTY_OUTPUT',
    INTERRUPTED: 'AI_GENERATION_INTERRUPTED',
    RATE_LIMITED: 'AI_RATE_LIMITED',
    MODEL_UNSUPPORTED: 'AI_MODEL_UNSUPPORTED',
    INVALID_OUTPUT: 'AI_INVALID_OUTPUT',
    DATA_POLICY: 'AI_DATA_POLICY',
    AUTH_FAILED: 'AI_CREDENTIAL_INVALID',
}

/** "HTTP 429 – Rate limit exceeded", from a stored provider error. */
export function providerReason(detail: GenerationHistoryEntry['error_detail']): string | null {
    if (!detail) return null
    const parts = [detail.status ? `HTTP ${detail.status}` : null, detail.message].filter(Boolean)
    return parts.length ? parts.join(' – ') : null
}

export function endedErrorCode(entry: Pick<GenerationHistoryEntry, 'status' | 'error_code'>): string {
    if (entry.status === 'cancelled') return 'AI_GENERATION_CANCELLED'
    return ENDED_ERRORS[entry.error_code ?? ''] ?? 'AI_PROVIDER_ERROR'
}

export interface ReportAssistVersion extends GenerationResult {
    suggestionStates: Record<number, 'kept' | 'dismissed'>
}

/**
 * State of the AI report assistant panel for one report: bootstrap data, the
 * teacher's options, streamed drafts and every version generated while the
 * panel is open. Network calls go through ReportAssistService.
 */
export function useReportAssist(reportId: Ref<string | undefined>, service = ReportAssistService) {
    const status = ref<ReportAssistStatus>('idle')
    const bootstrap = shallowRef<ReportAssistBootstrap | null>(null)
    const errorCode = ref<string | null>(null)
    /** What the AI provider said about the last failure, shown under the error. */
    const errorReason = ref<string | null>(null)

    const tone = ref<ReportTone>('warm')
    const length = ref<ReportLength>('medium')
    const extraInstructions = ref('')
    const focus = ref('')
    const templateId = ref<string>('')
    const modelRowId = ref<string>('')

    const partial = shallowRef<PartialReportDraft | null>(null)
    const versions = ref<ReportAssistVersion[]>([])
    const currentIndex = ref(-1)
    const preview = shallowRef<ReportAssistPreview | null>(null)
    const previewLoading = ref(false)
    /** The generation in progress, once the server has recorded it. */
    const runningId = ref<string | null>(null)
    /** The stream was lost (or the panel reopened) while the server keeps generating. */
    const following = ref(false)
    const history = ref<GenerationHistoryEntry[]>([])
    const historyLoading = ref(false)
    let controller: AbortController | null = null
    let cancelRequested = false
    let followTimer: ReturnType<typeof setTimeout> | null = null

    const current = computed(() => versions.value[currentIndex.value] ?? null)
    const selectedSource = computed(() => bootstrap.value?.sources.find((source) => source.model_row_id === modelRowId.value) ?? null)
    const quotaRemaining = computed(() => bootstrap.value?.quota.remaining ?? 0)
    const needsNotice = computed(() => bootstrap.value !== null && !bootstrap.value.notice.acknowledged)
    const sourceProblem = computed(() => (errorCode.value && SOURCE_ERRORS.has(errorCode.value)) || (
        selectedSource.value?.credential_scope === 'site' && quotaRemaining.value < selectedSource.value.quota_weight
    ))
    const alternativeSources = computed(() => (bootstrap.value?.sources ?? []).filter((source) =>
        source.model_row_id !== modelRowId.value && (source.credential_scope === 'user' || quotaRemaining.value >= source.quota_weight)))
    /**
     * The settings block is open until there is a result, and whenever the
     * source needs attention; the teacher can still open or close it.
     */
    const settingsOverride = ref<boolean | null>(null)
    const settingsExpanded = computed(() => settingsOverride.value
        ?? ((!current.value && status.value !== 'generating') || Boolean(sourceProblem.value)))
    function toggleSettings() {
        settingsOverride.value = !settingsExpanded.value
    }
    watch(() => versions.value.length, () => { settingsOverride.value = null })
    watch(sourceProblem, (problem) => { if (problem) settingsOverride.value = null })

    const canGenerate = computed(() => Boolean(reportId.value && bootstrap.value?.enabled && !needsNotice.value && selectedSource.value && status.value !== 'generating' && !sourceProblem.value))

    function chooseInitialSource(data: ReportAssistBootstrap) {
        const ids = new Set(data.sources.map((source) => source.model_row_id))
        const remembered = data.preferences.last_model_row_id
        modelRowId.value = (remembered && ids.has(remembered) && remembered)
            || (data.default_model_row_id && ids.has(data.default_model_row_id) && data.default_model_row_id)
            || data.sources[0]?.model_row_id
            || ''
    }

    async function load() {
        if (!reportId.value) return
        status.value = 'loading'
        errorCode.value = null
        try {
            const data = await service.bootstrap(reportId.value)
            bootstrap.value = data
            tone.value = data.preferences.tone ?? tone.value
            length.value = data.preferences.length ?? length.value
            chooseInitialSource(data)
            status.value = 'ready'
            if (data.latest?.status === 'succeeded') addVersion(data.latest)
            else if (data.latest?.status === 'running') follow(data.latest.generation_id)
        } catch (error) {
            errorCode.value = codeOf(error)
            status.value = 'error'
        }
    }

    async function acknowledgeNotice() {
        await service.acknowledgeNotice()
        if (bootstrap.value) bootstrap.value = { ...bootstrap.value, notice: { ...bootstrap.value.notice, acknowledged: true } }
    }

    function options() {
        return {
            tone: tone.value,
            length: length.value,
            extra_instructions: extraInstructions.value.trim() || undefined,
            focus: focus.value.trim() || undefined,
            template_id: templateId.value || undefined,
        }
    }

    async function loadPreview() {
        if (!reportId.value) return
        previewLoading.value = true
        try {
            preview.value = await service.preview(reportId.value, options())
        } catch (error) {
            errorCode.value = codeOf(error)
        } finally {
            previewLoading.value = false
        }
    }

    /** Generate a new version. `beforeGenerate` lets the editor flush unsaved notes first. */
    async function generate(beforeGenerate?: () => Promise<boolean>) {
        if (!canGenerate.value || !reportId.value) return
        if (beforeGenerate && !await beforeGenerate()) {
            errorCode.value = 'AI_SAVE_REQUIRED'
            return
        }
        status.value = 'generating'
        errorCode.value = null
        errorReason.value = null
        partial.value = null
        runningId.value = null
        cancelRequested = false
        controller = new AbortController()
        const source = selectedSource.value!
        try {
            const result = await service.generate(reportId.value, {
                model_row_id: source.model_row_id,
                options: options(),
                session_seq: versions.value.length + 1,
            }, {
                signal: controller.signal,
                onStarted: (id) => {
                    runningId.value = id
                    if (cancelRequested) void service.cancel(id).catch(() => {})
                },
                onPartial: (draft) => { partial.value = draft },
            })
            versions.value = [...versions.value, { ...result, suggestionStates: {} }]
            currentIndex.value = versions.value.length - 1
            if (bootstrap.value && result.quota_remaining !== null) {
                bootstrap.value = { ...bootstrap.value, quota: { ...bootstrap.value.quota, remaining: result.quota_remaining } }
            }
            void service.savePreferences({ tone: tone.value, length: length.value, last_model_row_id: source.model_row_id }).catch(() => {})
            status.value = 'ready'
            runningId.value = null
        } catch (error) {
            if (runningId.value && !controller.signal.aborted && isDetached(error)) {
                // The server is still generating; check the history until it finishes.
                follow(runningId.value)
            } else {
                errorCode.value = controller.signal.aborted ? 'AI_GENERATION_CANCELLED' : codeOf(error)
                errorReason.value = error instanceof ApiV1Error ? error.reason ?? null : null
                status.value = 'ready'
                runningId.value = null
            }
        } finally {
            partial.value = null
            controller = null
        }
    }

    /** Wait for a generation whose stream is gone, by polling the report's history. */
    function follow(generationId: string) {
        stopFollowing()
        runningId.value = generationId
        following.value = true
        status.value = 'generating'
        errorCode.value = null
        errorReason.value = null
        const deadline = Date.now() + FOLLOW_LIMIT_MS
        const check = async () => {
            followTimer = null
            if (!following.value || !reportId.value) return
            const entries = await service.history(reportId.value).catch(() => null)
            if (!following.value) return
            if (entries) history.value = entries
            const entry = entries?.find((item) => item.generation_id === generationId)
            if (entry && entry.status !== 'running') {
                finishFollowing()
                if (entry.status === 'succeeded') addVersion(entry)
                else {
                    errorCode.value = endedErrorCode(entry)
                    errorReason.value = providerReason(entry.error_detail)
                }
                if (entry.quota_charged > 0) void refreshQuota()
                return
            }
            if (Date.now() > deadline) {
                finishFollowing()
                errorCode.value = 'AI_GENERATION_INTERRUPTED'
                return
            }
            followTimer = setTimeout(check, FOLLOW_INTERVAL_MS)
        }
        followTimer = setTimeout(check, FOLLOW_INTERVAL_MS)
    }

    function stopFollowing() {
        if (followTimer) clearTimeout(followTimer)
        followTimer = null
        following.value = false
    }

    function finishFollowing() {
        stopFollowing()
        runningId.value = null
        status.value = 'ready'
    }

    async function refreshQuota() {
        if (!reportId.value) return
        const data = await service.bootstrap(reportId.value).catch(() => null)
        if (data && bootstrap.value) bootstrap.value = { ...bootstrap.value, quota: data.quota }
    }

    /** Stop the generation on the server. Only this stops it; closing the panel or losing the connection does not. */
    async function cancel() {
        const id = runningId.value
        if (!id) {
            // Not recorded yet: stop it as soon as the server reports its id.
            cancelRequested = true
            return
        }
        try {
            await service.cancel(id)
        } catch (error) {
            errorCode.value = codeOf(error)
        }
        // The stream (or, when following, the next history check) reports the outcome.
    }

    /** Leave the editor: stop listening but let the server finish; the result stays in the history. */
    function dispose() {
        stopFollowing()
        controller?.abort()
    }

    /** Show a stored generation in the result area. */
    function addVersion(entry: GenerationHistoryEntry) {
        if (!entry.draft) return
        const existing = versions.value.findIndex((version) => version.generation_id === entry.generation_id)
        if (existing >= 0) {
            currentIndex.value = existing
            return
        }
        versions.value = [...versions.value, {
            generation_id: entry.generation_id,
            draft: entry.draft,
            unresolved_placeholders: entry.unresolved_placeholders,
            quota_charged: entry.quota_charged,
            quota_remaining: null,
            suggestionStates: { ...entry.suggestion_states },
        }]
        currentIndex.value = versions.value.length - 1
    }

    async function loadHistory() {
        if (!reportId.value) return
        historyLoading.value = true
        try {
            history.value = await service.history(reportId.value)
        } catch (error) {
            errorCode.value = codeOf(error)
        } finally {
            historyLoading.value = false
        }
    }

    function selectSource(id: string) {
        modelRowId.value = id
        if (errorCode.value && SOURCE_ERRORS.has(errorCode.value)) {
            errorCode.value = null
            errorReason.value = null
        }
    }

    function showVersion(index: number) {
        if (index >= 0 && index < versions.value.length) currentIndex.value = index
    }

    /** Record that the teacher used generated text; failures never block the editor. */
    async function recordAdoption(sectionKey: ReportSectionKey | 'all', action: 'insert' | 'replace' | 'copy' | 'adopt_all') {
        const version = current.value
        if (!version) return
        await service.recordAdoption(version.generation_id, sectionKey, action).catch(() => {})
    }

    async function setSuggestionState(index: number, state: 'kept' | 'dismissed') {
        const version = current.value
        if (!version) return
        const previous = version.suggestionStates[index]
        version.suggestionStates = { ...version.suggestionStates, [index]: state }
        try {
            await service.setSuggestionState(version.generation_id, index, state)
        } catch (error) {
            version.suggestionStates = { ...version.suggestionStates, [index]: previous }
            errorCode.value = codeOf(error)
        }
    }

    /** Sections to render: the streaming partial while generating, else the selected version. */
    const visibleSections = computed<Array<Partial<ReportDraftSection>>>(() => {
        if (status.value === 'generating') return (partial.value?.sections ?? []).filter((section): section is Partial<ReportDraftSection> => Boolean(section))
        return current.value?.draft.sections ?? []
    })
    const visibleSuggestions = computed<string[]>(() => {
        if (status.value === 'generating') return (partial.value?.teachingSuggestions ?? []).filter((text): text is string => typeof text === 'string')
        return current.value?.draft.teachingSuggestions ?? []
    })

    return {
        status, bootstrap, errorCode, errorReason, tone, length, extraInstructions, focus, templateId, modelRowId,
        versions, currentIndex, current, preview, previewLoading, selectedSource, quotaRemaining,
        needsNotice, sourceProblem, alternativeSources, canGenerate, visibleSections, visibleSuggestions,
        following, history, historyLoading, settingsExpanded, toggleSettings,
        load, acknowledgeNotice, loadPreview, generate, cancel, dispose, selectSource, showVersion, recordAdoption, setSuggestionState,
        loadHistory, addVersion,
    }
}

/** The stream broke rather than the server reporting a failure, so the generation may still finish. */
function isDetached(error: unknown): boolean {
    if (error instanceof ApiV1Error) return error.code === 'AI_STREAM_INTERRUPTED'
    return true
}

function codeOf(error: unknown): string {
    if (error instanceof ApiV1Error) return error.code
    if (error instanceof Error && error.message === 'Network offline') return 'NETWORK_OFFLINE'
    return 'AI_UNKNOWN_ERROR'
}
