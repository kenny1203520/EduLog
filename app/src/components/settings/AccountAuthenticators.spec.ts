import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import i18n from '@/i18n'

const service = vi.hoisted(() => ({
    capabilities: vi.fn(), factors: vi.fn(), passkeys: vi.fn(), recoveryCodes: vi.fn(), generateRecoveryCodes: vi.fn(),
    enrollFactor: vi.fn(), removeFactor: vi.fn(), removePasskey: vi.fn(), addPasskey: vi.fn(), removeRecoveryCodes: vi.fn(),
    passkeySupport: vi.fn(),
}))
vi.mock('@/services/auth/AdditionalAuthService', () => ({
    additionalAuth: service,
    supportsWebAuthn: () => true,
    passkeySupport: service.passkeySupport,
    passkeyFailure: (error: { name?: string }) => error?.name === 'NotAllowedError' ? 'cancelled' : 'failed',
}))

import AccountAuthenticators from './AccountAuthenticators.vue'

const Challenge = defineComponent({
    props: ['factor'], emits: ['verified'],
    template: '<button data-testid="complete-factor" @click="$emit(\'verified\', \'/dashboard\')">Complete factor</button>',
})
const t = (key: string, values?: Record<string, unknown>) => i18n.global.t(key, values ?? {})

function render(props: { canManageProviders?: boolean } = {}) {
    return mount(AccountAuthenticators, { props, attachTo: document.body, global: { plugins: [i18n], stubs: { FactorChallenge: Challenge, teleport: true } } })
}
function capabilities(overrides: { passkeys?: boolean; recoveryCodes?: boolean; phone?: boolean } = {}) {
    return {
        providers: [], unavailable: [],
        methods: { password: true, emailOtp: false, magicLink: false, sms: false, saml: false, passkeys: overrides.passkeys ?? true },
        mfa: { totp: true, phone: overrides.phone ?? false, webauthn: false, recoveryCodes: overrides.recoveryCodes ?? false },
    }
}
function button(wrapper: VueWrapper, text: string) {
    const match = wrapper.findAll('button').find(item => item.text() === text)
    if (!match) throw new Error(`Button "${text}" not found`)
    return match
}

beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
beforeEach(() => {
    vi.resetAllMocks()
    i18n.global.locale.value = 'en'
    service.capabilities.mockResolvedValue(capabilities())
    service.factors.mockResolvedValue([])
    service.passkeys.mockResolvedValue([])
    service.recoveryCodes.mockResolvedValue(null)
    service.removeFactor.mockResolvedValue(undefined)
    service.passkeySupport.mockResolvedValue(false)
})

