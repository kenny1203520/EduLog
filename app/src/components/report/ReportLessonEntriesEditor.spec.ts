import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ReportLessonEntriesEditor from './ReportLessonEntriesEditor.vue'

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => `${key}${values ? ` ${Object.values(values).join(' ')}` : ''}` }),
}))

const entry = {
    id: 'entry-a', enrollment_id: 'enrollment-a', lesson_id: 'lesson-a', is_completed: false, progress_letter: null,
}
const options = [
    { id: 'enrollment-a', course_id: 'course-a', course_name: 'Course A', lessons: [{ id: 'lesson-a', sequence: 1, title: 'Lesson A1' }] },
    { id: 'enrollment-b', course_id: 'course-b', course_name: 'Course B', lessons: [{ id: 'lesson-b', sequence: 2, title: 'Lesson B2' }] },
]

describe('ReportLessonEntriesEditor', () => {
    it('labels course and lesson controls and resets lesson progress when enrollment changes', async () => {
        const progressedEntry = { ...entry, is_completed: true, progress_letter: 'B-C' }
        const wrapper = mount(ReportLessonEntriesEditor, {
            props: {
                entries: [progressedEntry], primaryEntryId: entry.id, editorId: 'editor-a', defaultEnrollmentId: 'enrollment-a', options,
            },
            global: { mocks: { $t: (key: string, values?: Record<string, unknown>) => `${key}${values ? ` ${Object.values(values).join(' ')}` : ''}` } },
        })

        expect(wrapper.find('label[for="editor-a-entry-entry-a-course"]').text()).toContain('report.editor.lesson_entries.course')
        expect(wrapper.find('label[for="editor-a-entry-entry-a-lesson"]').text()).toContain('report.editor.lesson_label')
        await wrapper.get('#editor-a-entry-entry-a-course').setValue('enrollment-b')
        expect(wrapper.emitted('update:entries')?.at(-1)?.[0]).toEqual([expect.objectContaining({
            id: 'entry-a', enrollment_id: 'enrollment-b', lesson_id: null, is_completed: false, progress_letter: null,
            course_id: 'course-b', course_name: 'Course B',
        })])
    })

    it('adds, removes, and marks a primary lesson entry with keyboard-operable native controls', async () => {
        const wrapper = mount(ReportLessonEntriesEditor, {
            props: {
                entries: [entry], primaryEntryId: entry.id, editorId: 'editor-a', defaultEnrollmentId: 'enrollment-a', options,
            },
            global: { mocks: { $t: (key: string, values?: Record<string, unknown>) => `${key}${values ? ` ${Object.values(values).join(' ')}` : ''}` } },
        })

        await wrapper.get('input[type="checkbox"]').setValue(true)
        expect(wrapper.emitted('update:entries')?.[0]?.[0]).toEqual([expect.objectContaining({ is_completed: true })])

        await wrapper.get('button').trigger('click')
        const added = wrapper.emitted('update:entries')?.at(-1)?.[0] as Array<typeof entry>
        expect(added).toHaveLength(2)
        expect(added[1]).toMatchObject({ enrollment_id: 'enrollment-a', course_id: 'course-a', lesson_id: null, is_completed: false })

        await wrapper.setProps({ entries: added })
        expect(wrapper.find('[role="status"]').text()).toContain('report.editor.lesson_entries.select_lesson_required')
        expect(wrapper.get(`#editor-a-entry-${added[1]?.id}-lesson`).attributes('aria-invalid')).toBe('true')
        await wrapper.findAll('input[type="radio"]')[1]?.setValue(true)
        expect(wrapper.emitted('update:primaryEntryId')?.at(-1)?.[0]).toBe(added[1]?.id)
    })
})
