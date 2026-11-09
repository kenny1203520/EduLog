import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OccurrenceRosterService } from './OccurrenceRosterService'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))

vi.mock('@/services/api/ApiV1Client', () => ({ apiV1Client: { get: getMock } }))

describe('OccurrenceRosterService', () => {
    beforeEach(() => vi.clearAllMocks())

    it('returns the canonical enrollment ids resolved by the server', async () => {
        getMock.mockResolvedValue({ data: ['enrollment-1', 'enrollment-guest'] })

        await expect(OccurrenceRosterService.getEffectiveEnrollmentIds('occurrence-1'))
            .resolves.toEqual(['enrollment-1', 'enrollment-guest'])
        expect(getMock).toHaveBeenCalledWith('/occurrences/occurrence-1/roster')
    })

    it('fails closed when the effective roster cannot be resolved', async () => {
        getMock.mockRejectedValue(new Error('permission denied'))

        await expect(OccurrenceRosterService.getEffectiveEnrollmentIds('occurrence-1'))
            .rejects.toThrow('Failed to resolve occurrence roster: permission denied')
    })
})
