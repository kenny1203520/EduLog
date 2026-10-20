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
})
