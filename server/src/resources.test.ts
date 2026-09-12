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

  it('registers the schedule and teacher-assignment resources used by the client facade', () => {
    expect(resources['class-session-schedule-rules'].table).toBe('class_session_schedule_rules')
    expect(resources['class-session-teachers'].table).toBe('class_session_teachers')
    expect(resources['class-session-schedule-rules'].scope).toBe('session-child')
    expect(resources['class-session-teachers'].scope).toBe('session-child')
  })

  it('does not expose generic mutations for business-sensitive resources', () => {
    for (const key of ['class-sessions', 'enrollments', 'occurrences', 'reports', 'student-suspensions', 'holidays']) {
      expect(resources[key].genericMethods).toEqual(['GET'])
    }
  })

  it('models holidays by referenced classroom/session scopes', () => {
    expect(resources.holidays.scope).toBe('holiday')
    expect(resources.holidays.fields).toEqual(expect.arrayContaining(['classroom_ids', 'class_session_ids']))
  })

  it('declares explicit system permissions instead of deriving them from list', () => {
    expect(resources.roles.permissions).toMatchObject({
      list: 'system.roles.manage', read: 'system.roles.manage', create: 'system.roles.manage',
      update: 'system.roles.manage', delete: 'system.roles.manage', manage: 'system.roles.manage',
    })
    expect(resources.permissions.genericMethods).toEqual(['GET'])
    expect(resources['audit-events'].genericMethods).toEqual(['GET'])
    expect(resources.users.permissions).toMatchObject({ list: 'system.users.list', read: 'system.users.list' })
    expect(resources.permissions.permissions).toMatchObject({ list: 'system.permissions.read', read: 'system.permissions.read' })
    expect(resources['audit-events'].permissions).toMatchObject({ list: 'system.audit.list', read: 'system.audit.list' })
  })

  it('keeps the frontend collection projections complete without exposing student profile details', () => {
    expect(resources['class-sessions'].fields).toEqual(expect.arrayContaining(['time_zone', 'session_type', 'schedule_mode']))
    expect(resources.occurrences.fields).toEqual(expect.arrayContaining(['original_start_time', 'original_end_time', 'actual_start_time', 'actual_end_time', 'time_zone']))
    expect(resources.holidays.fields).toEqual(expect.arrayContaining(['kind', 'teacher_ids', 'time_zone']))
    expect(resources.students.listFields).not.toContain('email')
    expect(resources.students.itemFields).toEqual(expect.arrayContaining(['email', 'phone', 'residence_address', 'mailing_address', 'birthday']))
  })

  it('accepts the client role compatibility flag only as a non-persisted false value', () => {
    expect(resources.roles.compatibilityFields).toContain('is_system')
    expect(resources.roles.writable).not.toContain('is_system')
    expect(resources.roles.createSchema?.safeParse({ name: 'Custom role' }).success).toBe(true)
  })

  it('requires typed schemas for every generic write route', () => {
    for (const resource of Object.values(resources)) {
      const methods = new Set(resource.genericMethods ?? ['GET', 'POST', 'PATCH', 'DELETE'])
      if (methods.has('POST')) expect(resource.createSchema, resource.route).toBeDefined()
      if (methods.has('PATCH')) expect(resource.updateSchema, resource.route).toBeDefined()
    }
  })

  it('keeps sensitive profile fields in authorized detail projections only', () => {
    expect(resources.students.listFields).not.toEqual(expect.arrayContaining(['gov_id', 'email', 'student_credentials(id,student_id,platform,username,url,created_at,updated_at)']))
    expect(resources.students.itemFields).toEqual(expect.arrayContaining(['gov_id', 'student_contacts(id,student_id,name,relation,phone,email,created_at,updated_at)', 'student_schools(id,student_id,name,status,grade,school_student_id,start_date,end_date,time_zone,class,created_at,updated_at)', 'student_credentials(id,student_id,platform,username,url,created_at,updated_at)']))
    expect(resources.teachers.listFields).not.toContain('gov_id')
    expect(resources.teachers.itemFields).toContain('gov_id')
    expect(resources.teachers.itemFields?.join(',')).not.toContain('password')
  })
})
