import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ReportReferencePanel from './ReportReferencePanel.vue'

const services = vi.hoisted(() => ({
    getCourseOptions: vi.fn().mockResolvedValue({ data: [] }),
    getAllClassroomsOverview: vi.fn().mockResolvedValue({ classrooms: [] }),
    getAllClassrooms: vi.fn().mockResolvedValue({ data: [] }),
    getAllClassSessionOptions: vi.fn().mockResolvedValue({ data: [] }),
    getReportsByStudent: vi.fn(),
    getReportsByLesson: vi.fn(),
    getLinkedLessonReportHistory: vi.fn(),
    getReportById: vi.fn(),
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
        getReportsByStudent: services.getReportsByStudent,
        getReportsByLesson: services.getReportsByLesson,
        getLinkedLessonReportHistory: services.getLinkedLessonReportHistory,
        getReportById: services.getReportById,
    },
}))

describe('ReportReferencePanel linked lesson history', () => {
    it('shows only the safe linked projection when its parent report is also in student history', async () => {
        services.getReportsByStudent.mockResolvedValue({
            count: 1,
            data: [{
                id: 'shared-report', content: 'Private report body', contact_notes: 'Private contact note', class_notes: 'Private class note',
                class_occurrences: { occurrence_date: '2026-11-11' },
            }],
        })
        services.getLinkedLessonReportHistory.mockResolvedValue({
            count: 1,
            data: [{
                id: 'shared-report', class_occurrence_id: 'occurrence-a', lesson_id: 'lesson-b', course_id: 'course-b',
                course_name: 'Course B', lesson_sequence: 2, lesson_title: 'Lesson B2', progress_letter: 'C-D', is_completed: false,
                attendance_status: 'present', content: 'Shared comment for course B', content_document: null,
                occurrence_date: '2026-11-11', contact_notes: 'Must remain hidden', class_notes: 'Must remain hidden too',
            }],
        })

        const wrapper = mount(ReportReferencePanel, {
            props: { show: false, studentId: 'student-b', enrollmentId: 'enrollment-b' },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    Teleport: true,
                    BaseDropdown: true,
                    RichTextViewer: { props: ['content'], template: '<div class="rich-text">{{ content }}</div>' },
                },
            },
        })
        await flushPromises()
        await wrapper.setProps({ show: true })
        await flushPromises()

        expect(services.getLinkedLessonReportHistory).toHaveBeenCalledWith('enrollment-b', expect.objectContaining({
            limit: 10, offset: 0, sort: '-occurrence_date',
        }))
        expect(wrapper.text()).toContain('Course B #2 Lesson B2')
        expect(wrapper.text()).toContain('Shared comment for course B')
        expect(wrapper.text()).not.toContain('Private report body')
        expect(wrapper.text()).not.toContain('Private contact note')
        expect(wrapper.text()).not.toContain('Private class note')
        expect(wrapper.text()).not.toContain('Must remain hidden')
        expect(wrapper.find('a').exists()).toBe(false)
    })

    it('passes the search into the linked-history query', async () => {
        services.getReportsByStudent.mockResolvedValue({ count: 0, data: [] })
        services.getLinkedLessonReportHistory.mockResolvedValue({ count: 0, data: [] })
        const wrapper = mount(ReportReferencePanel, {
            props: { show: true, studentId: 'student-b', enrollmentId: 'enrollment-b' },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: { Teleport: true, BaseDropdown: true, RichTextViewer: true },
            },
        })
        await flushPromises()
        await wrapper.get('input[type="text"]').setValue('  make up  ')
        await wrapper.get('input[type="text"]').trigger('keyup.enter')
        await flushPromises()

        expect(services.getLinkedLessonReportHistory).toHaveBeenLastCalledWith('enrollment-b', expect.objectContaining({ search: 'make up' }))
    })
})
