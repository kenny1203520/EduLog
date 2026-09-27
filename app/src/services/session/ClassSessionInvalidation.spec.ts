import { describe, expect, it } from 'vitest'
import { invalidationAffectsDate, parseClassSessionDate } from './ClassSessionInvalidation'

describe('class session invalidation date scopes', () => {
  it('accepts only real YYYY-MM-DD calendar dates', () => {
    expect(parseClassSessionDate('2026-09-27')).toBe('2026-09-27')
    expect(parseClassSessionDate('2026-02-30')).toBeUndefined()
    expect(parseClassSessionDate('2026-9-27')).toBeUndefined()
  })

  it('matches exact dates, inclusive ranges, and class-wide invalidations', () => {
    expect(invalidationAffectsDate('2026-09-27', { date_from: '2026-09-27', date_to: '2026-09-27' })).toBe(true)
    expect(invalidationAffectsDate('2026-09-28', { date_from: '2026-09-27', date_to: '2026-09-29' })).toBe(true)
    expect(invalidationAffectsDate('2026-09-30', { date_from: '2026-09-27', date_to: '2026-09-29' })).toBe(false)
    expect(invalidationAffectsDate('2026-09-30', {})).toBe(true)
  })

  it('fails open for malformed server scopes to avoid stale views', () => {
    expect(invalidationAffectsDate('2026-09-27', { date_from: 'yesterday' })).toBe(true)
  })
})
