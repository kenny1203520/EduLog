import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClassroomManagementView from '@/views/ClassroomManagementView.vue'
import { AggregateService } from '@/services/api/AggregateService'

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
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  })
}))

vi.mock('@/composables/useFeedback', () => ({
  useFeedback: () => ({
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    errorKey: vi.fn(),
    reportError: vi.fn()
  })
}))

vi.mock('@/stores/usePreferencesStore', () => ({
  usePreferencesStore: () => ({
    timeZone: 'Asia/Taipei',
    locale: 'en'
  })
}))

vi.mock('@/services/api/AggregateService', () => ({
  AggregateService: {
    getClassroomSessionManagerAggregate: vi.fn(),
    getClassSessionsOverview: vi.fn(),
    getAllClassroomsOverview: vi.fn(),
    getAllClassSessionsOverview: vi.fn(),
    getAllTeachersOverview: vi.fn()
  }
}))

vi.mock('@/services/course/CourseCatalogService', () => ({ CourseCatalogService: { getCourses: vi.fn() } }))
vi.mock('@/services/classroom/ClassroomService', () => ({ ClassroomService: { getAllClassrooms: vi.fn() } }))
vi.mock('@/services/session/SessionService', () => ({ SessionService: {} }))
vi.mock('@/services/preference/VisibilityPreferenceService', () => ({ VisibilityPreferenceService: {} }))
vi.mock('@/services/occurrence/OccurrenceSyncService', () => ({ OccurrenceSyncService: {} }))
vi.mock('@/services/teacher/TeacherService', () => ({ TeacherService: {} }))
vi.mock('@/services/rbac/RoleService', () => ({ RoleService: {} }))
vi.mock('@/services/rbac/PermissionPolicyService', () => ({
  INCOMPLETE_REPORT_PERMISSION: 'reports.incomplete.receive',
  PermissionPolicyService: {}
}))
vi.mock('@/components/settings/ScopedRolePolicyEditor.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/settings/DashboardScheduleModeEditor.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/classroom/ClassroomManagementPanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/rbac/EffectiveTeachingRoles.vue', () => ({ default: { template: '<div />' } }))

const globalOptions = {
  mocks: {
    $t: (key: string) => key
  },
  stubs: {
    BasePageHeader: {
      template: '<div><slot name="icon" /><slot name="actions" /><slot /></div>'
    },
    ConfirmModal: true,
    Pagination: true,
    SearchableSelect: true,
    BaseDropdown: true,
    RouterLink: { template: '<a><slot /></a>' }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function roomsAggregate(names: string[]) {
  return {
    classrooms: names.map((name, index) => ({ id: `room-${index}-${name}`, name, color: '#10b981' })),
    count: names.length,
    hiddenClassroomIds: [],
    hiddenSessionIds: [],
    // A hidden session makes the old "all sessions hidden" hint eligible, so
    // the sessions-tab assertions prove the hint waits for its own response.
    hiddenSessionCount: 1
  }
}

function clickButton(wrapper: VueWrapper, label: string) {
  return wrapper.findAll('button').find(button => button.text() === label)!.trigger('click')
}

describe('ClassroomManagementView loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(AggregateService.getAllClassroomsOverview).mockResolvedValue({ classrooms: [], count: 0 } as any)
  })

  it('shows the sessions skeleton, not the empty state, until sessions arrive', async () => {
    vi.mocked(AggregateService.getClassroomSessionManagerAggregate).mockResolvedValue(roomsAggregate(['Room A']) as any)
    const sessions = deferred<any>()
    vi.mocked(AggregateService.getClassSessionsOverview).mockReturnValue(sessions.promise)

    const wrapper = mount(ClassroomManagementView, { global: globalOptions })
    await flushPromises()
    expect(wrapper.text()).toContain('Room A')

    await clickButton(wrapper, 'classroom.sessions_tab')
    await flushPromises()

    expect(wrapper.find('[data-test="sessions-skeleton"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="sessions-empty"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('classroom.all_sessions_hidden')

    sessions.resolve({ data: [], count: 0, hiddenSessionIds: [], hiddenSessionCount: 1 })
    await flushPromises()

    expect(wrapper.find('[data-test="sessions-skeleton"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="sessions-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('classroom.all_sessions_hidden')
  })

  it('shows the rooms skeleton on first load and the empty state for an empty result', async () => {
    const rooms = deferred<any>()
    vi.mocked(AggregateService.getClassroomSessionManagerAggregate).mockReturnValue(rooms.promise)

    const wrapper = mount(ClassroomManagementView, { global: globalOptions })
    await flushPromises()

    expect(wrapper.find('[data-test="rooms-skeleton"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="rooms-empty"]').exists()).toBe(false)

    rooms.resolve(roomsAggregate([]))
    await flushPromises()

    expect(wrapper.find('[data-test="rooms-skeleton"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="rooms-empty"]').exists()).toBe(true)
  })

  it('ignores a stale rooms response that resolves after a newer one', async () => {
    const first = deferred<any>()
    const second = deferred<any>()
    vi.mocked(AggregateService.getClassroomSessionManagerAggregate)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const wrapper = mount(ClassroomManagementView, { global: globalOptions })
    await flushPromises()

    await clickButton(wrapper, 'classroom.show_all')
    await flushPromises()

    second.resolve(roomsAggregate(['Newer Room']))
    await flushPromises()
    first.resolve(roomsAggregate(['Stale Room']))
    await flushPromises()

    expect(wrapper.text()).toContain('Newer Room')
    expect(wrapper.text()).not.toContain('Stale Room')
    expect(wrapper.find('[data-test="rooms-skeleton"]').exists()).toBe(false)
  })
})
