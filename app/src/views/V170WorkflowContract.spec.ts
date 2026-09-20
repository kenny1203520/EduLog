import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

describe('v1.7 report visibility and hierarchical policy workflow', () => {
    it('uses notification eligibility for the incomplete-report page and reuses the Dashboard read model', () => {
        const home = read('src/views/HomeView.vue')
        const globalIncompleteReports = read('src/views/GlobalIncompleteReportsView.vue')

        expect(home).toContain('agg.pendingReports')
        expect(home).toContain('pendingReportsCount')
        expect(home).not.toContain('getGlobalIncompleteReports(')
        expect(globalIncompleteReports).toContain("getGlobalIncompleteReportsPage('my_notifications'")
        expect(globalIncompleteReports).not.toContain("getGlobalIncompleteReportsPage('my_present'")
        expect(globalIncompleteReports).not.toContain("getGlobalIncompleteReportsPage('all'")
        expect(globalIncompleteReports).toContain('incompleteReports.value = []')
        expect(globalIncompleteReports).toContain('selectedReport.value = null')
        expect(read('src/services/report/ReportQueryService.ts')).toContain("if (scope === 'my_notifications') throw error")
        expect(read('src/services/AggregateService.ts')).toContain("if (scope === 'my_notifications') return fetchReports()")
        expect(read('src/services/AggregateService.ts')).toContain("request.cache = 'no-store'")
        expect(read('../supabase/volumes/functions/aggregate-incomplete-reports/index.ts'))
            .toContain("(scope === 'my_present' || scope === 'my_notifications') && !teacherId")
    })

    it('keeps created entities in edit mode before dependent policy writes', () => {
        const source = read('src/views/ClassroomManagementView.vue')
        expect(source.indexOf('editingClassroom.value = saved')).toBeLessThan(source.indexOf("{ type: 'classroom', id: saved.id }"))
        expect(source.indexOf('editingSession.value = saved')).toBeLessThan(source.indexOf("{ type: 'class_session', id: sessionId }"))
    })

    it('uses the shared scoped editor in settings, room management and the class editor', () => {
        expect(read('src/components/settings/IncompleteReportNotificationSettings.vue')).toContain('ScopedRolePolicyEditor')
        expect(read('src/components/classroom/ClassroomManagementPanel.vue')).toContain('ScopedRolePolicyEditor')
        expect(read('src/views/ClassroomManagementView.vue')).toContain('ScopedRolePolicyEditor')
    })

    it('provides responsive room tabs, child search and unsaved save/discard actions', () => {
        const source = read('src/components/classroom/ClassroomManagementPanel.vue')
        expect(source).toContain('sm:max-w-5xl')
        expect(source).toContain("['details', 'notifications', 'sessions']")
        expect(source).toContain('search_child_sessions')
        expect(source).toContain('saveSessionPolicy(true)')
        expect(source).toContain('discardAndContinue')
    })
})
