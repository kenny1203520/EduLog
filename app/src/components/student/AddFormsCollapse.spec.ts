import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import StudentContacts from './StudentContacts.vue'
import StudentSchools from './StudentSchools.vue'
import StudentCredentials from './StudentCredentials.vue'
import TeacherManagementView from '@/views/TeacherManagementView.vue'
import { StudentService } from '@/services/student/StudentService'
import { TeacherService } from '@/services/teacher/TeacherService'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({
    global: {
      locale: { value: 'en' }
    }
  }),
  useI18n: () => ({
    t: (key: string) => key,
    locale: { value: 'en' }
  })
}))

vi.mock('vue-toastification', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('@/composables/useEmailValidation', () => ({
  useEmailValidation: () => ({
    validateEmail: vi.fn(() => true),
    getEmailError: vi.fn(() => null)
  })
}))

vi.mock('@/stores/useStudentStore', () => ({
  useStudentStore: () => ({
    loadStudent: vi.fn(() => Promise.resolve())
  })
}))

vi.mock('@/stores/usePreferencesStore', () => ({
  usePreferencesStore: () => ({
    timeZone: 'Asia/Taipei',
    locale: 'en'
  })
}))

vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true))
}))

vi.mock('@/services/student/StudentService', () => ({
  StudentService: {
    addContact: vi.fn(),
    addSchool: vi.fn(),
    addCredential: vi.fn(),
    updateContact: vi.fn(),
    updateSchool: vi.fn(),
    updateCredential: vi.fn(),
    deleteContact: vi.fn(),
    deleteSchool: vi.fn(),
    deleteCredential: vi.fn()
  }
}))

vi.mock('@/services/teacher/TeacherService', () => ({
  TeacherService: {
    getAllTeachersWithCredentials: vi.fn(),
    getTeacherById: vi.fn(() => Promise.resolve({ id: 'teacher-1', name: 'Kenny', email: 'kenny@example.com', teacher_credentials: [] })),
    getTeacherStatistics: vi.fn(() => ({
      total: 1,
      linkedAccounts: 0,
      unlinkedAccounts: 1,
      completeProfiles: 1
    })),
    createTeacher: vi.fn(),
    updateTeacher: vi.fn(),
    deleteTeacher: vi.fn(),
    bulkDeleteTeachers: vi.fn(),
    addCredential: vi.fn(),
    updateCredential: vi.fn(),
    deleteCredential: vi.fn()
  }
}))

vi.mock('@/services/auth/AuthUserSearchService', () => ({
  AuthUserSearchService: {
    searchUsersByEmail: vi.fn(() => Promise.resolve([]))
  }
}))

vi.mock('@/services/api/PageApiService', () => ({
  PageApiService: {
    getTeachersOverview: vi.fn(() => Promise.resolve({ data: { teachers: [{ id: 'teacher-1', name: 'Kenny', email: 'kenny@example.com', teacher_credentials: [] }], statistics: { totalTeachers: 1, linkedAccounts: 0, unlinkedAccounts: 1, completeProfiles: 1, teachersWithBirthday: 0, teachersWithGovId: 0 } }, meta: { total: 1 } }))
  }
}))

const globalOptions = {
  mocks: {
    $t: (key: string) => key
  },
  stubs: {
    BaseDropdown: {
      props: ['modelValue', 'options', 'placeholder'],
      emits: ['update:modelValue'],
      template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="">{{ placeholder }}</option><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>'
    },
    TimeZoneSelect: {
      props: ['modelValue', 'label'],
      emits: ['update:modelValue'],
      template: '<label><span>{{ label }}</span><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></label>'
    },
    ConfirmModal: true,
    Pagination: true,
    BasePageHeader: {
      template: '<div><slot name="icon" /><slot name="actions" /><slot /></div>'
    }
  }
}

describe('collapsed add forms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(StudentService.addContact).mockResolvedValue({} as any)
    vi.mocked(StudentService.addSchool).mockResolvedValue({} as any)
    vi.mocked(StudentService.addCredential).mockResolvedValue({} as any)
    vi.mocked(TeacherService.getAllTeachersWithCredentials).mockResolvedValue([
      {
        id: 'teacher-1',
        name: 'Kenny',
        email: 'kenny@example.com',
        teacher_credentials: []
      }
    ] as any)
  })

  it('keeps student contact add form collapsed by default, opens it, and collapses after add', async () => {
    const wrapper = mount(StudentContacts, {
      props: { studentId: 'student-1', contacts: [] },
      global: globalOptions
    })

    expect(wrapper.find('[data-testid="student-contact-add-form"]').exists()).toBe(false)

    await wrapper.get('[data-testid="student-contact-add-toggle"]').trigger('click')
    const form = wrapper.get('[data-testid="student-contact-add-form"]')
    await form.find('input').setValue('Parent One')
    await form.findAll('button').find(button => button.text() === 'student.contacts.add_btn')!.trigger('click')
    await flushPromises()

    expect(StudentService.addContact).toHaveBeenCalledWith(expect.objectContaining({
      student_id: 'student-1',
      name: 'Parent One'
    }))
    expect(wrapper.find('[data-testid="student-contact-add-form"]').exists()).toBe(false)
  })

  it('keeps student school add form collapsed by default and opens it on demand', async () => {
    const wrapper = mount(StudentSchools, {
      props: { studentId: 'student-1', schools: [] },
      global: globalOptions
    })

    expect(wrapper.find('[data-testid="student-school-add-form"]').exists()).toBe(false)

    await wrapper.get('[data-testid="student-school-add-toggle"]').trigger('click')

    expect(wrapper.find('[data-testid="student-school-add-form"]').exists()).toBe(true)
  })

  it('keeps student credential add form collapsed by default and opens it on demand', async () => {
    const wrapper = mount(StudentCredentials, {
      props: { studentId: 'student-1', credentials: [] },
      global: globalOptions
    })

    expect(wrapper.find('[data-testid="student-credential-add-form"]').exists()).toBe(false)

    await wrapper.get('[data-testid="student-credential-add-toggle"]').trigger('click')

    expect(wrapper.find('[data-testid="student-credential-add-form"]').exists()).toBe(true)
  })

  it('keeps teacher credential add form collapsed in edit modal and opens it on demand', async () => {
    const wrapper = mount(TeacherManagementView, {
      global: globalOptions
    })
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text() === 'common.edit')!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="teacher-credential-add-form"]').exists()).toBe(false)

    await wrapper.get('[data-testid="teacher-credential-add-toggle"]').trigger('click')

    expect(wrapper.find('[data-testid="teacher-credential-add-form"]').exists()).toBe(true)
  })
})
