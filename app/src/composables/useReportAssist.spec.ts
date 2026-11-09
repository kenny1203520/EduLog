import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import type { GenerationHistoryEntry, ReportAssistBootstrap, ReportAssistService } from '@/services/ai/ReportAssistService'
import { FOLLOW_INTERVAL_MS, useReportAssist } from './useReportAssist'

const site = { model_row_id: 'site', model_id: 'sonnet', display_name: 'Sonnet', provider: 'anthropic' as const, credential_scope: 'site' as const, credential_label: 'School', quota_weight: 2, is_default: true }
const mine = { ...site, model_row_id: 'mine', credential_scope: 'user' as const, credential_label: 'My key', quota_weight: 0, is_default: false }

function bootstrap(overrides: Partial<ReportAssistBootstrap> = {}): ReportAssistBootstrap {
    return {
        enabled: true, notice: { version: 1, acknowledged: true }, default_model_row_id: 'site', sources: [site, mine],
        quota: { remaining: 5, periodic: null, one_time: { total: 5, used: 0, remaining: 5 } },
        warnings: [], kept_suggestions: [], latest: null, preferences: {},
        ...overrides,
    }
}

function fakeService(data = bootstrap()) {
    return {
        bootstrap: vi.fn().mockResolvedValue(data),
        preview: vi.fn(),
        acknowledgeNotice: vi.fn().mockResolvedValue(undefined),
        savePreferences: vi.fn().mockResolvedValue(undefined),
        setSuggestionState: vi.fn().mockResolvedValue(undefined),
        recordAdoption: vi.fn().mockResolvedValue(undefined),
        history: vi.fn().mockResolvedValue([] as GenerationHistoryEntry[]),
        cancel: vi.fn().mockResolvedValue(true),
        generate: vi.fn(async (_id: string, body: { session_seq: number }, hooks: { onPartial?: (d: unknown) => void }) => {
            hooks.onPartial?.({ sections: [{ key: 'today', body: '部分' }] })
            return { generation_id: `g${body.session_seq}`, draft: { sections: [{ key: 'today', title: '今日', body: `v${body.session_seq}` }], teachingSuggestions: ['建議'] }, unresolved_placeholders: [], quota_charged: 2, quota_remaining: 3 }
        }),
    } satisfies Record<keyof typeof ReportAssistService, unknown>
}

function entry(overrides: Partial<GenerationHistoryEntry> = {}): GenerationHistoryEntry {
    return {
        generation_id: 'g9', status: 'succeeded', created_at: '2026-10-20T08:00:00Z', completed_at: '2026-10-20T08:00:20Z',
        provider: 'ollama', model_id: 'qwen', error_code: null, quota_charged: 2,
        draft: { sections: [{ key: 'today', title: '今日', body: '已存的結果' }], teachingSuggestions: ['建議'] },
        unresolved_placeholders: [], suggestion_states: { 0: 'kept' }, adoption_count: 0,
        input: { system_prompt: null, prompt_version: null, prompt: null }, error_detail: null,
        ...overrides,
    }
}

afterEach(() => { vi.useRealTimers() })

