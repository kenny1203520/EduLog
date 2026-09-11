import { describe, expect, it } from 'vitest'
import { safeUuid } from './audit.js'

describe('audit resource identifiers', () => {
  it('only accepts real UUIDs and never promotes route verbs to resource ids', () => {
    expect(safeUuid('00000000-0000-4000-8000-000000000010')).toBe('00000000-0000-4000-8000-000000000010')
    expect(safeUuid('generate')).toBeNull()
    expect(safeUuid('transfer-history')).toBeNull()
    expect(safeUuid(undefined)).toBeNull()
  })
})
