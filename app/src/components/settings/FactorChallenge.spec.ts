import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import i18n from '@/i18n'

const service = vi.hoisted(() => ({ challengeFactor: vi.fn(), verifyFactor: vi.fn(), verifyRecoveryCode: vi.fn() }))
vi.mock('@/services/auth/AdditionalAuthService', () => ({ additionalAuth: service, supportsWebAuthn: () => true }))

import FactorChallenge from './FactorChallenge.vue'

const totp = { id: 'f1', factor_type: 'totp' as const, status: 'verified' as const, can_verify: true }

beforeEach(() => {
    vi.resetAllMocks()
    i18n.global.locale.value = 'en'
    service.challengeFactor.mockResolvedValue({ id: 'c1' })
})

describe('FactorChallenge', () => {
    it('submits automatically once six digits are entered and strips other characters', async () => {
        service.verifyFactor.mockResolvedValue({ redirect: '/dashboard' })
        const wrapper = mount(FactorChallenge, { props: { factor: totp }, global: { plugins: [i18n] } })
        const input = wrapper.get('input')
        expect(input.attributes()).toMatchObject({ autocomplete: 'one-time-code', inputmode: 'numeric' })
        await input.setValue('123 45a6')
        await flushPromises()

        expect(service.verifyFactor).toHaveBeenCalledWith('f1', { id: 'c1' }, '123456')
        expect(wrapper.emitted('verified')).toEqual([['/dashboard']])
    })

    it('clears the code and links the error to the field after a rejected code', async () => {
        service.verifyFactor.mockRejectedValue(new Error('invalid'))
        const wrapper = mount(FactorChallenge, { props: { factor: totp }, attachTo: document.body, global: { plugins: [i18n] } })
        await wrapper.get('input').setValue('000000')
        await flushPromises()

        const input = wrapper.get('input')
        expect((input.element as HTMLInputElement).value).toBe('')
        expect(input.attributes('aria-invalid')).toBe('true')
        expect(wrapper.get(`#${input.attributes('aria-describedby')}`).text()).toBe(i18n.global.t('auth.method_failed'))
        wrapper.unmount()
    })
})