describe('useReportAssist', () => {
    it('restores remembered preferences and source on load', async () => {
        const service = fakeService(bootstrap({ preferences: { tone: 'formal', length: 'long', last_model_row_id: 'mine' } }))
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        expect(assist.tone.value).toBe('formal')
        expect(assist.length.value).toBe('long')
        expect(assist.modelRowId.value).toBe('mine')
    })

    it('keeps every generated version, updates quota and remembers the choice', async () => {
        const service = fakeService()
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        const save = vi.fn().mockResolvedValue(true)
        await assist.generate(save)
        await assist.generate(save)

        expect(save).toHaveBeenCalledTimes(2)
        expect(assist.versions.value.map((version) => version.generation_id)).toEqual(['g1', 'g2'])
        expect(assist.currentIndex.value).toBe(1)
        expect(assist.quotaRemaining.value).toBe(3)
        assist.showVersion(0)
        expect(assist.visibleSections.value[0].body).toBe('v1')
        expect(service.savePreferences).toHaveBeenCalledWith({ tone: 'warm', length: 'medium', last_model_row_id: 'site' })
    })

    it('blocks a site source without enough quota and offers the personal one', async () => {
        const assist = useReportAssist(ref('r1'), fakeService(bootstrap({ quota: { remaining: 1, periodic: null, one_time: { total: 1, used: 0, remaining: 1 } } })) as never)
        await assist.load()
        expect(assist.sourceProblem.value).toBe(true)
        expect(assist.canGenerate.value).toBe(false)
        expect(assist.alternativeSources.value.map((source) => source.model_row_id)).toEqual(['mine'])
        assist.selectSource('mine')
        expect(assist.canGenerate.value).toBe(true)
    })

    it('lets the teacher try again once another model is picked after a model error', async () => {
        const service = fakeService()
        service.generate.mockRejectedValueOnce(new ApiV1Error(404, { error: { code: 'AI_MODEL_NOT_FOUND', message: '', request_id: '', trace_id: '' } }))
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        await assist.generate()
        expect(assist.errorCode.value).toBe('AI_MODEL_NOT_FOUND')
        expect(assist.canGenerate.value).toBe(false)

        // The picker writes the ref directly, as v-model does.
        assist.modelRowId.value = 'mine'
        await nextTick()
        expect(assist.errorCode.value).toBeNull()
        expect(assist.canGenerate.value).toBe(true)
    })

    it('refreshes the models on reopen, keeping versions and falling back to the default', async () => {
        const service = fakeService(bootstrap({ preferences: { last_model_row_id: 'mine' } }))
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        await assist.generate()
        expect(assist.modelRowId.value).toBe('mine')

        service.generate.mockRejectedValueOnce(new ApiV1Error(409, { error: { code: 'AI_CREDENTIAL_INVALID', message: '', request_id: '', trace_id: '' } }))
        await assist.generate()
        expect(assist.canGenerate.value).toBe(false)

        // The personal key was disabled while the panel was closed.
        service.bootstrap.mockResolvedValueOnce(bootstrap({ sources: [site], preferences: { last_model_row_id: 'mine' } }))
        await assist.refreshSources()
        expect(service.bootstrap).toHaveBeenCalledTimes(2)
        expect(assist.modelRowId.value).toBe('site')
        expect(assist.errorCode.value).toBeNull()
        expect(assist.canGenerate.value).toBe(true)
        expect(assist.versions.value).toHaveLength(1)
    })

    it('clears a model error on reopen even when the same model is still offered', async () => {
        const service = fakeService()
        service.generate.mockRejectedValueOnce(new ApiV1Error(409, { error: { code: 'AI_CREDENTIAL_INVALID', message: '', request_id: '', trace_id: '' } }))
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        await assist.generate()
        expect(assist.canGenerate.value).toBe(false)
        await assist.refreshSources()
        expect(assist.modelRowId.value).toBe('site')
        expect(assist.canGenerate.value).toBe(true)
    })

    it('does not generate when saving the report fails', async () => {
        const service = fakeService()
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        await assist.generate(async () => false)
        expect(service.generate).not.toHaveBeenCalled()
        expect(assist.errorCode.value).toBe('AI_SAVE_REQUIRED')
    })

    it('surfaces server error codes and reverts a failed suggestion update', async () => {
        const service = fakeService()
        service.generate.mockRejectedValueOnce(new ApiV1Error(503, { error: { code: 'AI_DEIDENTIFICATION_UNAVAILABLE', message: '', request_id: '', trace_id: '' } }))
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        await assist.generate()
        expect(assist.errorCode.value).toBe('AI_DEIDENTIFICATION_UNAVAILABLE')
        expect(assist.versions.value).toEqual([])

        await assist.generate()
        service.setSuggestionState.mockRejectedValueOnce(new ApiV1Error(404, { error: { code: 'NOT_FOUND', message: '', request_id: '', trace_id: '' } }))
        await assist.setSuggestionState(0, 'kept')
        expect(assist.current.value?.suggestionStates[0]).toBeUndefined()
    })

    it('reopens on the latest saved result with its kept suggestions', async () => {
        const assist = useReportAssist(ref('r1'), fakeService(bootstrap({ latest: entry() })) as never)
        await assist.load()
        expect(assist.current.value?.generation_id).toBe('g9')
        expect(assist.visibleSections.value[0].body).toBe('已存的結果')
        expect(assist.current.value?.suggestionStates).toEqual({ 0: 'kept' })
    })

    it('keeps waiting for the server when the stream drops after the generation started', async () => {
        vi.useFakeTimers()
        const service = fakeService()
        service.generate.mockImplementationOnce(async (_id, _body, hooks: { onStarted?: (id: string) => void }) => {
            hooks.onStarted?.('g9')
            throw new TypeError('network error')
        })
        service.history
            .mockResolvedValueOnce([entry({ status: 'running', draft: null })])
            .mockResolvedValueOnce([entry()])
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        await assist.generate()

        expect(assist.following.value).toBe(true)
        expect(assist.status.value).toBe('generating')
        expect(assist.errorCode.value).toBeNull()

        await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL_MS)
        expect(assist.following.value).toBe(true)
        await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL_MS)
        expect(assist.following.value).toBe(false)
        expect(assist.status.value).toBe('ready')
        expect(assist.current.value?.generation_id).toBe('g9')
    })

    it('reports how a followed generation ended when it did not succeed', async () => {
        vi.useFakeTimers()
        const service = fakeService(bootstrap({ latest: entry({ status: 'running', draft: null }) }))
        service.history.mockResolvedValueOnce([entry({ status: 'failed', error_code: 'TIMEOUT', draft: null, quota_charged: 0 })])
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        expect(assist.following.value).toBe(true)
        await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL_MS)
        expect(assist.errorCode.value).toBe('AI_GENERATION_TIMEOUT')
        expect(assist.versions.value).toEqual([])
    })

    it('stops a generation through the cancel request, also before the server reported its id', async () => {
        const service = fakeService()
        let started: ((id: string) => void) | undefined
        let finish: (() => void) | undefined
        service.generate.mockImplementationOnce((_id, _body, hooks: { onStarted?: (id: string) => void }) => new Promise((_, reject) => {
            started = hooks.onStarted
            finish = () => reject(new ApiV1Error(502, { error: { code: 'AI_GENERATION_CANCELLED', message: '', request_id: '', trace_id: '' } }))
        }))
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        const running = assist.generate()
        await assist.cancel()
        expect(service.cancel).not.toHaveBeenCalled()
        started!('g7')
        expect(service.cancel).toHaveBeenCalledWith('g7')
        finish!()
        await running
        expect(assist.errorCode.value).toBe('AI_GENERATION_CANCELLED')
        expect(assist.following.value).toBe(false)
    })

    it('leaving the panel stops listening without cancelling', async () => {
        vi.useFakeTimers()
        const service = fakeService(bootstrap({ latest: entry({ status: 'running', draft: null }) }))
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        assist.dispose()
        await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL_MS * 2)
        expect(service.history).not.toHaveBeenCalled()
        expect(service.cancel).not.toHaveBeenCalled()
    })

    it('shows what the AI service said, from the stream or from a followed generation', async () => {
        vi.useFakeTimers()
        const service = fakeService()
        service.generate.mockRejectedValueOnce(new ApiV1Error(502, { error: { code: 'AI_RATE_LIMITED', message: '', request_id: '', trace_id: '', details: { reason: 'HTTP 429 – Rate limit exceeded' } } }))
        const assist = useReportAssist(ref('r1'), service as never)
        await assist.load()
        await assist.generate()
        expect([assist.errorCode.value, assist.errorReason.value]).toEqual(['AI_RATE_LIMITED', 'HTTP 429 – Rate limit exceeded'])

        service.generate.mockImplementationOnce(async (_id, _body, hooks: { onStarted?: (id: string) => void }) => {
            hooks.onStarted?.('g9')
            throw new TypeError('network error')
        })
        service.history.mockResolvedValueOnce([entry({ status: 'failed', error_code: 'MODEL_UNSUPPORTED', draft: null, quota_charged: 0, error_detail: { status: 404, message: 'No endpoints found that support response_format' } })])
        await assist.generate()
        expect(assist.errorReason.value).toBeNull()
        await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL_MS)
        expect([assist.errorCode.value, assist.errorReason.value]).toEqual(['AI_MODEL_UNSUPPORTED', 'HTTP 404 – No endpoints found that support response_format'])
    })
})
