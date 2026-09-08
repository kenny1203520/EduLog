import { describe, expect, it } from 'vitest'
import { resources } from './resources.js'

describe('student API resource boundaries', () => {
  it('registers explicit student child resources with the student permission scope', () => {
    expect(resources['student-contacts'].table).toBe('student_contacts')
    expect(resources['student-schools'].table).toBe('student_schools')
    expect(resources['student-credentials'].table).toBe('student_credentials')
    expect(resources['student-contacts'].permission).toBe('teaching.students.list')
    expect(resources['student-schools'].permission).toBe('teaching.students.list')
    expect(resources['student-credentials'].permission).toBe('teaching.students.list')
  })

  it('never includes credential passwords in generic readable fields', () => {
    const credentialFields = resources['student-credentials'].fields
    const studentFields = resources.students.fields
    expect(credentialFields).not.toContain('password')
    expect(studentFields.join(',')).not.toContain('student_credentials(id,student_id,platform,username,password')
    expect(resources['student-credentials'].writable).toContain('password')
  })

  it('keeps all child resources explicitly allowlisted', () => {
    for (const key of ['student-contacts', 'student-schools', 'student-credentials']) {
      const resource = resources[key]
      expect(resource.fields.length).toBeGreaterThan(0)
      expect(resource.writable.every((field) => !['id', 'user_id', 'created_at', 'updated_at'].includes(field))).toBe(true)
      expect(resource.sortable.length).toBeGreaterThan(0)
    }
  })
})
