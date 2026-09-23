import { describe, expect, it } from 'vitest'
import { getEffectiveTeacherAssignments } from './effectiveTeacherAssignments'
import type { SessionTeacherAssignmentDTO } from '@/services/teacher/TeacherService'

const assignment = (id: string, effective_from: string, effective_to: string | null, roleName: string): SessionTeacherAssignmentDTO => ({
    id,
    name: `Teacher ${id}`,
    email: '',
    effective_from,
    effective_to,
    role_id: roleName,
    role: { id: roleName, name: roleName }
})

describe('getEffectiveTeacherAssignments', () => {
    it('returns only active teachers once and keeps the first active assignment role', () => {
        const result = getEffectiveTeacherAssignments([
            assignment('teacher-1', '2024-01-01', '2025-12-31', 'Old role'),
            assignment('teacher-1', '2025-01-15', null, 'Current role'),
            assignment('teacher-2', '2025-02-01', '2025-02-28', 'Temporary role'),
            assignment('teacher-3', '2025-03-01', null, 'Future role')
        ], '2025-02-15')

        expect(result.map(item => [item.id, item.role?.name]).sort(([left], [right]) => String(left).localeCompare(String(right)))).toEqual([
            ['teacher-1', 'Current role'],
            ['teacher-2', 'Temporary role']
        ])
    })
})
