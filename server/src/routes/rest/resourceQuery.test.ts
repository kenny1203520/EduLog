import { describe, expect, it } from 'vitest'
import { parseFilters, parseOr } from './resourceRouter.js'
import { listQuerySchema, resources } from './resources.js'

describe('resource query filters', () => {
  it('accepts server-side ilike, contains and null filters', () => {
    expect(parseFilters(JSON.stringify([
      { field: 'status', operator: 'ilike', value: '%active%' },
      { field: 'teacher_ids', operator: 'contains', value: ['teacher-1'] },
      { field: 'notes', operator: 'is', value: 'null' },
    ]), resources.occurrences)).toEqual([
      { field: 'status', operator: 'ilike', value: '%active%' },
      { field: 'teacher_ids', operator: 'contains', value: ['teacher-1'] },
      { field: 'notes', operator: 'is', value: 'null' },
    ])
  })

  it('validates OR expressions against the resource allowlist', () => {
    expect(parseOr('name.ilike.%Ada%,user_id.eq.00000000-0000-0000-0000-000000000001', resources.teachers))
      .toBe('name.ilike.%Ada%,user_id.eq.00000000-0000-0000-0000-000000000001')
    expect(() => parseOr('password.eq.secret', resources.teachers)).toThrowError('The or filter is not supported')
    expect(() => parseOr('name.ilike.%Ada%(admin)', resources.teachers)).toThrowError('The or filter is not supported')
  })

  it('accepts only allowlisted relation sorts used by report queries', () => {
    expect(listQuerySchema.parse({ sort: 'created_at' }).sort).toBe('created_at')
    expect(listQuerySchema.parse({ sort: '-created_at' }).sort).toBe('-created_at')
    expect(listQuerySchema.parse({ sort: 'class_occurrences(occurrence_date)' }).sort)
      .toBe('class_occurrences(occurrence_date)')
    expect(resources.reports.sortable).toContain('class_occurrences(occurrence_date)')
    expect(() => listQuerySchema.parse({ sort: 'class_occurrences(occurrence_date).asc' })).toThrow()
  })

  it('keeps relation sort syntax restricted to a single allowlisted relation column', () => {
    expect(resources.reports.sortable).not.toContain('class_occurrences(class_sessions(name))')
    expect(() => listQuerySchema.parse({ sort: 'class_occurrences(class_sessions(name))' })).toThrow()
  })
})
