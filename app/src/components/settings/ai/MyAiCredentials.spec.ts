import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import MyAiCredentials from './MyAiCredentials.vue'

const service = vi.hoisted(() => ({
    myCredentials: vi.fn(),
    addMyCredential: vi.fn(),
    finishOpenRouter: vi.fn(),
    startOpenRouter: vi.fn(),
    finishChatGpt: vi.fn(),
    startChatGpt: vi.fn(),
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
    sessionStorage.clear()
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

    it('finishes an OpenRouter sign-in when OpenRouter dropped our query and only ?code= came back', async () => {
        sessionStorage.setItem('edulog.aiOAuthPending', JSON.stringify({ flow: 'openrouter', startedAt: Date.now() - 60_000 }))
        route.query = { code: 'c2af0bce' }
        service.finishOpenRouter.mockResolvedValue({ id: 'c1' })
        mount(MyAiCredentials, { global: { plugins: [i18n] } })
        await flushPromises()

        expect(replace).toHaveBeenCalledWith({ query: { tab: 'personal' } })
        expect(service.finishOpenRouter).toHaveBeenCalledWith('c2af0bce')
        expect(sessionStorage.getItem('edulog.aiOAuthPending')).toBeNull()
    })

    it('ignores a ?code= without a recent sign-in from this tab', async () => {
        route.query = { code: 'unrelated' }
        mount(MyAiCredentials, { global: { plugins: [i18n] } })
        await flushPromises()

        sessionStorage.setItem('edulog.aiOAuthPending', JSON.stringify({ flow: 'openrouter', startedAt: Date.now() - 11 * 60_000 }))
        mount(MyAiCredentials, { global: { plugins: [i18n] } })
        await flushPromises()

        expect(service.finishOpenRouter).not.toHaveBeenCalled()
        expect(replace).not.toHaveBeenCalled()
        expect(sessionStorage.getItem('edulog.aiOAuthPending')).toBeNull()
    })

    it('remembers the flow before leaving for OpenRouter', async () => {
        service.startOpenRouter.mockResolvedValue('https://openrouter.ai/auth?x=1')
        const assign = vi.fn()
        vi.stubGlobal('location', { ...window.location, assign })
        const wrapper = mount(MyAiCredentials, { global: { plugins: [i18n] } })
        await flushPromises()
        await wrapper.find('[data-testid="connect-openrouter"]').trigger('click')
        await flushPromises()

        expect(assign).toHaveBeenCalledWith('https://openrouter.ai/auth?x=1')
        expect(JSON.parse(sessionStorage.getItem('edulog.aiOAuthPending')!).flow).toBe('openrouter')
        vi.unstubAllGlobals()
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

    it('adds a public Ollama endpoint with no token when the optional token is blank', async () => {
        service.addMyCredential.mockResolvedValue({ id: 'ollama-1', provider: 'ollama', base_url: 'https://ollama.example.com/prefix', auth_type: 'none', models: [] })
        const wrapper = mount(MyAiCredentials, { global: { plugins: [i18n] } })
        await flushPromises()
        await wrapper.find('select').setValue('ollama')
        await wrapper.find('input[type="url"]').setValue('https://ollama.example.com/prefix')
        await wrapper.find('form').trigger('submit')
        await flushPromises()

        expect(service.addMyCredential).toHaveBeenCalledWith({ provider: 'ollama', label: 'Ollama', base_url: 'https://ollama.example.com/prefix' })
        expect(wrapper.text()).toContain('Ollama')
    })
})

describe('MyAiCredentials with ChatGPT', () => {
    it('hides the ChatGPT card until the server offers it', async () => {
        const wrapper = mount(MyAiCredentials, { global: { plugins: [i18n] } })
        await flushPromises()
        expect(wrapper.find('[data-testid="connect-chatgpt"]').exists()).toBe(false)

        service.myCredentials.mockResolvedValue({ credentials: [], secret_storage_available: true, chatgpt_available: true })
        const enabled = mount(MyAiCredentials, { global: { plugins: [i18n] } })
        await flushPromises()
        expect(enabled.find('[data-testid="connect-chatgpt"]').exists()).toBe(true)
    })

    it('finishes a ChatGPT sign-in with the returned code and state', async () => {
        route.query = { tab: 'personal', ai_oauth: 'chatgpt', code: 'abc', state: 'st-1' }
        service.finishChatGpt.mockResolvedValue({ id: 'c1' })
        mount(MyAiCredentials, { global: { plugins: [i18n] } })
        await flushPromises()

        expect(replace).toHaveBeenCalledWith({ query: { tab: 'personal' } })
        expect(service.finishChatGpt).toHaveBeenCalledWith('abc', 'st-1')
        expect(feedback.success).toHaveBeenCalledWith('ai.settings.chatgpt_connected')
    })
})
