import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ReportReferencePanel from './ReportReferencePanel.vue'

const services = vi.hoisted(() => ({
    getCourseOptions: vi.fn().mockResolvedValue({ data: [] }),
    getAllClassroomsOverview: vi.fn().mockResolvedValue({ classrooms: [] }),
    getAllClassrooms: vi.fn().mockResolvedValue({ data: [] }),
    getAllClassSessionOptions: vi.fn().mockResolvedValue({ data: [] }),
    getStudentReferenceHistory: vi.fn(),
    getReportsByLesson: vi.fn(),
    reportError: vi.fn(),
}))

vi.mock('vue-i18n', async (importOriginal) => ({
    ...await importOriginal<typeof import('vue-i18n')>(),
    useI18n: () => ({ t: (key: string) => key, locale: { value: 'en' } }),
}))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => ({ reportError: services.reportError }) }))
vi.mock('@/services/course/CourseCatalogService', () => ({ CourseCatalogService: { getCourseOptions: services.getCourseOptions } }))
vi.mock('@/services/classroom/ClassroomService', () => ({ ClassroomService: { getAllClassrooms: services.getAllClassrooms } }))
vi.mock('@/services/api/AggregateService', () => ({ AggregateService: { getAllClassroomsOverview: services.getAllClassroomsOverview } }))
vi.mock('@/services/session/SessionService', () => ({ SessionService: { getAllClassSessionOptions: services.getAllClassSessionOptions } }))
vi.mock('@/services/report/ReportQueryService', () => ({
    ReportQueryService: {
        getStudentReferenceHistory: services.getStudentReferenceHistory,
        getReportsByLesson: services.getReportsByLesson,
    },
}))

describe('ReportReferencePanel linked lesson history', () => {
    it('defaults to the primary course and lesson and switches to another saved progress entry', async () => {
        services.getReportsByLesson.mockResolvedValue({ count: 0, data: [] })
        const wrapper = mount(ReportReferencePanel, {
            props: {
                show: true, primaryEntryId: 'primary', currentReportId: 'current',
                lessonChoices: [
                    { entryId: 'makeup', lessonId: 'lesson-a', courseName: 'Course A', title: 'Makeup' },
                    { entryId: 'primary', lessonId: 'lesson-b', courseName: 'Course B', title: 'Loops' },
                ],
            },
            global: { mocks: { $t: (key: string) => key }, stubs: { Teleport: true, BaseDropdown: true } },
        })
        await flushPromises()
        const select = wrapper.get('select')
        expect((select.element as HTMLSelectElement).value).toBe('primary')
        expect(select.text()).toContain('Course B · Loops')
        expect(services.getReportsByLesson).toHaveBeenLastCalledWith('lesson-b',
            expect.objectContaining({ page: 1, excludeReportId: 'current' }))
        await select.setValue('makeup')
        await flushPromises()
        expect(services.getReportsByLesson).toHaveBeenLastCalledWith('lesson-a', expect.objectContaining({ page: 1 }))
        wrapper.unmount()
    })

    it('shows all visible lesson entries together and can return from a focused report', async () => {
        services.getStudentReferenceHistory.mockResolvedValue({
            count: 1,
            data: [{
                id: 'shared-report', occurrence_date: '2026-11-11', attendance_status: 'present',
                is_linked_lesson_entry: true, contact_notes: 'Must remain hidden', content: '',
                lesson_entries: [
                    { id: 'a', course_name: 'Course A', lesson_id: 'a', progress_letter: 'C-D', is_completed: true },
                    { id: 'b', course_name: 'Course B', lesson_id: 'b', progress_letter: 'A-B', is_completed: false },
                ],
            }],
        })
        const wrapper = mount(ReportReferencePanel, {
            props: { show: true, studentId: 'student-b', currentReportId: 'editing', focusedReportId: 'shared-report' },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: { Teleport: true, BaseDropdown: true, RichTextViewer: true },
            },
        })
        await flushPromises()
        expect(services.getStudentReferenceHistory).toHaveBeenLastCalledWith('student-b', expect.objectContaining({
            reportId: 'shared-report', excludeReportId: 'editing', page: 1, pageSize: 10,
        }))
        expect(wrapper.findAll('li')).toHaveLength(2)
        expect(wrapper.text()).toContain('Course A')
        expect(wrapper.text()).toContain('Course B')
        expect(wrapper.text()).toContain('C-D')
        expect(wrapper.text()).not.toContain('Must remain hidden')
        expect(wrapper.get('button[title="report.reference_panel.copy_content"]').attributes('disabled')).toBeDefined()

        await wrapper.findAll('button').find(button => button.text() === 'report.reference_panel.view_all_history')!.trigger('click')
        await flushPromises()
        expect(services.getStudentReferenceHistory.mock.lastCall?.[1]).not.toHaveProperty('reportId')
        await wrapper.get('input[type="text"]').setValue('  make up  ')
        await wrapper.get('input[type="text"]').trigger('keyup.enter')
        await flushPromises()
        expect(services.getStudentReferenceHistory).toHaveBeenLastCalledWith('student-b', expect.objectContaining({ search: 'make up' }))
        wrapper.unmount()
    })
})
