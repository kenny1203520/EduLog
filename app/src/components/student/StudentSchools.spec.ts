import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentSchools from './StudentSchools.vue'

const mocks = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), load: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('vue-i18n', async importOriginal => ({ ...await importOriginal<typeof import('vue-i18n')>(), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-toastification', () => ({ useToast: () => ({ error: mocks.error, success: mocks.success }) }))
vi.mock('@/services/student/StudentService', () => ({ StudentService: { addSchool: mocks.add, updateSchool: mocks.update } }))
vi.mock('@/stores/useStudentStore', () => ({ useStudentStore: () => ({ loadStudent: mocks.load }) }))
vi.mock('@/stores/usePreferencesStore', () => ({ usePreferencesStore: () => ({ timeZone: 'Asia/Taipei', locale: 'zh-TW' }) }))

const school = {
    id: 'school-1', student_id: 'student-1', name: '國中', status: 'enrolled', grade: '九年級', class: '',
    start_date: '2025-09-01', end_date: '2026-06-30', time_zone: 'Asia/Taipei', school_student_id: '',
    created_at: '2026-02-02T23:06:49Z', updated_at: '2026-09-24T09:21:54Z'
}
const mountForm = (schools = [school]) => shallowMount(StudentSchools, {
    props: { studentId: 'student-1', schools }, global: { mocks: { $t: (key: string) => key } }
})
const button = (wrapper: ReturnType<typeof mountForm>, text: string) => wrapper.findAll('button').find(b => b.text().includes(text))!

beforeEach(() => { vi.clearAllMocks() })

describe('StudentSchools forms', () => {
    it('edits only form fields and lets an enrolled student clear the end date', async () => {
        const wrapper = mountForm()
        await wrapper.get('button[title="common.edit"]').trigger('click')
        await wrapper.findAll('input[type="date"]')[1]!.setValue('')
        await button(wrapper, 'student.save_details').trigger('click')
        await flushPromises()
        expect(mocks.update).toHaveBeenCalledWith('school-1', {
            name: school.name, status: school.status, grade: school.grade, class: '',
            start_date: school.start_date, end_date: '', time_zone: school.time_zone, school_student_id: ''
        })
        expect(mocks.load).toHaveBeenCalledWith('student-1')
    })

    it('adds an enrolled school with no end date and refreshes the student', async () => {
        const wrapper = mountForm([])
        await wrapper.get('[data-testid="student-school-add-toggle"]').trigger('click')
        const inputs = wrapper.findAll('input:not([type="date"])')
        await inputs[0]!.setValue('高中')
        await wrapper.getComponent({ name: 'BaseDropdown' }).vm.$emit('update:modelValue', 'enrolled')
        await inputs[2]!.setValue('高一')
        await wrapper.findAll('input[type="date"]')[0]!.setValue('2026-09-01')
        await button(wrapper, 'student.schools.add_btn').trigger('click')
        await flushPromises()
        expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ name: '高中', grade: '高一', end_date: '', student_id: 'student-1' }))
        expect(mocks.load).toHaveBeenCalledWith('student-1')
    })

    it.each(['enrolled', 'graduated', 'incomplete', 'suspended'])('preserves required fields for %s', async status => {
        const wrapper = mountForm([{ ...school, status, grade: '', end_date: '' }])
        await wrapper.get('button[title="common.edit"]').trigger('click')
        await button(wrapper, 'student.save_details').trigger('click')
        expect(mocks.update).not.toHaveBeenCalled()
        expect(mocks.error).toHaveBeenCalled()
    })
})
