import { computed, ref, shallowRef, type Ref } from 'vue'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import {
    ReportAssistService,
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
    let controller: AbortController | null = null

    const current = computed(() => versions.value[currentIndex.value] ?? null)
    const selectedSource = computed(() => bootstrap.value?.sources.find((source) => source.model_row_id === modelRowId.value) ?? null)
    const quotaRemaining = computed(() => bootstrap.value?.quota.remaining ?? 0)
    const needsNotice = computed(() => bootstrap.value !== null && !bootstrap.value.notice.acknowledged)
    const sourceProblem = computed(() => (errorCode.value && SOURCE_ERRORS.has(errorCode.value)) || (
        selectedSource.value?.credential_scope === 'site' && quotaRemaining.value < selectedSource.value.quota_weight
    ))
    const alternativeSources = computed(() => (bootstrap.value?.sources ?? []).filter((source) =>
        source.model_row_id !== modelRowId.value && (source.credential_scope === 'user' || quotaRemaining.value >= source.quota_weight)))
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
        partial.value = null
        controller = new AbortController()
        const source = selectedSource.value!
        try {
            const result = await service.generate(reportId.value, {
                model_row_id: source.model_row_id,
                options: options(),
                session_seq: versions.value.length + 1,
            }, { signal: controller.signal, onPartial: (draft) => { partial.value = draft } })
            versions.value = [...versions.value, { ...result, suggestionStates: {} }]
            currentIndex.value = versions.value.length - 1
            if (bootstrap.value && result.quota_remaining !== null) {
                bootstrap.value = { ...bootstrap.value, quota: { ...bootstrap.value.quota, remaining: result.quota_remaining } }
            }
            void service.savePreferences({ tone: tone.value, length: length.value, last_model_row_id: source.model_row_id }).catch(() => {})
            status.value = 'ready'
        } catch (error) {
            errorCode.value = controller.signal.aborted ? 'AI_GENERATION_CANCELLED' : codeOf(error)
            status.value = 'ready'
        } finally {
            partial.value = null
            controller = null
        }
    }

    function cancel() {
        controller?.abort()
    }

    function selectSource(id: string) {
        modelRowId.value = id
        if (errorCode.value && SOURCE_ERRORS.has(errorCode.value)) errorCode.value = null
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
        status, bootstrap, errorCode, tone, length, extraInstructions, focus, templateId, modelRowId,
        versions, currentIndex, current, preview, previewLoading, selectedSource, quotaRemaining,
        needsNotice, sourceProblem, alternativeSources, canGenerate, visibleSections, visibleSuggestions,
        load, acknowledgeNotice, loadPreview, generate, cancel, selectSource, showVersion, recordAdoption, setSuggestionState,
    }
}

function codeOf(error: unknown): string {
    if (error instanceof ApiV1Error) return error.code
    if (error instanceof Error && error.message === 'Network offline') return 'NETWORK_OFFLINE'
    return 'AI_UNKNOWN_ERROR'
}
