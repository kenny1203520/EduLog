import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActivateTrialModal from './ActivateTrialModal.vue'
import { EnrollmentQueryService } from '@/services/enrollment/EnrollmentQueryService'
import { EnrollmentCommandService } from '@/services/enrollment/EnrollmentCommandService'
import { ReportQueryService } from '@/services/report/ReportQueryService'

vi.mock('vue-i18n', () => ({
    createI18n: () => ({ global: { locale: { value: 'zh-TW' }, t: (key: string) => key } }),
    useI18n: () => ({ t: (key: string) => key })
}))
vi.mock('vue-toastification', () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn() })
}))
vi.mock('@/stores/usePreferencesStore', () => ({
    usePreferencesStore: () => ({ timeZone: 'Asia/Taipei', locale: 'zh-TW' })
}))
vi.mock('@/composables/useFeedback', () => ({
    useFeedback: () => ({ errorKey: vi.fn(), reportError: vi.fn() })
}))
vi.mock('@/services/session/SessionService', () => ({
    SessionService: { getAllClassSessions: vi.fn(async () => ({ data: [{ id: 'session-a', classroom_id: 'room-a', course_ids: ['course-a'], name: 'A' }] })) }
}))
vi.mock('@/services/classroom/ClassroomService', () => ({
    ClassroomService: { getAllClassrooms: vi.fn(async () => ({ data: [{ id: 'room-a', name: 'Room A' }] })) }
}))
vi.mock('@/models/SessionEligibilityPolicy', () => ({
    SessionEligibilityPolicy: { filter: (sessions: unknown[]) => sessions, classroomIds: () => new Set(['room-a']) }
}))
vi.mock('@/utils/sessionSchedule', () => ({ formatClassSessionOption: () => 'A' }))
vi.mock('@/services/enrollment/EnrollmentQueryService', () => ({
    EnrollmentQueryService: { getByStudentId: vi.fn() }
}))
vi.mock('@/services/enrollment/EnrollmentCommandService', () => ({
    EnrollmentCommandService: { update: vi.fn(async () => ({})) }
}))
vi.mock('@/services/report/ReportQueryService', () => ({
    ReportQueryService: { getAllReportsByEnrollment: vi.fn() }
}))

const stubs = { SearchableSelect: true, TimeZoneSelect: true }
const mocks = { $t: (key: string, values?: Record<string, unknown>) => `${key}${values ? ` ${JSON.stringify(values)}` : ''}` }

async function openModal(lessonCount: number, attendance: string[]) {
    vi.mocked(EnrollmentQueryService.getByStudentId).mockResolvedValue([
        { id: 'enrollment-a', courseId: 'course-a', classroomId: 'room-a', classSessionId: 'session-a', lessonCount },
    ] as never)
    vi.mocked(ReportQueryService.getAllReportsByEnrollment).mockResolvedValue(
        attendance.map(attendanceStatus => ({ attendanceStatus })) as never
    )
    const wrapper = mount(ActivateTrialModal, {
        props: { isOpen: false, studentId: 'student-a', fromEnrollmentId: 'enrollment-a' },
        global: { stubs, mocks },
    })
    await wrapper.setProps({ isOpen: true })
    await flushPromises()
    return wrapper
}

describe('ActivateTrialModal', () => {
    beforeEach(() => vi.clearAllMocks())

    it('defaults the regular lessons to the course length minus the attended trial lessons', async () => {
        const wrapper = await openModal(12, ['absent', 'present'])
        const input = wrapper.get('input[type="number"]')
        expect((input.element as HTMLInputElement).value).toBe('11')
        expect(wrapper.get(`#${input.attributes('aria-describedby')}`).text()).toContain('"total":12,"attended":1,"count":11')
    })

    it('keeps at least one regular lesson and sends the regular lesson count', async () => {
        const wrapper = await openModal(1, ['present', 'present'])
        expect((wrapper.get('input[type="number"]').element as HTMLInputElement).value).toBe('1')
        await wrapper.get('input[type="number"]').setValue(5)
        await wrapper.findAll('button').at(-1)!.trigger('click')
        await flushPromises()
        expect(EnrollmentCommandService.update).toHaveBeenCalledWith(
            'enrollment-a',
            expect.objectContaining({ status: 'regular', class_session_id: 'session-a' }),
            { targetRegularReports: 5 }
        )
    })

    it('falls back to the course length when the reports cannot be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const wrapper = await openModal(8, [])
        vi.mocked(ReportQueryService.getAllReportsByEnrollment).mockRejectedValue(new Error('offline'))
        await wrapper.setProps({ isOpen: false })
        await wrapper.setProps({ isOpen: true })
        await flushPromises()
        expect((wrapper.get('input[type="number"]').element as HTMLInputElement).value).toBe('8')
    })
})
