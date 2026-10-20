import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import MyAiCredentials from './MyAiCredentials.vue'

const service = vi.hoisted(() => ({
    myCredentials: vi.fn(),
    addMyCredential: vi.fn(),
    finishOpenRouter: vi.fn(),
    startOpenRouter: vi.fn(),
}))
const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
const replace = vi.hoisted(() => vi.fn())
const feedback = vi.hoisted(() => ({ success: vi.fn(), reportError: vi.fn() }))

vi.mock('@/services/ai/AiSettingsService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/ai/AiSettingsService')>()),
    AiSettingsService: service,
}))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => feedback }))

beforeEach(() => {
    vi.clearAllMocks()
    route.query = {}
    i18n.global.locale.value = 'zh-TW'
    service.myCredentials.mockResolvedValue({ credentials: [], secret_storage_available: true })
})

describe('MyAiCredentials', () => {
    it('finishes an OpenRouter sign-in when returning with a code, and clears the code from the URL first', async () => {
        route.query = { tab: 'personal', ai_oauth: 'openrouter', code: 'abc' }
        service.finishOpenRouter.mockResolvedValue({ id: 'c1' })
        mount(MyAiCredentials, { global: { plugins: [i18n] } })
        await flushPromises()

        expect(replace).toHaveBeenCalledWith({ query: { tab: 'personal' } })
        expect(service.finishOpenRouter).toHaveBeenCalledWith('abc')
        expect(feedback.success).toHaveBeenCalledWith('ai.settings.openrouter_connected')
        expect(service.myCredentials).toHaveBeenCalled()
    })

    it('adds an API key and clears the key field', async () => {
        service.addMyCredential.mockResolvedValue({ id: 'c2', provider: 'openai', label: 'OpenAI', auth_type: 'api_key', secret_hint: 'sk-…abcd', status: 'active', scope: 'user', base_url: null, last_verified_at: null })
        const wrapper = mount(MyAiCredentials, { global: { plugins: [i18n] } })
        await flushPromises()

        await wrapper.find('select').setValue('openai')
        await wrapper.find('input[type="password"]').setValue('sk-test-key')
        await wrapper.find('form').trigger('submit')
        await flushPromises()

        expect(service.addMyCredential).toHaveBeenCalledWith({ provider: 'openai', label: 'OpenAI', secret: 'sk-test-key' })
        expect((wrapper.find('input[type="password"]').element as HTMLInputElement).value).toBe('')
        expect(wrapper.text()).toContain('sk-…abcd')
    })
})
