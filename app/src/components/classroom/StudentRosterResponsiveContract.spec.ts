import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(resolve(process.cwd(), 'src/components/classroom/StudentRosterPanel.vue'), 'utf8')
const page = readFileSync(resolve(process.cwd(), 'src/views/SessionDetailsView.vue'), 'utf8')

describe('student roster responsive contract', () => {
    it('uses its own container width instead of viewport-only column rules', () => {
        expect(component).toContain('container-type: inline-size')
        expect(component).toContain('@container student-roster (min-width: 46rem)')
        expect(component).toContain('@container student-roster (min-width: 68rem)')
        expect(component).not.toContain('2xl:grid-cols')
    })

    it('keeps one roster implementation in the class page during split view', () => {
        expect(page).toContain('<StudentRosterPanel')
        expect(page).not.toContain("showSplitView ? '2xl:hidden' : 'xl:hidden'")
        expect(page).not.toContain("showSplitView ? 'hidden 2xl:block' : 'hidden xl:block'")
    })

    it('retains scroll targeting and visible named actions in both layouts', () => {
        expect(component).toContain(':data-enrollment-id="item.id"')
        expect(component).toContain(':href="item.reportHref"')
        expect(component).toContain(':href="item.profileHref"')
        expect(component).toContain("t('classroom.view_reports')")
        expect(component).not.toContain('target="_blank"')
        expect(component).not.toContain('rel="noopener noreferrer"')
        expect(component).toContain("t('classroom.quick_edit')")
        expect(component).toContain("t('classroom.koding_check')")
        expect(component).toContain("t('common.profile')")
    })
})
