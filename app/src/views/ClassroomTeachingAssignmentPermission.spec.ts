import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/ClassroomManagementView.vue'), 'utf8').replace(/\r\n/g, '\n')

describe('class staffing permission flow', () => {
    it('checks role-management access for the active target scope and explains unavailable access', () => {
        expect(source).toContain("RoleService.canManageRoleScope(scopeType, scopeId)")
        expect(source).toContain('teacher_assignment_manage_required')
        expect(source).toContain('teacher_assignment_permission_check_failed')
        expect(source).toContain(':disabled="teacherRoleManageAllowed !== true')
    })

    it('saves class staffing only when it changed so unrelated class edits do not require role management', () => {
        expect(source).toContain('if (teacherAssignmentsChanged.value && teacherRoleManageAllowed.value !== true)')
        expect(source).toContain('if (teacherAssignmentsChanged.value) {\n            const assignmentsToSave')
    })
})
