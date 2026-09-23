import { describe, expect, it } from 'vitest'
import { roleDisplayName } from './roleDisplay'

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
