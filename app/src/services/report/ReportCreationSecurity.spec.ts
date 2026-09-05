import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError } from '@/services/errors/AppError'
import { ReportCommandService } from './ReportCommandService'
import { ReportLifecyclePolicy } from './ReportLifecyclePolicy'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('./ReportLifecyclePolicy', () => ({
    ReportLifecyclePolicy: { buildInitialReportPayload: vi.fn() }
}))

function insertResult(result: { data?: unknown; error?: unknown }) {
    const chain: Record<string, any> = {}
    chain.insert = vi.fn(() => chain)
    chain.select = vi.fn(() => chain)
    chain.single = vi.fn().mockResolvedValue(result)
    return chain
}

describe('ReportCommandService.createReport authorization boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(ReportLifecyclePolicy.buildInitialReportPayload).mockResolvedValue({
            enrollment_id: 'enrollment-1',
            class_occurrence_id: 'occurrence-1',
            content: '',
            version: 1
        } as any)
    })

    it('maps 42501 to a public AuthorizationError without exposing SQL details', async () => {
        fromMock.mockReturnValue(insertResult({
            data: null,
            error: { code: '42501', message: 'new row violates row-level security policy for table occurrence_reports' }
        }))

        await expect(ReportCommandService.createReport('enrollment-1', 'occurrence-1'))
            .rejects.toMatchObject({ name: 'AuthorizationError', i18nKey: 'errors.permission_denied' })
    })

    it('keeps non-authorization failures generic for callers', async () => {
        fromMock.mockReturnValue(insertResult({
            data: null,
            error: { code: '23503', message: 'foreign key violation: internal details' }
        }))

        await expect(ReportCommandService.createReport('enrollment-1', 'occurrence-1'))
            .rejects.toThrow('Failed to create occurrence report')
        await expect(ReportCommandService.createReport('enrollment-1', 'occurrence-1'))
            .rejects.not.toThrow('internal details')
        expect(AuthorizationError).toBeDefined()
    })
})
