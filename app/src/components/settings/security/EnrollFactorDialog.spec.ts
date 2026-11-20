import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import i18n from '@/i18n'

const service = vi.hoisted(() => ({ enrollFactor: vi.fn(), removeFactor: vi.fn(), generateRecoveryCodes: vi.fn() }))
vi.mock('@/services/auth/AdditionalAuthService', () => ({ additionalAuth: service, supportsWebAuthn: () => true }))

import EnrollFactorDialog from './EnrollFactorDialog.vue'

const Challenge = defineComponent({
    props: ['factor'], emits: ['verified'],
    template: '<button data-testid="complete-factor" @click="$emit(\'verified\', \'/dashboard\')">Complete factor</button>',
})
const t = (key: string) => i18n.global.t(key)
const originalMatchMedia = window.matchMedia

function render(props: { offerRecoveryCodes?: boolean } = {}) {
    return mount(EnrollFactorDialog, {
        props: { type: 'totp', offerRecoveryCodes: false, ...props },
        attachTo: document.body,
        global: { plugins: [i18n], stubs: { FactorChallenge: Challenge } },
    })
}
async function startEnrollment(wrapper: ReturnType<typeof render>) {
    await wrapper.get('form').trigger('submit')
    await flushPromises()
}

beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
beforeEach(() => {
    vi.resetAllMocks()
    i18n.global.locale.value = 'en'
    service.removeFactor.mockResolvedValue(undefined)
    service.enrollFactor.mockResolvedValue({ id: 'factor-1', totp: { secret: 'JBSWY3DPEHPK3PXP', qr_code: 'data:image/svg+xml;utf-8,<svg/>', uri: 'otpauth://totp/EduLog:demo' } })
})
afterEach(() => { window.matchMedia = originalMatchMedia })

describe('EnrollFactorDialog', () => {
    it('focuses the name field rather than the close button when it opens', async () => {
        const wrapper = render()
        await flushPromises()
        expect(document.activeElement).toBe(wrapper.get('input').element)
        wrapper.unmount()
    })

    it('wraps the raw SVG that GoTrue returns into an image data URI', async () => {
        const svg = '<?xml version="1.0"?>\n<svg width="231" height="231" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="3" height="3"/></svg>'
        service.enrollFactor.mockResolvedValue({ id: 'factor-1', totp: { secret: 'JBSWY3DPEHPK3PXP', qr_code: svg, uri: 'otpauth://totp/EduLog:demo' } })
        const wrapper = render()
        await startEnrollment(wrapper)

        const src = wrapper.get('img').attributes('src')!
        expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
        expect(decodeURIComponent(src.split(',').slice(1).join(','))).toBe(svg)
        expect(wrapper.find('svg[width="231"]').exists()).toBe(false)
        wrapper.unmount()
    })

    it('offers the otpauth deep link on touch devices only', async () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
        const touch = render()
        await startEnrollment(touch)
        expect(touch.get('a[href^="otpauth://"]').text()).toBe(t('auth.open_in_authenticator'))
        touch.unmount()

        window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
        const desktop = render()
        await startEnrollment(desktop)
        expect(desktop.find('a[href^="otpauth://"]').exists()).toBe(false)
        desktop.unmount()
    })

    it('issues recovery codes after the first factor and only closes once they are saved', async () => {
        service.generateRecoveryCodes.mockResolvedValue({ codes: ['aaaa-1111', 'bbbb-2222'] })
        const wrapper = render({ offerRecoveryCodes: true })
        await startEnrollment(wrapper)
        await wrapper.get('[data-testid="complete-factor"]').trigger('click')
        await flushPromises()

        expect(service.generateRecoveryCodes).toHaveBeenCalledWith(false)
        expect(wrapper.text()).toContain('aaaa-1111')
        const finish = wrapper.findAll('button').find(item => item.text() === t('auth.enroll_finish'))!
        expect(finish.attributes('disabled')).toBeDefined()
        await wrapper.get('dialog').trigger('cancel')
        expect(wrapper.emitted('close')).toBeUndefined()

        await wrapper.get('input[type="checkbox"]').setValue(true)
        await finish.trigger('click')
        expect(wrapper.emitted('close')).toEqual([[true]])
        expect(service.removeFactor).not.toHaveBeenCalled()
        wrapper.unmount()
    })

    it('discards the unverified factor when the dialog unmounts mid-setup', async () => {
        const wrapper = render()
        await startEnrollment(wrapper)
        wrapper.unmount()
        await flushPromises()
        expect(service.removeFactor).toHaveBeenCalledWith('factor-1')
    })
})
