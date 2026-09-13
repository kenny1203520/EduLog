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
    expect(parseOr('name.ilike.%Ada%,email.ilike.%example.test%', resources.teachers))
      .toBe('name.ilike.%Ada%,email.ilike.%example.test%')
    expect(() => parseOr('password.eq.secret', resources.teachers)).toThrowError('The or filter is not supported')
    expect(() => parseOr('name.ilike.%Ada%(admin)', resources.teachers)).toThrowError('The or filter is not supported')
  })

  it('accepts only allowlisted relation sorts used by report queries', () => {
    expect(listQuerySchema.parse({ sort: 'class_occurrences(occurrence_date)' }).sort)
      .toBe('class_occurrences(occurrence_date)')
    expect(resources.reports.sortable).toContain('class_occurrences(occurrence_date)')
    expect(() => listQuerySchema.parse({ sort: 'class_occurrences(occurrence_date).asc' })).toThrow()
  })
})
