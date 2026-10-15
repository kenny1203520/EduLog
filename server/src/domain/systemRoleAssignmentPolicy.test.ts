import { describe, expect, it } from 'vitest'
import { hasOverlappingSystemRoleAssignment, type SystemRoleAssignmentInterval } from './systemRoleAssignmentPolicy.js'

const existing: SystemRoleAssignmentInterval[] = [
  { id: 'current', user_id: 'u1', role_id: 'r1', effective_from: '2026-01-10', effective_to: '2026-02-10' },
  { id: 'open-ended', user_id: 'u2', role_id: 'r1', effective_from: '2026-01-01', effective_to: null },
]

describe('system role assignment date policy', () => {
  it('rejects inclusive overlap for the same user and system role', () => {
    expect(hasOverlappingSystemRoleAssignment(existing, 'u1', 'r1', '2026-02-10', null)).toBe(true)
  })

  it('allows a non-overlapping interval, another role, or another user', () => {
    expect(hasOverlappingSystemRoleAssignment(existing, 'u1', 'r1', '2026-02-11', null)).toBe(false)
    expect(hasOverlappingSystemRoleAssignment(existing, 'u1', 'r2', '2026-01-01', null)).toBe(false)
    expect(hasOverlappingSystemRoleAssignment(existing, 'u3', 'r1', '2026-01-01', null)).toBe(false)
  })

  it('ignores the assignment being edited and treats no end date as open-ended', () => {
    expect(hasOverlappingSystemRoleAssignment(existing, 'u1', 'r1', '2026-01-01', '2026-01-20', 'current')).toBe(false)
    expect(hasOverlappingSystemRoleAssignment(existing, 'u2', 'r1', '2026-12-01', null)).toBe(true)
  })
})
