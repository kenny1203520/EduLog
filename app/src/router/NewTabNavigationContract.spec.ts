import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function openingTags(code: string, element: 'router-link' | 'a' | 'button'): string[] {
    return [...code.matchAll(new RegExp(`<${element}\\b[\\s\\S]*?>`, 'gi'))].map(match => match[0])
}

function tagsContaining(code: string, element: 'router-link' | 'a' | 'button', marker: string): string[] {
    return openingTags(code, element).filter(tag => tag.includes(marker))
}

function expectSecureNewTab(tags: string[]): void {
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) {
        expect(tag).toContain('target="_blank"')
        expect(tag).toContain('rel="noopener noreferrer"')
    }
}

describe('contextual new-tab navigation contract', () => {
    it('opens student profile and report details from list and report workspaces', () => {
        const studentManagement = source('src/views/StudentManagementView.vue')
        expectSecureNewTab(tagsContaining(studentManagement, 'router-link', "name: 'student-profile'"))
        expectSecureNewTab(tagsContaining(studentManagement, 'router-link', "name: 'student-all-reports'"))

        const roster = source('src/components/classroom/StudentRosterPanel.vue')
        expect(tagsContaining(roster, 'a', 'item.profileHref')).toHaveLength(2)
        expect(tagsContaining(roster, 'a', 'item.reportHref')).toHaveLength(2)
        expectSecureNewTab(tagsContaining(roster, 'a', 'item.profileHref'))
        expectSecureNewTab(tagsContaining(roster, 'a', 'item.reportHref'))

        const incompleteReports = source('src/views/GlobalIncompleteReportsView.vue')
        expectSecureNewTab(tagsContaining(incompleteReports, 'router-link', 'selectedReport.fullStudent.id'))

        const enrollments = source('src/components/StudentEnrollments.vue')
        expectSecureNewTab(tagsContaining(enrollments, 'router-link', "name: 'lesson-reports'"))

        const allReports = source('src/views/StudentAllReportsView.vue')
        expectSecureNewTab(tagsContaining(allReports, 'router-link', "name: 'lesson-reports'"))
    })

    it('opens dashboard and classroom workspace details without replacing the current context', () => {
        const home = source('src/views/HomeView.vue')
        const homeSessions = tagsContaining(home, 'router-link', "name: 'session-details'")
        expect(homeSessions).toHaveLength(2)
        expectSecureNewTab(homeSessions)
        expectSecureNewTab(tagsContaining(home, 'router-link', "name: 'lesson-reports'"))
        expect(home).not.toContain('function navigateToSession')
        expect(home).not.toContain('function openReport')

        const classrooms = source('src/views/ClassroomManagementView.vue')
        expectSecureNewTab(tagsContaining(classrooms, 'router-link', "name: 'session-details'"))
        expect(classrooms).not.toContain('function navigateToSession')

        const session = source('src/views/SessionDetailsView.vue')
        expectSecureNewTab(tagsContaining(session, 'router-link', "name: 'classrooms'"))
        expectSecureNewTab(tagsContaining(session, 'router-link', '/dashboard/teachers'))
    })

    it('keeps primary navigation and state-changing controls in the current tab', () => {
        const home = source('src/views/HomeView.vue')
        const studentManagementButton = tagsContaining(home, 'button', "name: 'students'")
        const courseManagementButton = tagsContaining(home, 'button', "name: 'courses'")
        const allIncompleteButton = tagsContaining(home, 'button', 'navigateToGlobalIncomplete')
        expect(studentManagementButton).toHaveLength(1)
        expect(courseManagementButton).toHaveLength(1)
        expect(allIncompleteButton).toHaveLength(1)
        expect([...studentManagementButton, ...courseManagementButton, ...allIncompleteButton].every(tag => !tag.includes('target='))).toBe(true)

        const about = source('src/views/AboutView.vue')
        const changelog = tagsContaining(about, 'router-link', '/dashboard/about/changelog')
        expect(changelog).toHaveLength(1)
        expect(changelog[0]).not.toContain('target=')

        const mainLayout = source('src/layouts/MainLayout.vue')
        expect(openingTags(mainLayout, 'router-link').every(tag => !tag.includes('target='))).toBe(true)
    })
})
