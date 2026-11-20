import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import i18n from '@/i18n'
import { ApiV1Error } from '@/services/api/ApiV1Client'

const service = vi.hoisted(() => ({ clients: vi.fn(), register: vi.fn(), removeClient: vi.fn() }))
vi.mock('@/services/auth/OutboundOAuthService', () => ({ outboundOAuthService: service }))

import OutboundOAuthClients from './OutboundOAuthClients.vue'

const t = (key: string, values?: Record<string, unknown>) => i18n.global.t(key, values ?? {})
const app = { client_id: '7c7d3a52-9a0e-4b7e-9d43-2f2d5c3f7a10', client_name: 'Parent portal', redirect_uris: ['https://portal.example.com/cb'], client_type: 'confidential' as const }
function apiError(code: string, status: number) {
    return Object.assign(Object.create(ApiV1Error.prototype), { code, status, message: code }) as ApiV1Error
}
function render() {
    return mount(OutboundOAuthClients, { attachTo: document.body, global: { plugins: [i18n], stubs: { teleport: true } } })
}
function button(wrapper: ReturnType<typeof render>, text: string) {
    return wrapper.findAll('button').filter(item => item.text().includes(text)).at(-1)!
}

beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
beforeEach(() => {
    vi.resetAllMocks()
    i18n.global.locale.value = 'en'
})

describe('OutboundOAuthClients', () => {
    it('explains which deployment flag enables the section when the OAuth server is off', async () => {
        service.clients.mockRejectedValue(apiError('OAUTH_SERVER_DISABLED', 404))
        const wrapper = render()
        await flushPromises()
        expect(wrapper.text()).toContain(t('oauthServer.admin_disabled'))
        expect(wrapper.text()).toContain('EDULOG_AUTH_OUTBOUND_OAUTH_ENABLED=true')
        expect(wrapper.findAll('button').some(item => item.text().includes(t('oauthServer.add_app')))).toBe(false)
        wrapper.unmount()
    })

    it('distinguishes a GoTrue OAuth server that is not serving yet from a generic outage', async () => {
        service.clients.mockRejectedValue(apiError('OAUTH_REQUEST_NOT_FOUND', 404))
        const wrapper = render()
        await flushPromises()
        expect(wrapper.get('[role="alert"]').text()).toContain(t('oauthServer.server_not_ready'))
        wrapper.unmount()
    })

    it('shows the client secret once and keeps the dialog open until it is saved', async () => {
        service.clients.mockResolvedValueOnce([]).mockResolvedValue([app])
        service.register.mockResolvedValue({ ...app, client_secret: 'issued-secret' })
        const wrapper = render()
        await flushPromises()
        await button(wrapper, t('oauthServer.add_app')).trigger('click')
        await wrapper.get('dialog input').setValue('Parent portal')
        await wrapper.get('dialog textarea').setValue('https://portal.example.com/cb\n')
        await wrapper.get('dialog form').trigger('submit')
        await flushPromises()

        expect(service.register).toHaveBeenCalledWith('Parent portal', ['https://portal.example.com/cb'])
        expect(wrapper.get('dialog').text()).toContain('issued-secret')
        await wrapper.get('dialog').trigger('cancel')
        expect(wrapper.find('dialog').exists()).toBe(true)
        await wrapper.get('dialog input[type="checkbox"]').setValue(true)
        await button(wrapper, t('oauthServer.done')).trigger('click')
        await flushPromises()

        expect(wrapper.find('dialog').exists()).toBe(false)
        expect(wrapper.text()).toContain('Parent portal')
        wrapper.unmount()
    })

    it('rejects non-HTTPS callbacks before calling the API', async () => {
        service.clients.mockResolvedValue([])
        const wrapper = render()
        await flushPromises()
        await button(wrapper, t('oauthServer.add_app')).trigger('click')
        await wrapper.get('dialog input').setValue('Insecure')
        await wrapper.get('dialog textarea').setValue('http://insecure.example.com/cb')
        await wrapper.get('dialog form').trigger('submit')

        expect(service.register).not.toHaveBeenCalled()
        expect(wrapper.get('dialog [role="alert"]').text()).toBe(t('oauthServer.invalid_settings'))
        wrapper.unmount()
    })

    it('removes an application only after confirmation', async () => {
        service.clients.mockResolvedValue([app])
        service.removeClient.mockResolvedValue(undefined)
        const wrapper = render()
        await flushPromises()
        await button(wrapper, t('oauthServer.remove')).trigger('click')
        expect(service.removeClient).not.toHaveBeenCalled()
        await button(wrapper, t('oauthServer.confirm_remove')).trigger('click')
        await flushPromises()

        expect(service.removeClient).toHaveBeenCalledWith(app.client_id)
        expect(wrapper.text()).not.toContain('Parent portal')
        wrapper.unmount()
    })
})
