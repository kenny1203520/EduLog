import { describe, expect, it } from 'vitest'
import { resources } from './resources.js'

describe('teacher API resource boundaries', () => {
  it('exposes teacher profile metadata and an explicit credential resource', () => {
    expect(resources.teachers.fields).toContain('email')
    expect(resources.teachers.fields).toContain('teacher_credentials(id,teacher_id,platform,username,url,created_at,updated_at)')
    expect(resources['teacher-credentials'].permission).toBe('teaching.teachers.list')
    expect(resources['teacher-credentials'].fields).not.toContain('password')
    expect(resources['teacher-credentials'].writable).toContain('password')
  })
})
