import { describe, expect, it } from 'vitest'
import { Student } from './Student'

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
      capabilities: { read_sensitive: false, update_sensitive: false },
    })

    expect(student.displaySchoolName).toBe('Example School')
    expect(student.displayGrade).toBe('Grade 6 - Class A')
    expect(student.displaySchoolId).toBe('')
    expect(student.capabilities).toEqual({ read_sensitive: false, update_sensitive: false })
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
      capabilities: { read_sensitive: true, update_sensitive: false },
    })

    expect(student.displaySchoolName).toBe('Full School')
    expect(student.displayGrade).toBe('Grade 6 - Class B')
    expect(student.displaySchoolId).toBe('PRIVATE-001')
    expect(student.capabilities.update_sensitive).toBe(false)
  })
})
