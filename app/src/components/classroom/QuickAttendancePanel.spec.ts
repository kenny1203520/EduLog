import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import QuickAttendancePanel from './QuickAttendancePanel.vue'

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string) => key })
}))

const students = [
    { id: 'student-1', name: '王小明', status: 'pending' as const, isSaving: false },
    { id: 'student-2', name: '陳小華', status: 'present' as const, isSaving: false }
]

function mountPanel(overrides: Record<string, unknown> = {}) {
    return mount(QuickAttendancePanel, {
        props: {
            students,
            selectedIds: [],
            counts: { pending: 1, present: 1, absent: 0 },
            emptyMessage: 'No students',
            ...overrides
        }
    })
}

describe('QuickAttendancePanel', () => {
    it('keeps every student name and all three direct states in the visible DOM', () => {
        const wrapper = mountPanel()

        expect(wrapper.text()).toContain('王小明')
        expect(wrapper.text()).toContain('陳小華')
        expect(wrapper.find('.attendance-grid').exists()).toBe(true)
        expect(wrapper.findAll('[data-student-id]')).toHaveLength(2)
        expect(wrapper.findAll('[data-attendance-status]')).toHaveLength(6)
    })

    it('emits direct attendance changes and treats the current state as a no-op', async () => {
        const wrapper = mountPanel()
        const first = wrapper.find('[data-student-id="student-1"]')

        await first.find('[data-attendance-status="pending"]').trigger('click')
        expect(wrapper.emitted('set-attendance')).toBeUndefined()

        await first.find('[data-attendance-status="present"]').trigger('click')
        expect(wrapper.emitted('set-attendance')).toEqual([['student-1', 'present']])
    })

    it('supports independent visible selection and all three batch states', async () => {
        const wrapper = mountPanel({ selectedIds: ['student-1'] })
        const checkbox = wrapper.find('[data-student-id="student-2"] input[type="checkbox"]')
        await checkbox.trigger('change')
        expect(wrapper.emitted('toggle-selection')).toEqual([['student-2']])

        const batchButtons = wrapper.findAll('button').filter(button =>
            ['attendance.pending', 'attendance.present', 'attendance.absent'].includes(button.text())
            && !button.attributes('data-attendance-status')
        )
        expect(batchButtons).toHaveLength(3)
        await batchButtons[0].trigger('click')
        expect(wrapper.emitted('batch-set-attendance')).toEqual([['pending']])
    })

    it('disables a saving student without hiding their status', () => {
        const wrapper = mountPanel({
            students: [{ id: 'student-1', name: '王小明', status: 'absent', isSaving: true }]
        })
        const buttons = wrapper.findAll('[data-student-id="student-1"] [data-attendance-status]')
        expect(buttons).toHaveLength(3)
        expect(buttons.every(button => button.attributes('disabled') !== undefined)).toBe(true)
        expect(wrapper.text()).toContain('common.saving')
    })

    it('distinguishes filtered empty results and exposes clearing filters', async () => {
        const wrapper = mountPanel({ students: [], showClearFilters: true, emptyMessage: 'No matches' })
        expect(wrapper.text()).toContain('No matches')
        await wrapper.get('button.mt-3').trigger('click')
        expect(wrapper.emitted('clear-filters')).toHaveLength(1)
    })
})
