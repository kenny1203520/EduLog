import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentCommandService } from './StudentCommandService'

const mocks = vi.hoisted(() => ({
    mode: 'v1', create: vi.fn(), update: vi.fn(), insert: vi.fn(), legacyUpdate: vi.fn(),
    school: { id: 'e7982b6e-d0c9-4f89-814f-de95709e0d50' }
}))
vi.mock('@/services/api/ApiModeClient', () => ({ getApiV1Mode: () => mocks.mode }))
vi.mock('@/services/api/ApiResourceClient', () => ({ apiResourceClient: { create: mocks.create, update: mocks.update } }))
vi.mock('@/services/enrollment/EnrollmentService', () => ({ EnrollmentService: {} }))
vi.mock('@/utils/DateUtils', () => ({ DateUtils: {
    isValidTimeZone: (value: string) => value === 'Asia/Taipei', getDefaultTimeZone: () => 'Asia/Taipei'
} }))
vi.mock('@/services/api/ApiDataClient', () => ({ apiDataClient: {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from: () => ({ insert: mocks.insert, update: mocks.legacyUpdate })
} }))

const studentId = 'ffe5b8ab-4657-4977-b6c9-3320da82046f'
const existing = {
    id: mocks.school.id, name: '國中', class: '', grade: '九年級', status: 'enrolled',
    end_date: '2026-06-30', time_zone: 'Asia/Taipei', created_at: '2026-02-02T23:06:49.426281+00:00',
    start_date: '2025-09-01', student_id: studentId, updated_at: '2026-09-24T09:21:54.136017+00:00', school_student_id: ''
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({ data: mocks.school })
    mocks.update.mockResolvedValue({ data: mocks.school })
    const query: any = { select: () => query, eq: () => query, single: async () => ({ data: mocks.school, error: null }) }
    mocks.insert.mockReturnValue(query)
    mocks.legacyUpdate.mockReturnValue(query)
})

describe.each(['v1', 'legacy'])('school writes in %s mode', mode => {
    beforeEach(() => { mocks.mode = mode })
    const updatePayload = () => mode === 'v1' ? mocks.update.mock.calls[0]![2] : mocks.legacyUpdate.mock.calls[0]![0]
    const createPayload = () => mode === 'v1' ? mocks.create.mock.calls[0]![1] : mocks.insert.mock.calls[0]![0]

    it('strips response metadata from a full school record and preserves its dates', async () => {
        await StudentCommandService.updateSchool(existing.id, existing)
        const { id, created_at, updated_at, ...writable } = existing
        expect(updatePayload()).toEqual(writable)
    })

    it('creates an enrolled school without an end date', async () => {
        await StudentCommandService.addSchool({
            name: '高中', status: 'enrolled', grade: '高一', class: '', start_date: '2026-09-01',
            end_date: '', time_zone: 'Asia/Taipei', school_student_id: '', student_id: studentId
        })
        expect(createPayload()).toMatchObject({ name: '高中', student_id: studentId, end_date: null, start_date: '2026-09-01' })
    })

    it('clears explicitly empty dates but omits dates and timezone on unrelated patches', async () => {
        await StudentCommandService.updateSchool(existing.id, { name: '新校名' })
        expect(updatePayload()).toEqual({ name: '新校名' })
        vi.clearAllMocks()
        await StudentCommandService.updateSchool(existing.id, { start_date: '', end_date: '' })
        expect(updatePayload()).toEqual({ start_date: null, end_date: null })
    })

    it('preserves explicit nulls and invalid dates for strict server validation', async () => {
        await StudentCommandService.updateSchool(existing.id, { end_date: null, start_date: 'invalid' })
        expect(updatePayload()).toEqual({ end_date: null, start_date: 'invalid' })
    })
})
