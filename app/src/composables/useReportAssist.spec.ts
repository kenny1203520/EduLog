import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import type { ReportAssistBootstrap, ReportAssistService } from '@/services/ai/ReportAssistService'
import { useReportAssist } from './useReportAssist'

const site = { model_row_id: 'site', model_id: 'sonnet', display_name: 'Sonnet', provider: 'anthropic' as const, credential_scope: 'site' as const, credential_label: 'School', quota_weight: 2, is_default: true }
const mine = { ...site, model_row_id: 'mine', credential_scope: 'user' as const, credential_label: 'My key', quota_weight: 0, is_default: false }

function bootstrap(overrides: Partial<ReportAssistBootstrap> = {}): ReportAssistBootstrap {
    return {
        enabled: true, notice: { version: 1, acknowledged: true }, default_model_row_id: 'site', sources: [site, mine],
        quota: { remaining: 5, periodic: null, one_time: { total: 5, used: 0, remaining: 5 } },
        warnings: [], kept_suggestions: [], preferences: {},
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
        generate: vi.fn(async (_id: string, body: { session_seq: number }, hooks: { onPartial?: (d: unknown) => void }) => {
            hooks.onPartial?.({ sections: [{ key: 'today', body: '部分' }] })
            return { generation_id: `g${body.session_seq}`, draft: { sections: [{ key: 'today', title: '今日', body: `v${body.session_seq}` }], teachingSuggestions: ['建議'] }, unresolved_placeholders: [], quota_charged: 2, quota_remaining: 3 }
        }),
    } satisfies Record<keyof typeof ReportAssistService, unknown>
}

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
})
