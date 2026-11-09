import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { AiCredentialDTO, CredentialTestResult } from '@/services/ai/AiSettingsService'
import AiCredentialList from './AiCredentialList.vue'

const service = vi.hoisted(() => ({ testMyCredential: vi.fn(), testSiteCredential: vi.fn(), updateSiteModel: vi.fn(), updateSiteCredential: vi.fn() }))
vi.mock('@/services/ai/AiSettingsService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/ai/AiSettingsService')>()),
    AiSettingsService: service,
}))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => ({ success: vi.fn(), reportError: vi.fn() }) }))

const credential: AiCredentialDTO = {
    id: 'c1', scope: 'user', provider: 'openrouter', auth_type: 'api_key', secret_hint: 'sk-or-…657b', base_url: null,
    label: 'OpenRouter', status: 'active', last_verified_at: null,
    models: [{ id: 'm1', credential_id: 'c1', model_id: 'google/gemma-4-26b-a4b-it:free', display_name: 'Gemma', enabled: true, quota_weight: 0, price_input_per_mtok: 0, price_output_per_mtok: 0 }],
}

async function testWith(result: CredentialTestResult) {
    service.testMyCredential.mockResolvedValue(result)
    const wrapper = mount(AiCredentialList, { props: { mode: 'personal', modelValue: [{ ...credential }] }, global: { plugins: [i18n] } })
    await wrapper.findAll('button').find((button) => button.text() === '測試')!.trigger('click')
    await flushPromises()
    return wrapper
}

beforeEach(() => {
    vi.clearAllMocks()
    i18n.global.locale.value = 'zh-TW'
})

describe('AiCredentialList test results', () => {
    it('explains an OpenRouter data-policy refusal, links to the privacy settings and keeps the key active', async () => {
        const wrapper = await testWith({ ok: false, error: 'AI_APICallError', failure: 'DATA_POLICY', status: 404, message: 'No endpoints found matching your data policy' })
        const notice = wrapper.find('[data-testid="credential-test-failure"]')
        expect(notice.text()).toContain('隱私設定')
        expect(notice.find('a').attributes('href')).toBe('https://openrouter.ai/settings/privacy')
        expect(notice.find('details').text()).toContain('HTTP 404 – No endpoints found matching your data policy')
        expect(wrapper.text()).not.toContain('驗證失敗')
    })

    it('says a rate limit is not the key’s fault', async () => {
        const wrapper = await testWith({ ok: false, error: 'AI_APICallError', failure: 'RATE_LIMITED', status: 429, message: 'Rate limit exceeded' })
        expect(wrapper.find('[data-testid="credential-test-failure"]').text()).toContain('限流')
        expect(wrapper.text()).not.toContain('驗證失敗')
    })

    it('marks the credential invalid only when the key is rejected', async () => {
        const wrapper = await testWith({ ok: false, error: 'AI_APICallError', failure: 'AUTH_FAILED', status: 401, message: 'User not found.' })
        expect(wrapper.find('[data-testid="credential-test-failure"]').text()).toContain('金鑰無效')
        expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toMatchObject([{ status: 'invalid' }])
    })
})

describe('AiCredentialList test model', () => {
    it('tests the model the teacher picks from the credential’s models', async () => {
        service.testMyCredential.mockResolvedValue({ ok: true, error: null })
        const second = { ...credential.models[0], id: 'm2', model_id: 'anthropic/claude-sonnet-5.5', display_name: 'Sonnet' }
        const wrapper = mount(AiCredentialList, { props: { mode: 'personal', modelValue: [{ ...credential, models: [credential.models[0], second] }] }, global: { plugins: [i18n] } })

        const select = wrapper.find('[data-testid="test-model-c1"]')
        expect(select.findAll('option').map((option) => option.text())).toEqual(['Gemma', 'Sonnet'])
        await select.setValue('m2')
        await wrapper.findAll('button').find((button) => button.text() === '測試')!.trigger('click')
        await flushPromises()
        expect(service.testMyCredential).toHaveBeenCalledWith('c1', 'anthropic/claude-sonnet-5.5')
    })

    it('needs no picker when there is a single model', () => {
        const wrapper = mount(AiCredentialList, { props: { mode: 'personal', modelValue: [{ ...credential }] }, global: { plugins: [i18n] } })
        expect(wrapper.find('[data-testid="test-model-c1"]').exists()).toBe(false)
    })
})

describe('AiCredentialList enable switches', () => {
    const siteCredential: AiCredentialDTO = { ...credential, scope: 'site' }
    const mountSite = (models = siteCredential.models) =>
        mount(AiCredentialList, { props: { mode: 'site', defaultModelId: null, modelValue: [{ ...siteCredential, models }] }, global: { plugins: [i18n] } })

    it('disables a model through its switch', async () => {
        service.updateSiteModel.mockResolvedValue({ ...siteCredential.models[0], enabled: false })
        const wrapper = mountSite()
        const toggle = wrapper.get('[data-testid="model-switch-m1"]')
        expect(toggle.attributes()).toMatchObject({ role: 'switch', 'aria-checked': 'true', 'aria-label': '啟用模型 Gemma' })

        await toggle.trigger('click')
        await flushPromises()
        expect(service.updateSiteModel).toHaveBeenCalledWith('m1', { enabled: false })
        expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toMatchObject([{ models: [{ id: 'm1', enabled: false }] }])
    })

    it('marks a disabled model and hides 設為預設', () => {
        const wrapper = mountSite([{ ...siteCredential.models[0], enabled: false }])
        const row = wrapper.get('[data-testid="model-row-m1"]')
        expect(row.classes()).toContain('opacity-60')
        expect(row.get('[data-testid="model-disabled-badge"]').text()).toBe('已停用')
        expect(row.get('[data-testid="model-switch-m1"]').attributes('aria-checked')).toBe('false')
        expect(row.text()).not.toContain('設為預設')
    })

    it('offers 設為預設 on an enabled model', () => {
        const row = mountSite().get('[data-testid="model-row-m1"]')
        expect(row.classes()).not.toContain('opacity-60')
        expect(row.find('[data-testid="model-disabled-badge"]').exists()).toBe(false)
        expect(row.text()).toContain('設為預設')
    })

    it('disables the provider through its switch', async () => {
        service.updateSiteCredential.mockResolvedValue({ ...siteCredential, status: 'disabled' })
        const wrapper = mountSite()
        const toggle = wrapper.get('[data-testid="provider-switch-c1"]')
        expect(toggle.attributes()).toMatchObject({ 'aria-checked': 'true', 'aria-label': '啟用供應商 OpenRouter' })

        await toggle.trigger('click')
        await flushPromises()
        expect(service.updateSiteCredential).toHaveBeenCalledWith('c1', { status: 'disabled' })
        expect(wrapper.get('[data-testid="provider-switch-c1"]').attributes('aria-checked')).toBe('false')
    })
})
