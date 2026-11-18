import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import i18n from '@/i18n'

const service = vi.hoisted(() => ({
    capabilities: vi.fn(), factors: vi.fn(), passkeys: vi.fn(), recoveryCodes: vi.fn(),
    enrollFactor: vi.fn(), removeFactor: vi.fn(), supportsWebAuthn: vi.fn(),
}))
vi.mock('@/services/auth/AdditionalAuthService', () => ({ additionalAuth: service, supportsWebAuthn: service.supportsWebAuthn }))

import AccountAuthenticators from './AccountAuthenticators.vue'

const Challenge = defineComponent({
    props: ['factor'], emits: ['verified'],
    template: '<button data-testid="complete-factor" @click="$emit(\'verified\', \'/dashboard\')">Complete factor</button>',
})
function render() {
    return mount(AccountAuthenticators, { global: { plugins: [i18n], stubs: { FactorChallenge: Challenge } } })
}
function capabilities() {
    return {
        providers: [], unavailable: [],
        methods: { password: true, emailOtp: false, magicLink: false, sms: false, saml: false, passkeys: true },
        mfa: { totp: true, phone: false, webauthn: false, recoveryCodes: false },
    }
}

beforeEach(() => {
    vi.resetAllMocks()
    i18n.global.locale.value = 'en'
    service.capabilities.mockResolvedValue(capabilities())
    service.factors.mockResolvedValue([])
    service.passkeys.mockResolvedValue([])
    service.recoveryCodes.mockResolvedValue(null)
    service.supportsWebAuthn.mockReturnValue(false)
})

describe('AccountAuthenticators management', () => {
    it('keeps loaded factors usable when passkeys fail and clears the inline error after retry', async () => {
        service.factors.mockResolvedValue([{ id: 'totp', factor_type: 'totp', status: 'verified', friendly_name: 'Teaching phone', can_verify: true }])
        service.passkeys.mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValue([])
        const wrapper = render()
        await flushPromises()

        expect(wrapper.text()).toContain('Teaching phone')
        expect(wrapper.get('[role="status"]').text()).toContain(i18n.global.t('auth.methods_unavailable'))
        i18n.global.locale.value = 'zh-TW'
        await flushPromises()
        expect(wrapper.get('[role="status"]').text()).toContain(i18n.global.t('auth.methods_unavailable'))
        await wrapper.get('[role="status"] button').trigger('click')
        await flushPromises()

        expect(wrapper.find('[role="status"]').exists()).toBe(false)
        expect(service.passkeys).toHaveBeenCalledTimes(2)
        wrapper.unmount()
    })

    it('enrolls a TOTP factor and reloads verified state after the challenge completes', async () => {
        service.enrollFactor.mockResolvedValue({ id: 'new-factor', totp: { secret: 'fixture-totp-secret' } })
        const wrapper = render()
        await flushPromises()
        await wrapper.get('select').setValue('totp')
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(service.enrollFactor).toHaveBeenCalledWith('totp', '')
        expect(wrapper.get('code').text()).toBe('fixture-totp-secret')
        service.factors.mockResolvedValue([{ id: 'new-factor', factor_type: 'totp', status: 'verified', friendly_name: 'Verified authenticator', can_verify: true }])
        await wrapper.get('[data-testid="complete-factor"]').trigger('click')
        await flushPromises()

        expect(wrapper.find('code').exists()).toBe(false)
        expect(wrapper.text()).toContain('Verified authenticator')
        expect(service.factors).toHaveBeenCalledTimes(2)
        wrapper.unmount()
    })

    it('offers verification only for a pending factor whose server flag permits it', async () => {
        service.factors.mockResolvedValue([
            { id: 'allowed', factor_type: 'phone', status: 'unverified', friendly_name: 'Allowed phone', can_verify: true },
            { id: 'disabled', factor_type: 'phone', status: 'unverified', friendly_name: 'Disabled phone', can_verify: false },
            { id: 'verified', factor_type: 'phone', status: 'verified', friendly_name: 'Verified phone', can_verify: true },
        ])
        const wrapper = render()
        await flushPromises()
        const rows = wrapper.findAll('li')
        const verificationButtons = rows.map(row => row.findAll('button').filter(button => button.text() === i18n.global.t('auth.verify_code')).length)
        expect(verificationButtons).toEqual([1, 0, 0])
        await rows[0]!.findAll('button')[0]!.trigger('click')
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
        const confirm = wrapper.findAll('button').find(button => button.text() === i18n.global.t('auth.confirm_authenticator_action'))!
        await confirm.trigger('click')
        await flushPromises()

        expect(service.removeFactor).toHaveBeenCalledWith('totp')
        expect(wrapper.get('li').text()).toContain('My authenticator')
        expect(wrapper.text()).toContain(i18n.global.t('auth.method_failed'))
        wrapper.unmount()
    })
})
