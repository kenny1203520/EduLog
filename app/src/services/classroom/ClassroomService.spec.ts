import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
}))

vi.mock('../api/ApiResourceClient', () => ({ apiResourceClient: mocks }))

import { ClassroomService } from './ClassroomService'

describe('ClassroomService mutation URLs', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.create.mockResolvedValue({ data: { id: 'room-1', name: 'Room', external_link: null } })
        mocks.update.mockResolvedValue({ data: { id: 'room-1', name: 'Room', external_link: null } })
    })

    it('sends null when an external link is cleared during update', async () => {
        await ClassroomService.updateClassroom('room-1', { name: 'Room', external_link: '   ' })

        expect(mocks.update).toHaveBeenCalledWith('classrooms', 'room-1', { name: 'Room', external_link: null })
    })

    it('preserves a valid external link during create', async () => {
        await ClassroomService.createClassroom({ name: 'Room', external_link: ' https://example.com/room ' })

        expect(mocks.create).toHaveBeenCalledWith('classrooms', { name: 'Room', external_link: 'https://example.com/room' })
    })
})
