import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HolidayManagementView from '@/views/HolidayManagementView.vue'
import { AggregateService } from '@/services/api/AggregateService'
import { SessionService } from '@/services/session/SessionService'
import { TeacherService } from '@/services/teacher/TeacherService'
import { HolidayQueryService } from '@/services/holiday/HolidayQueryService'
import { Holiday } from '@/models/Holiday'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({
    global: {
      locale: { value: 'en' },
      t: (key: string) => key
    }
  }),
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('vue-toastification', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('@/stores/usePreferencesStore', () => ({
  usePreferencesStore: () => ({
    timeZone: 'Asia/Taipei'
  })
}))

vi.mock('@/services/api/AggregateService', () => ({
  AggregateService: {
    getHolidaysAggregate: vi.fn(),
    getAllClassroomsOverview: vi.fn()
  }
}))

vi.mock('@/services/session/SessionService', () => ({
  SessionService: {
    getAllClassSessions: vi.fn()
  }
}))

vi.mock('@/services/teacher/TeacherService', () => ({
  TeacherService: {
    getAllTeachers: vi.fn()
  }
}))

vi.mock('@/services/holiday/HolidayQueryService', () => ({
  HolidayQueryService: {
    listHolidays: vi.fn()
  }
}))

vi.mock('@/services/holiday/HolidayCommandService', () => ({
  HolidayCommandService: {
    createHoliday: vi.fn(),
    updateHoliday: vi.fn(),
    deleteHoliday: vi.fn()
  }
}))

vi.mock('@/services/classroom/ClassroomService', () => ({
  ClassroomService: {
    getAllClassrooms: vi.fn()
  }
}))

const holidays = [
  {
    id: 'holiday-closure',
    start_date: '2026-07-01',
    end_date: '2026-07-01',
    time_zone: 'Asia/Taipei',
    name: 'Company Closure',
    kind: 'closure',
    classroom_ids: ['room-1'],
    class_session_ids: [],
    teacher_ids: []
  },
  {
    id: 'holiday-teacher-a',
    start_date: '2026-07-02',
    end_date: '2026-07-02',
    time_zone: 'Asia/Taipei',
    name: 'Teacher Family Leave',
    kind: 'teacher_leave',
    classroom_ids: [],
    class_session_ids: ['session-1'],
    teacher_ids: ['teacher-a']
  },
  {
    id: 'holiday-shared',
    start_date: '2026-07-03',
    end_date: '2026-07-03',
    time_zone: 'Asia/Taipei',
    name: 'Shared Training Leave',
    kind: 'teacher_leave',
    classroom_ids: [],
    class_session_ids: ['session-1'],
    teacher_ids: ['teacher-a', 'teacher-b']
  }
]

const rooms = [
  { id: 'room-1', name: 'Room A', color: '#10b981' }
]

const sessions = [
  {
    id: 'session-1',
    name: 'Python Class',
    classroom_id: 'room-1',
    day_of_week: 1,
    start_time: '10:00:00',
    end_time: '12:00:00',
    time_zone: 'Asia/Taipei'
  }
]

const teachers = [
  { id: 'teacher-a', name: 'Teacher A', email: 'a@example.com' },
  { id: 'teacher-b', name: 'Teacher B', email: 'b@example.com' }
]

const globalOptions = {
  mocks: {
    $t: (key: string) => key
  },
  stubs: {
    BasePageHeader: {
      template: '<div><slot name="icon" /><slot name="actions" /><slot /></div>'
    },
    ConfirmModal: true,
    SearchableSelect: {
      props: ['modelValue', 'options', 'multiple', 'placeholder'],
      emits: ['update:modelValue'],
      template: '<div data-test="searchable-select" :data-model="JSON.stringify(modelValue)">{{ placeholder }}</div>'
    }
  }
}

describe('HolidayManagementView tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(AggregateService.getHolidaysAggregate).mockResolvedValue(holidays)
    vi.mocked(HolidayQueryService.listHolidays).mockResolvedValue(holidays.map(holiday => new Holiday(holiday as any)))
    vi.mocked(AggregateService.getAllClassroomsOverview).mockResolvedValue({
      classrooms: rooms,
      count: rooms.length
    })
    vi.mocked(SessionService.getAllClassSessions).mockResolvedValue({
      data: sessions,
      count: sessions.length
    } as any)
    vi.mocked(TeacherService.getAllTeachers).mockResolvedValue(teachers as any)
  })

  it('shows closure records separately from teacher leave records', async () => {
    const wrapper = mount(HolidayManagementView, {
      global: globalOptions
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Company Closure')
    expect(wrapper.text()).not.toContain('Teacher Family Leave')

    await wrapper.findAll('button').find(button => button.text().includes('holiday.tab_teacher_leaves'))?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Teacher Family Leave')
    expect(wrapper.text()).toContain('Shared Training Leave')
    expect(wrapper.text()).not.toContain('Company Closure')
  })

  it('groups teacher leave records by teacher and marks shared leave', async () => {
    const wrapper = mount(HolidayManagementView, {
      global: globalOptions
    })
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text().includes('holiday.tab_teacher_leaves'))?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Teacher A')
    expect(wrapper.text()).toContain('Teacher B')
    expect(wrapper.text()).toContain('holiday.shared_leave')

    await wrapper.findAll('button').find(button => button.text().includes('Teacher B'))?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Shared Training Leave')
    expect(wrapper.text()).not.toContain('Teacher Family Leave')
  })

  it('preselects the active teacher when adding a teacher leave', async () => {
    const wrapper = mount(HolidayManagementView, {
      global: globalOptions
    })
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text().includes('holiday.tab_teacher_leaves'))?.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('Teacher B'))?.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('holiday.add_teacher_leave'))?.trigger('click')
    await flushPromises()

    const teacherSelect = wrapper.findAll('[data-test="searchable-select"]')
      .find(select => select.attributes('data-model')?.includes('teacher-b'))

    expect(teacherSelect?.exists()).toBe(true)
  })

  it('falls back to direct holiday rows when aggregate output omits teacher leave fields', async () => {
    vi.mocked(AggregateService.getHolidaysAggregate).mockResolvedValue(holidays.map(({ kind, teacher_ids, ...holiday }) => holiday))

    const wrapper = mount(HolidayManagementView, {
      global: globalOptions
    })
    await flushPromises()

    expect(HolidayQueryService.listHolidays).toHaveBeenCalled()

    await wrapper.findAll('button').find(button => button.text().includes('holiday.tab_teacher_leaves'))?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Teacher Family Leave')
    expect(wrapper.text()).toContain('Shared Training Leave')
  })
})
