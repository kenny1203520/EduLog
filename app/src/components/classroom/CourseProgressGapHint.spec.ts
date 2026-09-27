import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import CourseProgressGapHint from './CourseProgressGapHint.vue'

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => `${key}${values ? ` ${Object.values(values).join(' ')}` : ''}` })
}))

describe('CourseProgressGapHint', () => {
    it('uses a keyboard-operable native disclosure with the full missing lesson list', async () => {
        const wrapper = mount(CourseProgressGapHint, {
            props: { lessons: [{ id: 'lesson-6', sequence: 6, title: 'Lesson Six' }, { id: 'lesson-9', sequence: 9, title: 'Lesson Nine' }] }
        })

        const details = wrapper.get('details')
        const summary = details.get('summary')
        expect(summary.attributes('tabindex')).toBeUndefined()
        expect(summary.classes()).toContain('flex-wrap')
        expect(summary.text()).toContain('classroom.progress_gap_short')
        expect(summary.text()).toContain('classroom.progress_gap_sequence 6')
        expect(summary.text()).not.toContain('...')
        expect(summary.text()).toContain('+1')
        await summary.trigger('click')
        expect(details.attributes('open')).toBeDefined()
        expect(details.text()).toContain('classroom.progress_gap_details 6 Lesson Six')
        expect(details.text()).toContain('classroom.progress_gap_details 9 Lesson Nine')
        expect(details.find('li').classes()).toContain('break-words')
        expect(details.find('ul').classes()).toContain('progress-gap-lessons')
    })

    it('does not render a hint when no lessons are missing', () => {
        expect(mount(CourseProgressGapHint, { props: { lessons: [] } }).find('details').exists()).toBe(false)
    })

    it('keeps a single missing lesson concise while allowing long course titles to wrap', async () => {
        const wrapper = mount(CourseProgressGapHint, {
            props: { lessons: [{ id: 'lesson-6', sequence: 6, title: 'Introduction to Advanced Responsive Web Application Development' }] }
        })
        const summary = wrapper.get('summary')

        expect(summary.text()).toContain('classroom.progress_gap_short')
        expect(summary.text()).toContain('classroom.progress_gap_sequence 6')
        expect(summary.text()).not.toContain('+')

        await summary.trigger('click')
        expect(wrapper.get('li').classes()).toContain('break-words')
        expect(wrapper.get('li').text()).toContain('Advanced Responsive Web Application Development')
    })
})
