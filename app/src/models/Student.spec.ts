import { describe, expect, it } from 'vitest'
import { emptyStudentCapabilities, Student } from './Student'

describe('Student school summary and sensitive capabilities', () => {
  const base = {
    id: '10000000-0000-0000-0000-000000000001',
    name: 'Test Student',
    created_at: '2026-09-21T00:00:00.000Z',
  }

  it('uses the safe current-school summary for list and profile display', () => {
    const student = new Student({
      ...base,
      current_school: {
        name: 'Example School',
        status: 'enrolled',
        grade: 'Grade 6',
        class: 'Class A',
      },
      capabilities: { ...emptyStudentCapabilities(), schools: { read: true, update: false } },
    })

    expect(student.displaySchoolName).toBe('Example School')
    expect(student.displayGrade).toBe('Grade 6 - Class A')
    expect(student.displaySchoolId).toBe('')
    expect(student.hasRestrictedSchool).toBe(false)
    expect(student.capabilities.schools).toEqual({ read: true, update: false })
    expect(student.capabilities.personal).toEqual({ read: false, update: false })
  })

  it('shows only the grade when school read access is missing', () => {
    const student = new Student({ ...base, current_school: { grade: 'Grade 4' } })

    expect(student.displaySchoolName).toBe('')
    expect(student.displayGrade).toBe('Grade 4')
    expect(student.hasRestrictedSchool).toBe(true)
    expect(student.capabilities).toEqual(emptyStudentCapabilities())
  })

  it('prefers the authorized full school record without deriving a school id from the summary', () => {
    const student = new Student({
      ...base,
      current_school: { name: 'Summary School', status: 'enrolled', grade: 'Grade 5', class: null },
      student_schools: [{
        id: '20000000-0000-0000-0000-000000000001',
        name: 'Full School',
        status: 'enrolled',
        grade: 'Grade 6',
        class: 'Class B',
        school_student_id: 'PRIVATE-001',
      }],
      capabilities: { ...emptyStudentCapabilities(), schools: { read: true, update: false } },
    })

    expect(student.displaySchoolName).toBe('Full School')
    expect(student.displayGrade).toBe('Grade 6 - Class B')
    expect(student.displaySchoolId).toBe('PRIVATE-001')
    expect(student.capabilities.schools.update).toBe(false)
  })
})
