import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/settings/PlatformTeachingRoleAssignmentsPanel.vue'), 'utf8')

describe('teaching role assignment selection guidance', () => {
    it('shows the user-selection guidance in both assignment sections', () => {
        expect(source.match(/rbac\.teaching_assignment_guidance\.select_user/g)).toHaveLength(2)
        expect(source).toContain('rootAssignments.length')
        expect(source).toContain('localAssignments.length')
        expect(source).toContain('exclusions.length')
    })

    it('disables assignment controls until a user is selected and guards mutations', () => {
        expect(source).toContain('rootLoading || rolesLoading || !userId')
        expect(source).toContain('rolesLoading || localLoading || exclusionLoading || !userId')
        expect(source).toContain(':disabled="saving || !userId"')
        expect(source).toContain(':disabled="saving || localLoading || !userId"')
        expect(source).toContain(':disabled="saving || exclusionLoading || !userId"')
        expect(source).toContain('!userId.value || !roleId.value || !effectiveFrom.value')
        expect(source).toContain('!scopeReady.value || !userId.value || !roleId.value')
    })
})
