import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { AiCredentialDTO } from '@/services/ai/AiSettingsService'
import AiCredentialList from './AiCredentialList.vue'
import ModelPicker from './ModelPicker.vue'

const service = vi.hoisted(() => ({
    catalog: vi.fn(),
    updateSiteModel: vi.fn(),
    updateMyModel: vi.fn(),
    updateMyCredential: vi.fn(),
    addSiteModel: vi.fn(),
}))
vi.mock('@/services/ai/AiSettingsService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/ai/AiSettingsService')>()),
    AiSettingsService: service,
}))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => ({ success: vi.fn(), reportError: vi.fn() }) }))

const global = { plugins: [i18n] }

beforeEach(() => {
    vi.clearAllMocks()
    i18n.global.locale.value = 'zh-TW'
})

describe('ModelPicker', () => {
    it('offers text models from the provider and emits prices for the chosen one', async () => {
        service.catalog.mockResolvedValue({ supported: true, fetchedAt: 'x', models: [
            { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', textCapable: true, priceInputPerMtok: 3, priceOutputPerMtok: 15 },
            { id: 'openai/text-embedding', name: 'Embedding', textCapable: false },
        ] })
        const wrapper = mount(ModelPicker, { props: { scope: 'site', credentialId: 'c1' }, global })
        await flushPromises()

        const select = wrapper.findComponent({ name: 'SearchableSelect' })
        const values = (select.props('options') as Array<{ value: string }>).map((option) => option.value)
        expect(values).toEqual(['anthropic/claude-sonnet-5.5', '__other__'])
        expect(wrapper.text()).toContain('顯示全部（含 1 個非文字模型）')

        select.vm.$emit('update:modelValue', 'anthropic/claude-sonnet-5.5')
        expect(wrapper.emitted('pick')?.at(-1)).toEqual([{ id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', priceInputPerMtok: 3, priceOutputPerMtok: 15 }])
    })

    it('switches to manual entry for "other" and when the provider has no list', async () => {
        service.catalog.mockResolvedValue({ supported: false, reason: 'chatgpt_plan' })
        const wrapper = mount(ModelPicker, { props: { scope: 'personal', credentialId: 'c2' }, global })
        await flushPromises()
        expect(wrapper.text()).toContain('ChatGPT 方案沒有提供模型清單')
        await wrapper.find('input').setValue('gpt-5')
        expect(wrapper.emitted('pick')?.at(-1)).toEqual([{ id: 'gpt-5', name: 'gpt-5' }])
        // Retrying cannot help a ChatGPT plan.
        expect(wrapper.text()).not.toContain('重試載入模型')
    })

    it('explains why the list failed, shows the provider detail and retries', async () => {
        service.catalog.mockResolvedValue({ supported: false, reason: 'auth_failed', detail: 'HTTP 400 INVALID_ARGUMENT: API key not valid.' })
        const wrapper = mount(ModelPicker, { props: { scope: 'personal', credentialId: 'c2' }, global })
        await flushPromises()
        expect(wrapper.text()).toContain('供應商拒絕了這把金鑰')
        expect(wrapper.text()).toContain('HTTP 400 INVALID_ARGUMENT: API key not valid.')
        expect(wrapper.find('input').exists()).toBe(true)
        service.catalog.mockResolvedValue({ supported: true, fetchedAt: 'new', models: [{ id: 'qwen3:8b-instruct-q4_K_M', name: 'qwen3:8b-instruct-q4_K_M', textCapable: true }] })
        await wrapper.findAll('button').find((button) => button.text().includes('重試載入模型'))!.trigger('click')
        await flushPromises()
        expect(service.catalog).toHaveBeenLastCalledWith('personal', 'c2', true)
    })

    it('shows a raw reason from an older server as detail under the generic message', async () => {
        service.catalog.mockResolvedValue({ supported: false, reason: 'HTTP 403' })
        const wrapper = mount(ModelPicker, { props: { scope: 'site', credentialId: 'c3' }, global })
        await flushPromises()
        expect(wrapper.text()).toContain('暫時取不到這個來源的模型清單')
        expect(wrapper.text()).toContain('HTTP 403')
    })

    it('keeps manual entry available for an empty Ollama catalog and preserves full model IDs', async () => {
        service.catalog.mockResolvedValue({ supported: true, fetchedAt: 'x', models: [] })
        const wrapper = mount(ModelPicker, { props: { scope: 'personal', credentialId: 'ollama' }, global })
        await flushPromises()
        const select = wrapper.findComponent({ name: 'SearchableSelect' })
        expect((select.props('options') as Array<{ value: string }>).map((option) => option.value)).toEqual(['__other__'])
        await select.vm.$emit('update:modelValue', '__other__')
        await wrapper.find('input').setValue('qwen3:8b-instruct-q4_K_M')
        expect(wrapper.emitted('pick')?.at(-1)).toEqual([{ id: 'qwen3:8b-instruct-q4_K_M', name: 'qwen3:8b-instruct-q4_K_M' }])
    })
})

describe('AiCredentialList model editing', () => {
    const credential = (price: number | null): AiCredentialDTO => ({
        id: 'c1', scope: 'site', provider: 'ollama', auth_type: 'none', secret_hint: null, base_url: 'http://ollama:11434', label: '本機', status: 'active', last_verified_at: null,
        models: [{ id: 'm1', credential_id: 'c1', model_id: 'qwen3.5:9b', display_name: 'Qwen', enabled: true, quota_weight: 1, price_input_per_mtok: price, price_output_per_mtok: price }],
    })

    beforeEach(() => service.catalog.mockResolvedValue({ supported: true, fetchedAt: 'x', models: [] }))

    it('marks unpriced models and can mark them free', async () => {
        service.updateSiteModel.mockResolvedValue({ ...credential(0).models[0] })
        const wrapper = mount(AiCredentialList, { props: { mode: 'site', modelValue: [credential(null)], 'onUpdate:modelValue': (v: AiCredentialDTO[]) => wrapper.setProps({ modelValue: v }) }, global })
        await flushPromises()
        expect(wrapper.text()).toContain('未設價格')

        await wrapper.findAll('button').find((b) => b.text() === '設為免費')!.trigger('click')
        await flushPromises()
        expect(service.updateSiteModel).toHaveBeenCalledWith('m1', { price_input_per_mtok: 0, price_output_per_mtok: 0 })
        expect(wrapper.text()).toContain('免費')
        expect(wrapper.text()).not.toContain('未設價格')
    })

    it('edits a model inline without changing its id and keeps blank prices unknown', async () => {
        service.updateSiteModel.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({ ...credential(null).models[0], ...patch }))
        const wrapper = mount(AiCredentialList, { props: { mode: 'site', modelValue: [credential(2)], 'onUpdate:modelValue': (v: AiCredentialDTO[]) => wrapper.setProps({ modelValue: v }) }, global })
        await flushPromises()

        await wrapper.findAll('button').find((b) => b.text() === '編輯')!.trigger('click')
        expect(wrapper.text()).toContain('模型 ID：qwen3.5:9b（不可修改')
        const inputs = wrapper.findAll('form[aria-label] input')
        await inputs[0].setValue('Qwen 本機')
        await inputs[2].setValue('')
        await wrapper.find('form[aria-label]').trigger('submit')
        await flushPromises()

        expect(service.updateSiteModel).toHaveBeenCalledWith('m1', { display_name: 'Qwen 本機', quota_weight: 1, price_input_per_mtok: null, price_output_per_mtok: 2 })
        expect(wrapper.text()).toContain('Qwen 本機')
    })

    it('asks the parent to make a model the default', async () => {
        const wrapper = mount(AiCredentialList, { props: { mode: 'site', modelValue: [credential(0)], defaultModelId: null }, global })
        await flushPromises()
        await wrapper.findAll('button').find((b) => b.text() === '設為預設')!.trigger('click')
        expect(wrapper.emitted('set-default')).toEqual([['m1']])
    })

    it('updates a personal Ollama URL and token, clearing the pending picker choice and reloading the catalog', async () => {
        const ollamaCredential: AiCredentialDTO = {
            id: 'personal-ollama', scope: 'user', provider: 'ollama', auth_type: 'none', secret_hint: null,
            base_url: 'https://old.example.com/ollama', label: 'My Ollama', status: 'active', last_verified_at: null, models: [],
        }
        service.catalog.mockResolvedValue({ supported: true, fetchedAt: 'x', models: [{ id: 'old-model', name: 'old-model', textCapable: true }] })
        service.updateMyCredential.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
            ...ollamaCredential,
            ...patch,
            auth_type: patch.secret === null ? 'none' : patch.secret ? 'api_key' : ollamaCredential.auth_type,
            models: [],
        }))
        const wrapper = mount(AiCredentialList, { props: { mode: 'personal', modelValue: [ollamaCredential] }, global })
        await flushPromises()
        const modelSelect = wrapper.findComponent({ name: 'SearchableSelect' })
        await modelSelect.vm.$emit('update:modelValue', 'old-model')
        expect(modelSelect.props('modelValue')).toBe('old-model')

        const urlForm = wrapper.findAll('form').find((form) => form.find('input[type="url"]').exists())!
        await urlForm.find('input[type="url"]').setValue('https://new.example.com/prefix')
        await urlForm.trigger('submit')
        await flushPromises()
        expect(service.updateMyCredential).toHaveBeenCalledWith('personal-ollama', { base_url: 'https://new.example.com/prefix' })
        expect(service.catalog).toHaveBeenLastCalledWith('personal', 'personal-ollama', true)
        expect(modelSelect.props('modelValue')).toBe('')

        const tokenForm = wrapper.findAll('form').find((form) => form.find('input[type="password"]').exists())!
        await tokenForm.find('input[type="password"]').setValue('new-bearer-token')
        await tokenForm.trigger('submit')
        await flushPromises()
        expect(service.updateMyCredential).toHaveBeenLastCalledWith('personal-ollama', { secret: 'new-bearer-token' })
        expect(service.catalog).toHaveBeenLastCalledWith('personal', 'personal-ollama', true)

        const removeToken = wrapper.findAll('button').find((button) => button.text().includes('移除 token'))!
        await removeToken.trigger('click')
        await flushPromises()
        expect(service.updateMyCredential).toHaveBeenLastCalledWith('personal-ollama', { secret: null })
    })
})
