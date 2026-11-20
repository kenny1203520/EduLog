import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import i18n from '@/i18n'

const service = vi.hoisted(() => ({ identities: vi.fn(), linkIdentity: vi.fn(), unlinkIdentity: vi.fn() }))
vi.mock('@/services/auth/AuthService', () => ({ authService: service }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))

import LinkedIdentities from './LinkedIdentities.vue'

const t = (key: string, values?: Record<string, unknown>) => i18n.global.t(key, values ?? {})
function render(canManageProviders = false) {
    return mount(LinkedIdentities, {
        props: { canManageProviders }, attachTo: document.body,
        global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub, PasswordInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input type="password" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">' } } },
    })
}

beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
beforeEach(() => {
    vi.resetAllMocks()
    i18n.global.locale.value = 'en'
})

describe('LinkedIdentities', () => {
    it('points provider managers to the login provider settings when nothing is enabled', async () => {
        service.identities.mockResolvedValue({ identities: [], providers: [], manual_linking: true })
        const member = render()
        await flushPromises()
        expect(member.text()).toContain(t('auth.identity_providers_empty'))
        expect(member.findComponent(RouterLinkStub).exists()).toBe(false)
        member.unmount()

        const admin = render(true)
        await flushPromises()
        expect(admin.getComponent(RouterLinkStub).props('to')).toEqual({ path: '/dashboard/settings', query: { tab: 'system', section: 'login_providers' } })
        admin.unmount()
    })

    it('lists only providers that are not linked yet as link options', async () => {
        service.identities.mockResolvedValue({ identities: [{ id: 'i1', provider: 'google' }], providers: ['google', 'github'], manual_linking: true })
        const wrapper = render()
        await flushPromises()
        const labels = wrapper.findAll('button').map(item => item.text())
        expect(labels).toContain(t('auth.link_provider', { provider: 'GitHub' }))
        expect(labels).not.toContain(t('auth.link_provider', { provider: 'Google' }))
        expect(wrapper.text()).toContain(t('auth.linked_badge'))
        wrapper.unmount()
    })

    it('confirms unlinking with the current password in a dialog and reports a wrong password', async () => {
        service.identities.mockResolvedValue({ identities: [{ id: 'i1', provider: 'github' }], providers: ['github'], manual_linking: true })
        service.unlinkIdentity.mockRejectedValue(Object.assign(new Error('bad'), { code: 'CURRENT_PASSWORD_INVALID' }))
        const wrapper = render()
        await flushPromises()
        await wrapper.findAll('button').find(item => item.text() === t('auth.unlink'))!.trigger('click')
        await wrapper.get('dialog input[type="password"]').setValue('secret-password')
        await wrapper.get('dialog form').trigger('submit')
        await flushPromises()

        expect(service.unlinkIdentity).toHaveBeenCalledWith('i1', 'secret-password')
        expect(wrapper.get('dialog [role="alert"]').text()).toBe(t('auth.identity_password_invalid'))
        wrapper.unmount()
    })
})
