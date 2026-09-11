import { describe, expect, it } from 'vitest'
import { listQuerySchema } from './resources.js'

describe('resource collection query contract', () => {
  it('accepts scoped filters used by report and enrollment clients', () => {
    const result = listQuerySchema.parse({ limit: '10', offset: '0', enrollment_id: '00000000-0000-4000-8000-000000000001', class_occurrence_id: '00000000-0000-4000-8000-000000000002', sort: '-created_at' })
    expect(result.enrollment_id).toBe('00000000-0000-4000-8000-000000000001')
    expect(result.class_occurrence_id).toBe('00000000-0000-4000-8000-000000000002')
  })

  it('accepts the enrollment status filter used by the frontend', () => {
    const result = listQuerySchema.parse({ status: 'regular' })
    expect(result.status).toBe('regular')
  })
})
