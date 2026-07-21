import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EnrollStudentModal from './EnrollStudentModal.vue'
import { AggregateService } from '@/services/AggregateService'
import { SessionService } from '@/services/session/SessionService'
import { ClassroomService } from '@/services/classroom/ClassroomService'

vi.mock('vue-i18n', () => ({
    createI18n: () => ({
        global: {
            locale: { value: 'zh-TW' },
            t: (key: string) => key
        }
    }),
    useI18n: () => ({ t: (key: string) => key })
}))

vi.mock('vue-toastification', () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn() })
}))

vi.mock('@/stores/usePreferencesStore', () => ({
    usePreferencesStore: () => ({ timeZone: 'Asia/Taipei', locale: 'zh-TW' })
}))

vi.mock('@/composables/useCapacityCheck', () => ({
    useCapacityCheck: () => ({
        maxEnrollment: ref(0),
        capacity: ref(10),
        isChecking: ref(false),
        isFull: ref(false)
    })
}))

vi.mock('@/services/AggregateService', () => ({
    AggregateService: { getCoursesCached: vi.fn() }
}))

vi.mock('@/services/session/SessionService', () => ({
    SessionService: { getClassSessions: vi.fn() }
}))

vi.mock('@/services/classroom/ClassroomService', () => ({
    ClassroomService: { getClassrooms: vi.fn() }
}))

const SearchableSelectStub = defineComponent({
    name: 'SearchableSelect',
    props: ['modelValue', 'options', 'disabled', 'placeholder'],
    emits: ['update:modelValue'],
    template: '<div data-test="searchable-select" />'
})

const sessions = [
    { id: 'session-a', name: 'A1', classroom_id: 'room-1', course_ids: ['course-a'], schedule_rules: [] },
    { id: 'session-b', name: 'B1', classroom_id: 'room-1', course_ids: ['course-b'], schedule_rules: [] },
    { id: 'session-c', name: 'A2', classroom_id: 'room-2', course_ids: ['course-a'], schedule_rules: [] }
]

describe('EnrollStudentModal cascading selections', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(AggregateService.getCoursesCached).mockResolvedValue({ data: [
            { id: 'course-a', displayName: 'Course A', lessons: [] },
            { id: 'course-b', displayName: 'Course B', lessons: [] }
        ] } as any)
        vi.mocked(SessionService.getClassSessions).mockResolvedValue({ data: sessions, count: sessions.length } as any)
        vi.mocked(ClassroomService.getClassrooms).mockResolvedValue({ data: [
            { id: 'room-1', name: 'Room 1' },
            { id: 'room-2', name: 'Room 2' },
            { id: 'room-3', name: 'Room 3' }
        ], count: 3 } as any)
    })

    it('requires a course, filters sessions, and fills the classroom from the selected session', async () => {
        const wrapper = mount(EnrollStudentModal, {
            props: { isOpen: false, studentId: 'student-1' },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    SearchableSelect: SearchableSelectStub,
                    TimeZoneSelect: true,
                    BaseDropdown: true,
                    CapacityProgressBar: true
                }
            }
        })

        await wrapper.setProps({ isOpen: true })
        await flushPromises()

        let selects = wrapper.findAllComponents(SearchableSelectStub)
        expect(selects[1].props('disabled')).toBe(true)
        expect(selects[2].props('disabled')).toBe(true)

        selects[0].vm.$emit('update:modelValue', 'course-a')
        await flushPromises()
        selects = wrapper.findAllComponents(SearchableSelectStub)

        expect(selects[1].props('options').map((option: any) => option.value)).toEqual(['room-1', 'room-2'])
        expect(selects[2].props('options').map((option: any) => option.value)).toEqual(['session-a', 'session-c'])

        selects[2].vm.$emit('update:modelValue', 'session-c')
        await flushPromises()
        selects = wrapper.findAllComponents(SearchableSelectStub)
        expect(selects[1].props('modelValue')).toBe('room-2')

        selects[0].vm.$emit('update:modelValue', 'course-b')
        await flushPromises()
        selects = wrapper.findAllComponents(SearchableSelectStub)
        expect(selects[1].props('modelValue')).toBe('')
        expect(selects[2].props('modelValue')).toBe('')
        expect(selects[2].props('options').map((option: any) => option.value)).toEqual(['session-b'])
    })
})
