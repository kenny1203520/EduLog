import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import settings from '@/locales/en/settings.json'
import common from '@/locales/en/common.json'
import Component from './WebExtensionIntegrations.vue'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), replace: vi.fn(), route: { query: {} as Record<string, string> } }))
vi.mock('@/services/api/ApiV1Client', () => ({ apiV1Client: mocks }))
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ replace: mocks.replace }) }))
const token = { id: 'token-1234', installation_id: 'install-a', device_name: 'Classroom laptop', browser_name: 'Chrome', platform_name: 'Windows', extension_origin: 'chrome-extension://same-product', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', revoked_at: null, last_used_at: null }
let rows = [token], status = 'pending', wrapper: ReturnType<typeof mount> | undefined
async function start(query: Record<string, string> = {}) {
  mocks.route = reactive({ query })
  wrapper = mount(Component, { attachTo: document.body, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { settings, common } } })] } })
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); rows = [token]; status = 'pending'
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  mocks.get.mockImplementation(async (path: string) => ({ data: path === '/extension/tokens' ? rows : { id: 'pair', status, device_name: 'Office browser', expires_at: '2099-01-01T00:00:00Z', extension_origin: token.extension_origin, token_id: 'new-token' } }))
  mocks.post.mockResolvedValue({}); mocks.patch.mockResolvedValue({}); mocks.delete.mockResolvedValue({})
  mocks.replace.mockImplementation(async ({ query }) => { mocks.route.query = query })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) }
})
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.useRealTimers() })
describe('browser installation connection management', () => {
  it('waits for claim and adds the connection without page reload', async () => {
    const w = await start({ extension_pair: 'pair' })
    await w.get('form').trigger('submit'); await flushPromises()
    expect(mocks.post).toHaveBeenCalledWith('/extension/pair-requests/pair/approve', { device_name: 'Office browser' })
    expect(mocks.route.query.extension_pair).toBe('pair')
    status = 'claimed'; rows = [token, { ...token, id: 'new-token', device_name: 'Office browser' }]
    await vi.advanceTimersByTimeAsync(2000); await flushPromises()
    expect(w.text()).toContain('Pairing completed')
    expect(w.findAll('li')).toHaveLength(2)
    expect(mocks.route.query.extension_pair).toBeUndefined()
  })
  it('distinguishes legacy connections sharing the same extension origin', async () => {
    rows = [{ ...token, installation_id: null!, device_name: null! }, { ...token, id: 'other-1234', installation_id: null!, device_name: null! }]
    const w = await start()
    expect(w.text()).toContain('Unidentified device · token-12')
    expect(w.text()).toContain('Unidentified device · other-12')
    expect(w.findAll('li')).toHaveLength(2)
  })
  it('preserves a typed name during background refresh and sends scoped rename', async () => {
    const w = await start()
    await w.get('[id^="extension-rename-"]').trigger('click')
    await w.get('input').setValue('My teaching computer')
    await vi.advanceTimersByTimeAsync(10000); await flushPromises()
    expect((w.get('input').element as HTMLInputElement).value).toBe('My teaching computer')
    await w.get('form').trigger('submit'); await flushPromises()
    expect(mocks.patch).toHaveBeenCalledWith('/extension/tokens/token-1234', { device_name: 'My teaching computer' })
  })
  it('requires named revocation confirmation and cancel keeps the connection', async () => {
    const w = await start()
    await w.get('li .danger').trigger('click'); await flushPromises()
    expect(w.get('dialog').attributes()).toHaveProperty('open')
    expect(w.get('dialog').text()).toContain('Classroom laptop')
    expect(mocks.delete).not.toHaveBeenCalled()
    await w.get('dialog .secondary').trigger('click')
    expect(mocks.delete).not.toHaveBeenCalled()
    await w.get('li .danger').trigger('click'); await flushPromises()
    await w.get('dialog .danger').trigger('click'); await flushPromises()
    expect(mocks.delete).toHaveBeenCalledWith('/extension/tokens/token-1234')
  })
  it('keeps existing rows during network failure and pauses hidden polling', async () => {
    const w = await start()
    mocks.get.mockRejectedValue(new Error('offline'))
    await vi.advanceTimersByTimeAsync(10000); await flushPromises()
    expect(w.findAll('li')).toHaveLength(1)
    expect(w.get('[role="alert"]').text()).toBe(settings.extension.load_failed)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    const count = mocks.get.mock.calls.length
    await vi.advanceTimersByTimeAsync(30000)
    expect(mocks.get.mock.calls.length).toBe(count)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange')); await flushPromises()
    expect(mocks.get.mock.calls.length).toBeGreaterThan(count)
  })
})
