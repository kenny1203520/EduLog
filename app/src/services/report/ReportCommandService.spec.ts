import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportCommandService } from './ReportCommandService'
import { ReportLifecyclePolicy } from './ReportLifecyclePolicy'
import { ReportQueryService } from './ReportQueryService'
import { OccurrenceRosterService } from '../occurrence/OccurrenceRosterService'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/services/api/ApiDataClient', () => ({ apiDataClient: { from: fromMock } }))
vi.mock('./ReportLifecyclePolicy', () => ({
    ReportLifecyclePolicy: { buildInitialReportPayload: vi.fn() }
}))
vi.mock('./ReportQueryService', () => ({
    ReportQueryService: { getReportsByOccurrence: vi.fn() }
}))
vi.mock('../occurrence/OccurrenceRosterService', () => ({
    OccurrenceRosterService: { getEffectiveEnrollmentIds: vi.fn() }
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
        vi.mocked(OccurrenceRosterService.getEffectiveEnrollmentIds).mockResolvedValue(['enrollment-1', 'enrollment-2'])
        vi.mocked(ReportLifecyclePolicy.buildInitialReportPayload).mockImplementation(async enrollmentId => ({
            enrollment_id: enrollmentId,
            class_occurrence_id: 'occurrence-1',
            content: '',
            version: 1
        }) as any)
    })

    it('ensures only effective-roster reports in one idempotent upsert', async () => {
        const provisionable = terminalQuery({ data: [{ id: 'enrollment-1' }, { id: 'enrollment-2' }], error: null })
        const existing = terminalQuery({ data: [{ enrollment_id: 'enrollment-1' }], error: null })
        const upsert = vi.fn().mockResolvedValue({ error: null })
        fromMock
            .mockReturnValueOnce(provisionable)
            .mockReturnValueOnce(existing)
            .mockReturnValueOnce({ upsert })

        await ReportCommandService.createReportsForOccurrence('occurrence-1')

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
        vi.mocked(OccurrenceRosterService.getEffectiveEnrollmentIds).mockResolvedValue(['enrollment-1'])
        fromMock
            .mockReturnValueOnce(terminalQuery({ data: [{ id: 'enrollment-1' }], error: null }))
            .mockReturnValueOnce(terminalQuery({ data: [{ enrollment_id: 'enrollment-1' }], error: null }))

        await ReportCommandService.createReportsForOccurrence('occurrence-1')

        expect(ReportLifecyclePolicy.buildInitialReportPayload).not.toHaveBeenCalled()
        expect(fromMock).toHaveBeenCalledTimes(2)
    })

    it('continues with existing reports when placeholder provisioning is rejected by RLS', async () => {
        const provisionable = terminalQuery({ data: [{ id: 'enrollment-1' }, { id: 'enrollment-2' }], error: null })
        const existing = terminalQuery({ data: [{ enrollment_id: 'enrollment-1' }], error: null })
        const upsert = vi.fn().mockResolvedValue({ error: { code: '42501', message: 'new row violates row-level security policy' } })
        fromMock
            .mockReturnValueOnce(provisionable)
            .mockReturnValueOnce(existing)
            .mockReturnValueOnce({ upsert })

        await expect(ReportCommandService.createReportsForOccurrence('occurrence-1')).resolves.toEqual([])
        expect(ReportQueryService.getReportsByOccurrence).toHaveBeenCalledWith('occurrence-1')
    })

    it('still surfaces non-authorization provisioning failures', async () => {
        const provisionable = terminalQuery({ data: [{ id: 'enrollment-1' }, { id: 'enrollment-2' }], error: null })
        const existing = terminalQuery({ data: [{ enrollment_id: 'enrollment-1' }], error: null })
        const upsert = vi.fn().mockResolvedValue({ error: { code: '23503', message: 'foreign key violation' } })
        fromMock
            .mockReturnValueOnce(provisionable)
            .mockReturnValueOnce(existing)
            .mockReturnValueOnce({ upsert })

        await expect(ReportCommandService.createReportsForOccurrence('occurrence-1')).rejects.toThrow('Failed to ensure occurrence reports')
    })

    it('never provisions a completed enrollment from a legacy roster', async () => {
        vi.mocked(OccurrenceRosterService.getEffectiveEnrollmentIds).mockResolvedValue(['completed-1', 'regular-1'])
        fromMock
            .mockReturnValueOnce(terminalQuery({ data: [{ id: 'regular-1' }], error: null }))
            .mockReturnValueOnce(terminalQuery({ data: [], error: null }))
            .mockReturnValueOnce({ upsert: vi.fn().mockResolvedValue({ error: null }) })

        await ReportCommandService.createReportsForOccurrence('occurrence-1')

        expect(ReportLifecyclePolicy.buildInitialReportPayload).toHaveBeenCalledTimes(1)
        expect(ReportLifecyclePolicy.buildInitialReportPayload).toHaveBeenCalledWith('regular-1', 'occurrence-1')
    })

    it('does not write when the roster contains only completed enrollments', async () => {
        vi.mocked(OccurrenceRosterService.getEffectiveEnrollmentIds).mockResolvedValue(['completed-1'])
        fromMock.mockReturnValueOnce(terminalQuery({ data: [], error: null }))

        await ReportCommandService.createReportsForOccurrence('occurrence-1')

        expect(ReportLifecyclePolicy.buildInitialReportPayload).not.toHaveBeenCalled()
        expect(ReportQueryService.getReportsByOccurrence).toHaveBeenCalledWith('occurrence-1')
    })
})
