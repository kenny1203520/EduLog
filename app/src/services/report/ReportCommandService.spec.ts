import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportCommandService } from './ReportCommandService'
import { ReportLifecyclePolicy } from './ReportLifecyclePolicy'
import { ReportQueryService } from './ReportQueryService'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./ReportLifecyclePolicy', () => ({
    ReportLifecyclePolicy: { buildInitialReportPayload: vi.fn() }
}))
vi.mock('./ReportQueryService', () => ({
    ReportQueryService: { getReportsByOccurrence: vi.fn() }
}))

function terminalQuery(result: { data?: any; error?: any }, terminal: 'single' | 'then' = 'then') {
    const chain: Record<string, any> = {}
    for (const method of ['select', 'eq', 'in', 'lte']) chain[method] = vi.fn(() => chain)
    if (terminal === 'single') chain.single = vi.fn().mockResolvedValue(result)
    chain.then = (resolve: (value: any) => unknown, reject: (reason?: any) => unknown) =>
        Promise.resolve(result).then(resolve, reject)
    return chain
}

describe('ReportCommandService.createReportsForOccurrence', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(ReportQueryService.getReportsByOccurrence).mockResolvedValue([])
        vi.mocked(ReportLifecyclePolicy.buildInitialReportPayload).mockImplementation(async enrollmentId => ({
            enrollment_id: enrollmentId,
            class_occurrence_id: 'occurrence-1',
            content: '',
            version: 1
        }) as any)
    })

    it('ensures only eligible regular and trial enrollment reports in one idempotent upsert', async () => {
        const occurrence = terminalQuery({ data: { class_session_id: 'session-1', occurrence_date: '2026-07-29' }, error: null }, 'single')
        const enrollments = terminalQuery({ data: [{ id: 'enrollment-1' }, { id: 'enrollment-2' }], error: null })
        const existing = terminalQuery({ data: [{ enrollment_id: 'enrollment-1' }], error: null })
        const upsert = vi.fn().mockResolvedValue({ error: null })
        fromMock
            .mockReturnValueOnce(occurrence)
            .mockReturnValueOnce(enrollments)
            .mockReturnValueOnce(existing)
            .mockReturnValueOnce({ upsert })

        await ReportCommandService.createReportsForOccurrence('occurrence-1')

        expect(enrollments.in).toHaveBeenCalledWith('status', ['regular', 'trial'])
        expect(enrollments.lte).toHaveBeenCalledWith('start_date', '2026-07-29')
        expect(ReportLifecyclePolicy.buildInitialReportPayload).toHaveBeenCalledTimes(1)
        expect(ReportLifecyclePolicy.buildInitialReportPayload).toHaveBeenCalledWith('enrollment-2', 'occurrence-1')
        expect(upsert).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ enrollment_id: 'enrollment-2' })
        ]), {
            onConflict: 'enrollment_id,class_occurrence_id',
            ignoreDuplicates: true
        })
        expect(ReportQueryService.getReportsByOccurrence).toHaveBeenCalledWith('occurrence-1')
    })

    it('does not write when every eligible enrollment already has a report', async () => {
        fromMock
            .mockReturnValueOnce(terminalQuery({ data: { class_session_id: 'session-1', occurrence_date: '2026-07-29' }, error: null }, 'single'))
            .mockReturnValueOnce(terminalQuery({ data: [{ id: 'enrollment-1' }], error: null }))
            .mockReturnValueOnce(terminalQuery({ data: [{ enrollment_id: 'enrollment-1' }], error: null }))

        await ReportCommandService.createReportsForOccurrence('occurrence-1')

        expect(ReportLifecyclePolicy.buildInitialReportPayload).not.toHaveBeenCalled()
        expect(fromMock).toHaveBeenCalledTimes(3)
    })
})
