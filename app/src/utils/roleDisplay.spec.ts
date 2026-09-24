import { describe, expect, it } from 'vitest'
import { roleDisplayDescription, roleDisplayName } from './roleDisplay'

describe('roleDisplayName', () => {
    it('localizes a built-in role by its stable code', () => {
        const labels: Record<string, string> = {
            'settings.teacher_roles.names.teacher': '教師'
        }
        const translate = (key: string) => labels[key] ?? key

        expect(roleDisplayName({ id: 'teacher-role', code: 'teacher', name: 'Teacher', is_system: true }, translate))
            .toBe('教師')
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
