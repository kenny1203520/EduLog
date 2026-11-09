import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import i18n from '@/i18n'

const service = vi.hoisted(() => ({
    oauthProviders: vi.fn(),
    requestPasswordReset: vi.fn(),
    setPassword: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getSession: vi.fn(),
}))
vi.mock('@/services/auth/AuthService', () => ({ authService: service }))
vi.mock('/pwa-192x192.png', () => ({ default: '/pwa-192x192.png' }))

const approvals = vi.hoisted(() => ({
    pending: vi.fn(), pendingCount: vi.fn(), approve: vi.fn(), invite: vi.fn(), defaultRoles: vi.fn(), saveDefaultRoles: vi.fn(),
}))
vi.mock('@/services/auth/AccountApprovalService', () => ({ AccountApprovalService: approvals }))
vi.mock('@/services/rbac/RoleService', () => ({ RoleService: { getCapabilities: vi.fn().mockResolvedValue({ epoch: 3 }) } }))
const updateStatus = vi.hoisted(() => vi.fn())
vi.mock('@/services/auth/UserAccountService', () => ({ UserAccountService: { updateStatus } }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => ({ success: vi.fn(), reportError: vi.fn(), errorKey: vi.fn() }) }))

import LoginView from './LoginView.vue'
import AccountApprovalPanel from '@/components/settings/AccountApprovalPanel.vue'
import { useAuthStore } from '@/stores/useAuthStore'

function testRouter(path = '/login') {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/login', name: 'login', component: LoginView },
            { path: '/forgot-password', name: 'forgot-password', component: { template: '<div />' } },
            { path: '/dashboard', name: 'dashboard', component: { template: '<div />' } },
        ],
    })
    void router.push(path)
    return router
}

beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    i18n.global.locale.value = 'zh-TW'
})

describe('LoginView sign-in options', () => {
    it('offers each provider GoTrue enabled as a link to the API, plus password reset', async () => {
        service.oauthProviders.mockResolvedValue(['github', 'google'])
        const router = testRouter()
        await router.isReady()
        const wrapper = mount(LoginView, { global: { plugins: [i18n, router] } })
        await flushPromises()

        const links = wrapper.findAll('[data-testid="oauth-providers"] a')
        expect(links.map((link) => link.attributes('href'))).toEqual(['/api/auth/oauth/github', '/api/auth/oauth/google'])
        expect(links[0].text()).toContain('使用 GitHub 登入')
        expect(wrapper.find('a[href="/forgot-password"]').exists()).toBe(true)
    })

    it('shows no provider section when none is enabled, and explains a failed OAuth return', async () => {
        service.oauthProviders.mockResolvedValue([])
        const router = testRouter('/login?error=oauth')
        await router.isReady()
        const wrapper = mount(LoginView, { global: { plugins: [i18n, router] } })
        await flushPromises()
        expect(wrapper.find('[data-testid="oauth-providers"]').exists()).toBe(false)
        expect(wrapper.text()).toContain('第三方登入未完成')
    })
})

describe('AccountApprovalPanel', () => {
    const TEACHER = { id: 'role-teacher', code: 'teacher', name: 'Teacher', domain: 'teaching' as const }
    const VIEWER = { id: 'role-viewer', code: 'viewer', name: 'Viewer', domain: 'teaching' as const }

    beforeEach(() => {
        approvals.pending.mockResolvedValue({ accounts: [{ id: 'u1', email: 'new@example.test', provider: 'github', display_name: null, created_at: '2026-11-09T00:00:00Z' }], default_role_ids: [TEACHER.id] })
        approvals.defaultRoles.mockResolvedValue({ role_ids: [TEACHER.id], roles: [TEACHER, VIEWER] })
        approvals.approve.mockResolvedValue(undefined)
    })

    it('approves with the default roles preselected and any extra role chosen', async () => {
        const wrapper = mount(AccountApprovalPanel, { global: { plugins: [i18n] } })
        await flushPromises()
        const account = wrapper.find('[data-testid="pending-account"]')
        expect(account.text()).toContain('new@example.test')
        expect(account.text()).toContain('GitHub')
        const boxes = account.findAll('input[type="checkbox"]')
        expect((boxes[0].element as HTMLInputElement).checked).toBe(true)
        await boxes[1].setValue(true)
        await account.findAll('button').find((button) => button.text() === '核准')!.trigger('click')
        await flushPromises()
        expect(approvals.approve).toHaveBeenCalledWith('u1', [TEACHER.id, VIEWER.id])
    })

    it('rejects only with a reason, by disabling the account', async () => {
        const wrapper = mount(AccountApprovalPanel, { global: { plugins: [i18n] } })
        await flushPromises()
        const account = wrapper.find('[data-testid="pending-account"]')
        await account.findAll('button').find((button) => button.text() === '拒絕')!.trigger('click')
        const confirm = account.findAll('button').find((button) => button.text() === '確認拒絕')!
        expect(confirm.attributes('disabled')).toBeDefined()
        await account.find('input:not([type="checkbox"])').setValue('不明帳號')
        await confirm.trigger('click')
        await flushPromises()
        expect(updateStatus).toHaveBeenCalledWith('u1', 'disabled', '不明帳號', 3)
    })
})

describe('pending accounts in the router', () => {
    it('keeps a pending account on its waiting page', async () => {
        service.getSession.mockResolvedValue({ session: { user: { id: 'u1', email: 'new@example.test', account_status: 'pending' } }, error: null })
        const { default: router } = await import('@/router')
        const store = useAuthStore()
        await store.initialize()
        expect(store.accountPending).toBe(true)
        await router.push('/dashboard/students')
        expect(router.currentRoute.value.name).toBe('account-pending')
        await router.push('/auth/set-password')
        expect(router.currentRoute.value.name).toBe('set-password')
    })
})