describe('AccountAuthenticators management', () => {
    it('keeps loaded factors usable when passkeys fail and clears the inline error after retry', async () => {
        service.factors.mockResolvedValue([{ id: 'totp', factor_type: 'totp', status: 'verified', friendly_name: 'Teaching phone', can_verify: true }])
        service.passkeys.mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValue([])
        const wrapper = render()
        await flushPromises()

        expect(wrapper.text()).toContain('Teaching phone')
        expect(wrapper.get('[role="status"]').text()).toContain(t('auth.methods_unavailable'))
        await wrapper.get('[role="status"] button').trigger('click')
        await flushPromises()

        expect(wrapper.text()).not.toContain(t('auth.methods_unavailable'))
        expect(service.passkeys).toHaveBeenCalledTimes(2)
        wrapper.unmount()
    })

    it('enrolls an authenticator app with a QR code and a custom name, then reloads verified state', async () => {
        service.enrollFactor.mockResolvedValue({ id: 'new-factor', totp: { secret: 'ABCDEFGHIJKL', qr_code: 'data:image/svg+xml;utf-8,<svg/>', uri: 'otpauth://totp/EduLog' } })
        const wrapper = render()
        await flushPromises()
        await button(wrapper, t('auth.set_up')).trigger('click')
        await wrapper.get('dialog input').setValue('Work phone')
        await wrapper.get('dialog form').trigger('submit')
        await flushPromises()

        expect(service.enrollFactor).toHaveBeenCalledWith('totp', { phone: '', friendlyName: 'Work phone' })
        expect(wrapper.get('dialog img').attributes()).toMatchObject({ src: 'data:image/svg+xml;utf-8,<svg/>', alt: t('auth.qr_alt') })
        expect(wrapper.get('dialog code').text()).toBe('ABCD EFGH IJKL')
        service.factors.mockResolvedValue([{ id: 'new-factor', factor_type: 'totp', status: 'verified', friendly_name: 'Work phone', can_verify: true }])
        await wrapper.get('[data-testid="complete-factor"]').trigger('click')
        await flushPromises()
        await button(wrapper, t('auth.enroll_finish')).trigger('click')
        await flushPromises()

        expect(wrapper.find('dialog').exists()).toBe(false)
        expect(wrapper.text()).toContain('Work phone')
        expect(service.removeFactor).not.toHaveBeenCalled()
        wrapper.unmount()
    })

    it('deletes the unverified factor when the setup is cancelled', async () => {
        service.enrollFactor.mockResolvedValue({ id: 'abandoned', totp: { secret: 'SECRET', qr_code: 'data:image/svg+xml;utf-8,<svg/>' } })
        const wrapper = render()
        await flushPromises()
        await button(wrapper, t('auth.set_up')).trigger('click')
        await wrapper.get('dialog form').trigger('submit')
        await flushPromises()
        await wrapper.get('dialog').trigger('cancel')
        await flushPromises()

        expect(service.removeFactor).toHaveBeenCalledWith('abandoned')
        expect(wrapper.find('dialog').exists()).toBe(false)
        wrapper.unmount()
    })

    it('removes abandoned authenticator apps on load and does not list them', async () => {
        service.factors.mockResolvedValue([
            { id: 'stale', factor_type: 'totp', status: 'unverified', friendly_name: null, can_verify: true },
            { id: 'kept', factor_type: 'totp', status: 'verified', friendly_name: 'Kept app', can_verify: true },
        ])
        const wrapper = render()
        await flushPromises()

        expect(service.removeFactor).toHaveBeenCalledWith('stale')
        expect(wrapper.findAll('li').map(item => item.text()).join()).toContain('Kept app')
        expect(wrapper.findAll('li')).toHaveLength(1)
        wrapper.unmount()
    })

    it('offers to finish only pending factors whose server flag permits verification', async () => {
        service.capabilities.mockResolvedValue(capabilities({ phone: true }))
        service.factors.mockResolvedValue([
            { id: 'allowed', factor_type: 'phone', status: 'unverified', friendly_name: 'Allowed phone', can_verify: true },
            { id: 'disabled', factor_type: 'phone', status: 'unverified', friendly_name: 'Disabled phone', can_verify: false },
            { id: 'verified', factor_type: 'phone', status: 'verified', friendly_name: 'Verified phone', can_verify: true },
        ])
        const wrapper = render()
        await flushPromises()

        expect(wrapper.text()).not.toContain('Disabled phone')
        const rows = wrapper.findAll('li')
        expect(rows.map(row => row.findAll('button').filter(item => item.text() === t('auth.continue_verification')).length)).toEqual([1, 0])
        await button(wrapper, t('auth.continue_verification')).trigger('click')
        expect(wrapper.get('[data-testid="complete-factor"]').exists()).toBe(true)
        wrapper.unmount()
    })

    it('requires confirmation before removing a factor and retains it after an API failure', async () => {
        service.factors.mockResolvedValue([{ id: 'totp', factor_type: 'totp', status: 'verified', friendly_name: 'My authenticator', can_verify: true }])
        service.removeFactor.mockRejectedValue(new Error('Denied'))
        const wrapper = render()
        await flushPromises()
        await wrapper.get('li button').trigger('click')
        expect(service.removeFactor).not.toHaveBeenCalled()
        const confirm = wrapper.findAll('button').filter(item => item.text() === t('auth.remove_authenticator')).at(-1)!
        await confirm.trigger('click')
        await flushPromises()

        expect(service.removeFactor).toHaveBeenCalledWith('totp')
        expect(wrapper.get('li').text()).toContain('My authenticator')
        expect(wrapper.text()).toContain(t('auth.method_failed'))
        wrapper.unmount()
    })

    it('shows the disabled-passkey hint only to accounts that manage login providers', async () => {
        service.capabilities.mockResolvedValue(capabilities({ passkeys: false }))
        const member = render()
        await flushPromises()
        expect(member.text()).not.toContain(t('auth.passkey_disabled_admin_hint'))
        member.unmount()

        const admin = render({ canManageProviders: true })
        await flushPromises()
        expect(admin.text()).toContain(t('auth.passkey_disabled_admin_hint'))
        expect(admin.text()).toContain('PASSKEY_ENABLED=true')
        admin.unmount()
    })

    it('hides passkey creation when the browser cannot create one and stays quiet when the user cancels', async () => {
        const unsupported = render()
        await flushPromises()
        expect(unsupported.findAll('button').some(item => item.text() === t('auth.add_passkey'))).toBe(false)
        expect(unsupported.text()).toContain(t('auth.webauthn_unavailable'))
        unsupported.unmount()

        service.passkeySupport.mockResolvedValue(true)
        service.addPasskey.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }))
        const supported = render()
        await flushPromises()
        await button(supported, t('auth.add_passkey')).trigger('click')
        await flushPromises()
        expect(supported.find('[role="alert"]').exists()).toBe(false)
        supported.unmount()
    })
})
