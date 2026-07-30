import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function openingTags(code: string, element: 'router-link' | 'a'): string[] {
    return [...code.matchAll(new RegExp(`<${element}\\b[\\s\\S]*?>`, 'gi'))].map(match => match[0])
}

function tagsContaining(code: string, element: 'router-link' | 'a', marker: string): string[] {
    return openingTags(code, element).filter(tag => tag.includes(marker))
}

function expectNativeInternalLinks(tags: string[]): void {
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) {
        expect(tag).not.toContain('target="_blank"')
        expect(tag).not.toContain('rel="noopener noreferrer"')
    }
}

describe('native internal navigation contract', () => {
    it('keeps student and report details as real same-tab links', () => {
        const studentManagement = source('src/views/StudentManagementView.vue')
        expectNativeInternalLinks(tagsContaining(studentManagement, 'router-link', "name: 'student-profile'"))
        expectNativeInternalLinks(tagsContaining(studentManagement, 'router-link', "name: 'student-all-reports'"))

        const roster = source('src/components/classroom/StudentRosterPanel.vue')
        expect(tagsContaining(roster, 'a', 'item.profileHref')).toHaveLength(2)
        expect(tagsContaining(roster, 'a', 'item.reportHref')).toHaveLength(2)
        expectNativeInternalLinks(tagsContaining(roster, 'a', 'item.profileHref'))
        expectNativeInternalLinks(tagsContaining(roster, 'a', 'item.reportHref'))

        const incompleteReports = source('src/views/GlobalIncompleteReportsView.vue')
        expectNativeInternalLinks(tagsContaining(incompleteReports, 'router-link', 'selectedReport.fullStudent.id'))

        const enrollments = source('src/components/StudentEnrollments.vue')
        expectNativeInternalLinks(tagsContaining(enrollments, 'router-link', "name: 'lesson-reports'"))

        const allReports = source('src/views/StudentAllReportsView.vue')
        expectNativeInternalLinks(tagsContaining(allReports, 'router-link', "name: 'lesson-reports'"))
    })

    it('keeps dashboard and classroom workspaces as native internal links', () => {
        const home = source('src/views/HomeView.vue')
        expect(tagsContaining(home, 'router-link', "name: 'session-details'")).toHaveLength(2)
        expectNativeInternalLinks(tagsContaining(home, 'router-link', "name: 'session-details'"))
        expectNativeInternalLinks(tagsContaining(home, 'router-link', "name: 'lesson-reports'"))
        expectNativeInternalLinks(tagsContaining(home, 'router-link', "name: 'students'"))
        expectNativeInternalLinks(tagsContaining(home, 'router-link', "name: 'courses'"))
        expectNativeInternalLinks(tagsContaining(home, 'router-link', "name: 'classrooms'"))
        expectNativeInternalLinks(tagsContaining(home, 'router-link', "name: 'incomplete-reports'"))

        const classrooms = source('src/views/ClassroomManagementView.vue')
        expectNativeInternalLinks(tagsContaining(classrooms, 'router-link', "name: 'session-details'"))

        const session = source('src/views/SessionDetailsView.vue')
        expectNativeInternalLinks(tagsContaining(session, 'router-link', "name: 'classrooms'"))
        expectNativeInternalLinks(tagsContaining(session, 'router-link', '/dashboard/teachers'))
    })

    it('uses links for page navigation while preserving stateful redirects', () => {
        const landing = source('src/views/LandingView.vue')
        expectNativeInternalLinks(tagsContaining(landing, 'router-link', 'to="/"'))
        expectNativeInternalLinks(tagsContaining(landing, 'router-link', 'to="/login"'))
        expectNativeInternalLinks(tagsContaining(landing, 'router-link', ':to="getStartedRoute"'))

        const login = source('src/views/LoginView.vue')
        expectNativeInternalLinks(tagsContaining(login, 'router-link', 'to="/"'))
        expect(login).toContain("router.push('/dashboard')")

        const profile = source('src/views/StudentProfileView.vue')
        expect(tagsContaining(profile, 'router-link', 'to="/dashboard"')).toHaveLength(2)
        expectNativeInternalLinks(tagsContaining(profile, 'router-link', 'to="/dashboard"'))

        expect(source('src/layouts/MainLayout.vue')).toContain("router.push('/login')")
        expect(source('src/components/StudentMainDetails.vue')).toContain("router.push('/dashboard')")
    })
})
