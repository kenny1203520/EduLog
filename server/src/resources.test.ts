import { describe, expect, it } from 'vitest'
import { resources, resourceSchemas } from './resources.js'

describe('student API resource boundaries', () => {
  it('returns report-only links and nullable scores in report list projections', () => {
    expect(resources.reports.listFields).toEqual(expect.arrayContaining([
      'external_link', 'class_participation', 'classroom_behavior',
    ]))
  })

  it('registers explicit student child resources with the student permission scope', () => {
    expect(resources['student-contacts'].table).toBe('student_contacts')
    expect(resources['student-schools'].table).toBe('student_schools')
    expect(resources['student-credentials'].table).toBe('student_credentials')
    expect(resources['student-contacts'].permission).toBe('teaching.students.read_sensitive')
    expect(resources['student-schools'].permission).toBe('teaching.students.read_sensitive')
    expect(resources['student-credentials'].permission).toBe('teaching.students.read_sensitive')
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
      list: 'system.roles.read', read: 'system.roles.read', create: 'system.roles.manage',
      update: 'system.roles.manage', delete: 'system.roles.manage', manage: 'system.roles.manage',
    })
    expect(resources.permissions.genericMethods).toEqual(['GET'])
    expect(resources['audit-events'].genericMethods).toEqual(['GET'])
    expect(resources.users.permissions).toMatchObject({ list: 'system.users.list', read: 'system.users.read' })
    expect(resources.permissions.permissions).toMatchObject({ list: 'system.permissions.read', read: 'system.permissions.read' })
    expect(resources['audit-events'].permissions).toMatchObject({ list: 'system.audit.list', read: 'system.audit.list' })
  })

  it('allows audit filters, text search, and newest-first timestamp sorting', () => {
    expect(resources['audit-events'].fields).toEqual(expect.arrayContaining([
      'actor_user_id', 'action', 'domain', 'resource', 'resource_id', 'scope_id', 'request_id', 'outcome', 'metadata', 'created_at',
    ]))
    expect(resources['audit-events'].filterable).toEqual(expect.arrayContaining([
      'actor_user_id', 'action', 'domain', 'resource', 'resource_id', 'scope_id', 'outcome', 'created_at',
    ]))
    expect(resources['audit-events'].searchable).toEqual(expect.arrayContaining(['action', 'resource', 'outcome']))
    expect(resources['audit-events'].sortable).toContain('created_at')
  })

  it('allows the system user list sort requested by the settings UI', () => {
    expect(resources.users.sortable).toEqual(expect.arrayContaining(['display_name', 'email']))
    expect(resources.users.sortable).not.toContain('password')
  })

  it('normalizes blank classroom external links while rejecting invalid URLs', () => {
    const createSchema = resourceSchemas.classrooms.createSchema!
    const updateSchema = resourceSchemas.classrooms.updateSchema!
    for (const schema of [createSchema, updateSchema]) {
      for (const value of ['', '   ']) {
        const parsed = schema.safeParse({ ...(schema === createSchema ? { name: 'Room' } : {}), external_link: value })
        expect(parsed.success).toBe(true)
        if (parsed.success) expect(parsed.data.external_link).toBeNull()
      }
      expect(schema.safeParse({ ...(schema === createSchema ? { name: 'Room' } : {}), external_link: 'https://example.com/room' }).success).toBe(true)
      expect(schema.safeParse({ ...(schema === createSchema ? { name: 'Room' } : {}), external_link: 'not-a-url' }).success).toBe(false)
    }
  })

  it('allows report queries to sort by creation time in either direction', () => {
    expect(resources.reports.sortable).toEqual(expect.arrayContaining(['created_at', 'updated_at']))
  })

  it('keeps the frontend collection projections complete without exposing student profile details', () => {
    expect(resources['class-sessions'].fields).toEqual(expect.arrayContaining(['time_zone', 'session_type', 'schedule_mode']))
    expect(resources.occurrences.fields).toEqual(expect.arrayContaining(['original_start_time', 'original_end_time', 'actual_start_time', 'actual_end_time', 'time_zone']))
    expect(resources.holidays.fields).toEqual(expect.arrayContaining(['kind', 'teacher_ids', 'time_zone']))
    expect(resources.students.listFields).not.toContain('email')
    expect(resources.students.itemFields).not.toEqual(expect.arrayContaining(['email', 'phone', 'residence_address', 'mailing_address', 'birthday']))
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
    expect(resources.students.itemFields).not.toEqual(expect.arrayContaining(['gov_id', 'email', 'phone', 'residence_address', 'mailing_address', 'birthday']))
    expect(resources.students.itemFields?.join(',')).not.toContain('student_contacts(')
    expect(resources.students.itemFields?.join(',')).not.toContain('student_schools(')
    expect(resources.students.itemFields?.join(',')).not.toContain('student_credentials(')
    expect(resources.teachers.listFields).not.toContain('gov_id')
    expect(resources.teachers.itemFields).not.toContain('gov_id')
    expect(resources.teachers.itemFields?.join(',')).not.toContain('password')
  })
})
