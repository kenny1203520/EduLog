import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyStudentCapabilities, type StudentCapabilitiesDTO, type StudentSensitiveSection } from '@/models/Student'
import { StudentQueryService } from './StudentQueryService'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), privateDetails: vi.fn(), credentials: vi.fn(), list: vi.fn() }))
vi.mock('@/services/api/PageApiService', () => ({ PageApiService: { getStudentProfile: mocks.profile, getStudentPrivateDetails: mocks.privateDetails } }))
vi.mock('@/services/api/ApiResourceClient', () => ({ apiResourceClient: { list: mocks.list } }))
vi.mock('./StudentCredentialsQueryService', () => ({ StudentCredentialsQueryService: { getForStudent: mocks.credentials } }))

const studentId = 'ffe5b8ab-4657-4977-b6c9-3320da82046f'
const contact = { id: 'contact', name: 'Parent', email: 'parent@example.test' }
const school = { id: 'school', name: 'School', grade: '3', status: 'enrolled' }
const credential = { id: 'credential', platform: 'fixture', username: 'student', password: 'private' }

function capabilities(readable: StudentSensitiveSection[], update = false): StudentCapabilitiesDTO {
  const result = emptyStudentCapabilities()
  for (const section of readable) result[section] = { read: true, update }
  return result
}

function profile(sections: StudentCapabilitiesDTO, currentSchool: unknown = null) {
  mocks.profile.mockResolvedValue({ data: { id: studentId, name: 'Student', created_at: '2026-10-07', enrollments: [], current_school: currentSchool, capabilities: sections } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.privateDetails.mockResolvedValue({ data: { student: { id: studentId, email: 'student@example.test', phone: '0912345678' } } })
  mocks.credentials.mockResolvedValue([credential])
  mocks.list.mockImplementation(async (resource: string) => ({ data: resource === 'student-contacts' ? [contact] : [school] }))
})

describe('student sensitive sections', () => {
  it.each([true, false])('loads every readable section without enrollments (update: %s)', async update => {
    const sections = capabilities(['schools', 'personal', 'contacts', 'credentials'], update)
    profile(sections)
    const student = await StudentQueryService.getById(studentId)
    expect(student).toMatchObject({ email: 'student@example.test', phone: '0912345678', enrollments: [], contacts: [contact], schools: [school], credentials: [credential] })
    expect(student?.capabilities).toEqual(sections)
    expect(mocks.privateDetails).toHaveBeenCalledWith(studentId)
    expect(mocks.list).toHaveBeenCalledWith('student-contacts', expect.objectContaining({ studentId }))
    expect(mocks.list).toHaveBeenCalledWith('student-schools', expect.objectContaining({ studentId }))
    expect(mocks.credentials).toHaveBeenCalledWith(studentId)
  })

  it('keeps every section hidden without read permissions', async () => {
    profile(emptyStudentCapabilities(), { grade: '3' })
    const student = await StudentQueryService.getById(studentId)
    expect(student).toMatchObject({ email: '', phone: '', contacts: [], schools: [], credentials: [], enrollments: [] })
    expect(student?.displayGrade).toBe('3')
    expect(student?.displaySchoolName).toBe('')
    expect(student?.hasRestrictedSchool).toBe(true)
    expect(mocks.privateDetails).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.credentials).not.toHaveBeenCalled()
  })

  it.each<[StudentSensitiveSection, string]>([
    ['schools', 'student-schools'],
    ['contacts', 'student-contacts'],
  ])('fetches only the %s section when only it is readable', async (section, resource) => {
    profile(capabilities([section]))
    const student = await StudentQueryService.getById(studentId)
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.list).toHaveBeenCalledWith(resource, expect.objectContaining({ studentId }))
    expect(mocks.privateDetails).not.toHaveBeenCalled()
    expect(mocks.credentials).not.toHaveBeenCalled()
    expect(student?.email).toBe('')
  })

  it('fetches personal details alone for a personal-only reader', async () => {
    profile(capabilities(['personal']))
    const student = await StudentQueryService.getById(studentId)
    expect(student).toMatchObject({ email: 'student@example.test', contacts: [], schools: [], credentials: [] })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.credentials).not.toHaveBeenCalled()
  })
})
