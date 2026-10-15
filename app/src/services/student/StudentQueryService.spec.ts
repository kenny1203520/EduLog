import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentQueryService } from './StudentQueryService'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), privateDetails: vi.fn(), credentials: vi.fn() }))
vi.mock('@/services/api/ApiModeClient', () => ({ getApiV1Mode: () => 'v1' }))
vi.mock('@/services/api/ApiDataClient', () => ({ apiDataClient: {} }))
vi.mock('@/services/api/PageApiService', () => ({ PageApiService: { getStudentProfile: mocks.profile, getStudentPrivateDetails: mocks.privateDetails } }))
vi.mock('./StudentCredentialsQueryService', () => ({ StudentCredentialsQueryService: { getForStudent: mocks.credentials } }))

const studentId = 'ffe5b8ab-4657-4977-b6c9-3320da82046f'
const contact = { id: 'contact', name: 'Parent', email: 'parent@example.test' }
const school = { id: 'school', name: 'School', grade: '3', status: 'enrolled' }
const credential = { id: 'credential', platform: 'fixture', username: 'student', password: 'private' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.privateDetails.mockResolvedValue({ data: { student: { id: studentId, email: 'student@example.test', phone: '0912345678' }, contacts: [contact], schools: [school] } })
  mocks.credentials.mockResolvedValue([credential])
})

describe('unenrolled student sensitive capabilities', () => {
  it.each([true, false])('loads private data without enrollments when read-sensitive is allowed (update-sensitive: %s)', async updateSensitive => {
    mocks.profile.mockResolvedValue({ data: { id: studentId, name: 'Student', created_at: '2026-10-07', enrollments: [], capabilities: { read_sensitive: true, update_sensitive: updateSensitive } } })
    const student = await StudentQueryService.getById(studentId)
    expect(student).toMatchObject({ email: 'student@example.test', phone: '0912345678', enrollments: [], contacts: [contact], schools: [school], credentials: [credential] })
    expect(student?.capabilities).toEqual({ read_sensitive: true, update_sensitive: updateSensitive })
    expect(mocks.privateDetails).toHaveBeenCalledWith(studentId)
    expect(mocks.credentials).toHaveBeenCalledWith(studentId)
  })

  it.each([true, false])('keeps private data hidden without read-sensitive permission (update-sensitive: %s)', async updateSensitive => {
    mocks.profile.mockResolvedValue({ data: { id: studentId, name: 'Student', created_at: '2026-10-07', enrollments: [], capabilities: { read_sensitive: false, update_sensitive: updateSensitive } } })
    const student = await StudentQueryService.getById(studentId)
    expect(student).toMatchObject({ email: '', phone: '', contacts: [], schools: [], credentials: [], enrollments: [] })
    expect(student?.capabilities).toEqual({ read_sensitive: false, update_sensitive: updateSensitive })
    expect(mocks.privateDetails).not.toHaveBeenCalled()
    expect(mocks.credentials).not.toHaveBeenCalled()
  })
})
