import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import StudentRosterPanel, { type StudentRosterItem } from './StudentRosterPanel.vue'

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string) => key })
}))

const item: StudentRosterItem = {
    id: 'enrollment-1',
    studentId: 'student-1',
    reportHref: '/dashboard/students/enrollment-1/reports',
    name: '王小明',
    initials: '王',
    currentCourse: 'HTML5 網頁程式開發班',
    enrollmentStatus: '正式',
    enrollmentTone: 'regular',
    isGuest: false,
    attendanceStatus: 'pending',
    attendanceLabel: '待點名',
    isSavingAttendance: false,
    todayTitle: 'L15 Emoji 配對大作戰',
    todayProgress: 'A-K',
    todayCompletion: '未完成',
    todayTone: 'incomplete',
    highestTitle: 'L15 Emoji 配對大作戰',
    highestStatus: '已完成',
    highestTone: 'completed',
    latestTitle: 'L14 接水果王',
    latestStatus: '已完成',
    latestTone: 'completed',
    isEditing: false
}

function mountPanel(overrides: Record<string, unknown> = {}) {
    return mount(StudentRosterPanel, {
        props: {
            items: [item],
            resultCount: 1,
            hasOccurrence: true,
            emptyMessage: 'No students',
            ...overrides
        }
    })
}

describe('StudentRosterPanel', () => {
    it('keeps identity, attendance, course and learning progress visible in responsive representations', () => {
        const wrapper = mountPanel()

        expect(wrapper.find('.roster-container').exists()).toBe(true)
        expect(wrapper.find('.roster-cards').exists()).toBe(true)
        expect(wrapper.find('.roster-table').exists()).toBe(true)
        expect(wrapper.text()).toContain('王小明')
        expect(wrapper.text()).toContain('HTML5 網頁程式開發班')
        expect(wrapper.text()).toContain('L15 Emoji 配對大作戰')
        expect(wrapper.text()).toContain('L14 接水果王')
        expect(wrapper.findAll('[data-enrollment-id="enrollment-1"]')).toHaveLength(2)
    })

    it('cycles attendance from the list without coupling it to report actions', async () => {
        const wrapper = mountPanel()
        const attendanceButton = wrapper.find('[data-enrollment-id="enrollment-1"] button[aria-label]')

        await attendanceButton.trigger('click')
        expect(wrapper.emitted('set-attendance')).toEqual([['enrollment-1', 'present']])
        expect(wrapper.emitted('quick-edit')).toBeUndefined()
    })

    it('disables attendance during saving or protected occurrences', () => {
        const saving = mountPanel({ items: [{ ...item, isSavingAttendance: true }] })
        expect(saving.find('[data-enrollment-id="enrollment-1"] button[aria-label]').attributes('disabled')).toBeDefined()

        const protectedOccurrence = mountPanel({ attendanceDisabled: true })
        expect(protectedOccurrence.find('[data-enrollment-id="enrollment-1"] button[aria-label]').attributes('disabled')).toBeDefined()
    })

    it('emits all named student actions with stable identifiers', async () => {
        const wrapper = mountPanel()
        const card = wrapper.find('.roster-cards [data-enrollment-id="enrollment-1"]')
        const buttons = card.findAll('button')

        const reportLink = card.get('a')
        expect(reportLink.attributes('href')).toBe('/dashboard/students/enrollment-1/reports')
        expect(reportLink.attributes('target')).toBe('_blank')
        expect(reportLink.attributes('rel')).toBe('noopener noreferrer')
        await buttons.find(button => button.text() === 'classroom.quick_edit')!.trigger('click')
        await buttons.find(button => button.text() === 'classroom.koding_check')!.trigger('click')
        await buttons.find(button => button.text() === 'common.profile')!.trigger('click')

        expect(wrapper.emitted('quick-edit')).toEqual([['enrollment-1']])
        expect(wrapper.emitted('koding-check')).toEqual([['enrollment-1']])
        expect(wrapper.emitted('view-profile')).toEqual([['student-1']])
    })

    it('distinguishes an empty filter result and exposes filter reset', async () => {
        const wrapper = mountPanel({ items: [], resultCount: 0, showClearFilters: true, emptyMessage: 'No matches' })
        expect(wrapper.text()).toContain('No matches')
        await wrapper.get('button').trigger('click')
        expect(wrapper.emitted('clear-filters')).toHaveLength(1)
    })
})
