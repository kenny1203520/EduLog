import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OccurrenceRosterService } from './OccurrenceRosterService'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: rpcMock } }))

describe('OccurrenceRosterService', () => {
    beforeEach(() => vi.clearAllMocks())

    it('returns the canonical enrollment ids resolved by the database', async () => {
        rpcMock.mockResolvedValue({
            data: [{ enrollment_id: 'enrollment-1' }, { enrollment_id: 'enrollment-guest' }],
            error: null
        })

        await expect(OccurrenceRosterService.getEffectiveEnrollmentIds('occurrence-1'))
            .resolves.toEqual(['enrollment-1', 'enrollment-guest'])
        expect(rpcMock).toHaveBeenCalledWith('get_effective_occurrence_enrollment_ids', {
            p_occurrence_id: 'occurrence-1'
        })
    })

    it('fails closed when the effective roster cannot be resolved', async () => {
        rpcMock.mockResolvedValue({ data: null, error: { message: 'permission denied' } })

        await expect(OccurrenceRosterService.getEffectiveEnrollmentIds('occurrence-1'))
            .rejects.toThrow('Failed to resolve occurrence roster: permission denied')
    })
})
