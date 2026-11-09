import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
const router = vi.hoisted(() => ({ replace: vi.fn(async ({ query }: { query: Record<string, string> }) => { route.query = query }) }))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router, RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('vue-i18n', async (importOriginal) => ({
    ...(await importOriginal<typeof import('vue-i18n')>()),
    useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }),
}))
const feedback = vi.hoisted(() => ({ errorKey: vi.fn(), reportError: vi.fn(), success: vi.fn() }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => feedback }))
const grants = vi.hoisted(() => ({ value: new Set<string>() }))
vi.mock('@/stores/useCapabilityStore', () => ({
    useCapabilityStore: () => ({ ensureLoaded: vi.fn(), can: (key: string) => grants.value.has(key), canPlatform: (key: string) => grants.value.has(key) }),
}))
const directory = vi.hoisted(() => ({ getPage: vi.fn(), getAssignments: vi.fn(), setArchived: vi.fn() }))
vi.mock('@/services/teacher/TeacherDirectoryService', () => ({ TeacherDirectoryService: directory }))
vi.mock('@/services/teacher/TeacherService', () => ({ TeacherService: { deleteTeacher: vi.fn(), bulkDeleteTeachers: vi.fn() } }))

import TeacherManagementView from './TeacherManagementView.vue'

const teachers = [
    { id: 't1', user_id: 'u1', name: 'Alice', email: 'alice@example.test', phone: null, class_count: 2, archived_at: null },
    { id: 't2', user_id: null, name: 'Bob', email: null, phone: null, class_count: 0, archived_at: null },
]
const statistics = { totalTeachers: 2, linkedAccounts: 1, unlinkedAccounts: 1, unassignedTeachers: 1, archivedTeachers: 0 }
const stubs = { BasePageHeader: { template: '<div><slot name="actions" /></div>' }, Pagination: true, TeacherFormDialog: true, TeacherAccountLinkDialog: true, TeacherAssignmentsSection: true, RichTextViewer: true, ConfirmModal: { props: ['isOpen', 'message'], emits: ['confirm'], template: '<div v-if="isOpen" data-testid="confirm"><p>{{ message }}</p><button data-testid="confirm-yes" @click="$emit(\'confirm\')">ok</button></div>' } }

function mountView() {
    return mount(TeacherManagementView, { global: { stubs } })
}

describe('TeacherManagementView', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        route.query = {}
        grants.value = new Set(['teaching.teachers.create', 'teaching.teachers.update', 'teaching.teachers.delete', 'teaching.teachers.read_sensitive'])
        directory.getPage.mockResolvedValue({ items: teachers, statistics, total: 2 })
        directory.getAssignments.mockResolvedValue([])
    })

    it('lists teachers including those without classes and loads the active status by default', async () => {
        const wrapper = mountView()
        await flushPromises()
        expect(directory.getPage).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', sort: 'name', page: 1 }))
        expect(wrapper.text()).toContain('Alice')
        expect(wrapper.text()).toContain('Bob')
        expect(wrapper.text()).toContain('teacher.directory.no_classes')
    })

    it('opens the detail pane for a selected teacher and remembers it in the URL', async () => {
        const wrapper = mountView()
        await flushPromises()
        await wrapper.findAll('button').find(button => button.text().includes('Alice'))!.trigger('click')
        await flushPromises()
        expect(router.replace).toHaveBeenCalledWith({ query: { teacher: 't1' } })
        expect(wrapper.find('#teacher-detail-name').text()).toBe('Alice')
        expect(wrapper.text()).toContain('alice@example.test')
    })

    it('archives a teacher and explains when current classes block it', async () => {
        route.query = { teacher: 't1' }
        directory.setArchived.mockRejectedValueOnce(Object.assign(new Error('blocked'), { code: 'TEACHER_HAS_ACTIVE_ASSIGNMENTS' }))
        const wrapper = mountView()
        await flushPromises()
        await wrapper.findAll('button').find(button => button.text() === 'teacher.directory.archive')!.trigger('click')
        await wrapper.get('[data-testid="confirm-yes"]').trigger('click')
        await flushPromises()
        expect(directory.setArchived).toHaveBeenCalledWith('t1', true)
        expect(feedback.errorKey).toHaveBeenCalledWith('teacher.directory.archive_blocked', { name: 'Alice' })
    })

    it('hides management actions from a read-only class teacher', async () => {
        grants.value = new Set()
        route.query = { teacher: 't1' }
        const wrapper = mountView()
        await flushPromises()
        const labels = wrapper.findAll('button').map(button => button.text())
        expect(labels).not.toContain('teacher.add_teacher')
        expect(labels).not.toContain('teacher.directory.edit')
        expect(labels).not.toContain('teacher.directory.archive')
        expect(labels).not.toContain('teacher.directory.delete_permanent')
        expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    })
})
