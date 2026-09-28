import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const paths = [
    'src/components/settings/SystemSettingsPanel.vue',
    'src/components/settings/PlatformTeachingRoleAssignmentsPanel.vue',
    'src/components/classroom/ClassroomRoleAssignmentsPanel.vue',
    'src/components/teacher/TeacherAccountLinkDialog.vue'
]

describe('administrative account search minimum', () => {
    it('starts searching as soon as a non-whitespace query is entered', () => {
        const sources = paths.map(path => readFileSync(resolve(process.cwd(), path), 'utf8'))
        expect(sources.every(source => !source.includes('length < 2'))).toBe(true)
        expect(sources.some(source => source.includes('if (!userQuery.value)'))).toBe(true)
        expect(sources.some(source => source.includes('if (!normalized)'))).toBe(true)
        expect(sources.some(source => source.includes('if (!value.trim())'))).toBe(true)
    })
})
