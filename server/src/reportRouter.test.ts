import { describe, expect, it } from 'vitest'
import { assertClientManagedAttendanceReason, firstUncompletedSequence } from './reportRouter.js'

describe('report lifecycle progress', () => {
  it('selects the first lesson not represented by a report', () => {
    expect(firstUncompletedSequence([{ id: 'a', sequence: 1 }, { id: 'b', sequence: 2 }], new Set(['a']), 1)).toBe(2)
    expect(firstUncompletedSequence([{ id: 'a', sequence: 1 }], new Set(['a']), 1)).toBe(1)
  })

  it('rejects forged server-managed attendance reasons', () => {
    expect(() => assertClientManagedAttendanceReason('holiday')).toThrow('Holiday and suspension')
    expect(() => assertClientManagedAttendanceReason('suspension')).toThrow('Holiday and suspension')
    expect(() => assertClientManagedAttendanceReason('teacher_note')).not.toThrow()
  })
})
