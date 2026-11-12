import { describe, expect, it } from 'vitest'
import { roleDisplayDescription, roleDisplayName } from './roleDisplay'

describe('roleDisplayName', () => {
    it('uses the shared RBAC locale keys for default teaching roles', () => {
        const labels: Record<string, string> = {
            'rbac.roles.teaching_owner.name': '教學負責人',
            'rbac.roles.teacher.name': 'Teacher',
        }
        const translate = (key: string) => labels[key] ?? key

        expect(roleDisplayName({ code: 'teaching_owner', name: 'Teaching Owner' }, translate)).toBe('教學負責人')
        expect(roleDisplayName({ code: 'teacher', name: '教師' }, translate)).toBe('Teacher')
    })

    it('localizes a built-in role by its stable code', () => {
        const labels: Record<string, string> = {
            'settings.teacher_roles.names.teacher': '教師'
        }
        const translate = (key: string) => labels[key] ?? key

        expect(roleDisplayName({ id: 'teacher-role', code: 'teacher', name: 'Teacher', is_system: true }, translate))
            .toBe('教師')
    })

    it('uses the shared RBAC locale keys for built-in system roles', () => {
        const labels: Record<string, string> = {
            'rbac.roles.system_admin.name': '系統管理員',
            'rbac.roles.auditor.name': '稽核員',
        }
        const translate = (key: string) => labels[key] ?? key

        expect(roleDisplayName({ code: 'system_admin', name: 'System Administrator', is_system: true }, translate)).toBe('系統管理員')
        expect(roleDisplayName({ code: 'auditor', name: 'Auditor' }, translate)).toBe('稽核員')
    })

    it('keeps custom role names as entered', () => {
        const translate = (key: string) => key
        expect(roleDisplayName({ code: null, name: '我的自訂職務', is_system: false }, translate)).toBe('我的自訂職務')
    })
})

describe('roleDisplayDescription', () => {
    it('localizes built-in role descriptions by their stable code', () => {
        const labels: Record<string, string> = {
            'rbac.roles.system_owner.description': 'EduLog 系統的受保護擁有者'
        }
        const translate = (key: string) => labels[key] ?? key

        expect(roleDisplayDescription({ code: 'system_owner', is_builtin: true, description: 'Protected owner' }, translate))
            .toBe('EduLog 系統的受保護擁有者')
    })

    it('keeps custom role descriptions as entered', () => {
        const translate = (key: string) => key
        expect(roleDisplayDescription({ code: 'custom_role', is_builtin: false, description: 'Team lead' }, translate))
            .toBe('Team lead')
    })
})
