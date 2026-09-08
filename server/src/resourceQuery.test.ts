import { describe, expect, it } from 'vitest'
import { listQuerySchema } from './resources.js'

describe('resource collection query contract', () => {
  it('accepts scoped filters used by report and enrollment clients', () => {
    const result = listQuerySchema.parse({ limit: '10', offset: '0', enrollment_id: 'enrollment-1', class_occurrence_id: 'occurrence-1', sort: '-created_at' })
    expect(result.enrollment_id).toBe('enrollment-1')
    expect(result.class_occurrence_id).toBe('occurrence-1')
  })
})
