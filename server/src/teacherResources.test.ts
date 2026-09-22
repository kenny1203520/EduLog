import { describe, expect, it } from 'vitest'
import { resources } from './resources.js'

describe('teacher API resource boundaries', () => {
  it('exposes teacher profile metadata and an explicit credential resource', () => {
    expect(resources.teachers.fields).not.toContain('email')
    expect(resources.teachers.fields.join(',')).not.toContain('teacher_credentials(')
    expect(resources['teacher-credentials'].permission).toBe('teaching.teachers.read_sensitive')
    expect(resources['teacher-credentials'].fields).not.toContain('password')
    expect(resources['teacher-credentials'].writable).toContain('password')
  })
})
