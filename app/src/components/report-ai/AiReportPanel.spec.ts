import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import AiReportPanel from './AiReportPanel.vue'

const service = vi.hoisted(() => ({
    bootstrap: vi.fn(),
    preview: vi.fn(),
    acknowledgeNotice: vi.fn(),
    savePreferences: vi.fn(),
    setSuggestionState: vi.fn(),
    recordAdoption: vi.fn(),
    generate: vi.fn(),
    history: vi.fn(),
    cancel: vi.fn(),
}))
vi.mock('@/services/ai/ReportAssistService', () => ({ ReportAssistService: service }))

const source = { model_row_id: 'm1', model_id: 'sonnet', display_name: 'Sonnet', provider: 'anthropic', credential_scope: 'site', credential_label: 'School', quota_weight: 1, is_default: true }

function bootstrap(acknowledged = true) {
    return {
        enabled: true, notice: { version: 1, acknowledged }, default_model_row_id: 'm1', sources: [source],
        quota: { remaining: 3, periodic: null, one_time: { total: 3, used: 0, remaining: 3 } },
        warnings: ['thin_class_notes'], kept_suggestions: [], latest: null, preferences: {},
    }
}

function mountPanel(props: Record<string, unknown> = {}) {
    return mount(AiReportPanel, {
        props: { show: true, reportId: 'r1', ...props },
        global: { plugins: [i18n], stubs: { teleport: true } },
    })
}

beforeEach(() => {
    vi.clearAllMocks()
    i18n.global.locale.value = 'zh-TW'
    service.recordAdoption.mockResolvedValue(undefined)
    service.savePreferences.mockResolvedValue(undefined)
    service.generate.mockResolvedValue({
        generation_id: 'g1',
        draft: { sections: [{ key: 'today', title: '今日學習', body: '王小明完成迴圈。' }], teachingSuggestions: ['下次換座位'] },
        unresolved_placeholders: [], quota_charged: 1, quota_remaining: 2,
    })
})

describe('AiReportPanel', () => {
    it('asks for the usage notice before showing generation controls', async () => {
        service.bootstrap.mockResolvedValue(bootstrap(false))
        service.acknowledgeNotice.mockResolvedValue(undefined)
        const wrapper = mountPanel()
        await flushPromises()

        expect(wrapper.text()).toContain('使用前請先閱讀')
        expect(wrapper.text()).not.toContain('生成報告草稿')
        await wrapper.findAll('button').find((button) => button.text() === '我已了解，開始使用')!.trigger('click')
        await flushPromises()
        expect(service.acknowledgeNotice).toHaveBeenCalled()
        expect(wrapper.text()).toContain('生成報告草稿')
    })

    it('generates after saving, shows sections and internal suggestions, and inserts a section', async () => {
        service.bootstrap.mockResolvedValue(bootstrap())
        const beforeGenerate = vi.fn().mockResolvedValue(true)
        const wrapper = mountPanel({ beforeGenerate })
        await flushPromises()

        expect(wrapper.text()).toContain('課堂筆記內容較少')
        await wrapper.findAll('button').find((button) => button.text().includes('生成報告草稿'))!.trigger('click')
        await flushPromises()

        expect(beforeGenerate).toHaveBeenCalled()
        expect(wrapper.text()).toContain('王小明完成迴圈。')
        expect(wrapper.text()).toContain('下次換座位')
        expect(wrapper.text()).toContain('僅內部')

        await wrapper.findAll('button').find((button) => button.text() === '插入')!.trigger('click')
        expect(wrapper.emitted('insert')).toEqual([['王小明完成迴圈。']])
        expect(service.recordAdoption).toHaveBeenCalledWith('g1', 'today', 'insert')
    })

    it('confirms before replacing existing report text', async () => {
        service.bootstrap.mockResolvedValue(bootstrap())
        const wrapper = mountPanel({ hasContent: true })
        await flushPromises()
        await wrapper.findAll('button').find((button) => button.text().includes('生成報告草稿'))!.trigger('click')
        await flushPromises()

        await wrapper.find('[data-testid="ai-more"]').trigger('click')
        await wrapper.find('[data-testid="ai-replace-all"]').trigger('click')
        expect(wrapper.emitted('replace')).toBeUndefined()
        expect(wrapper.text()).toContain('取代學習報告？')
    })

    it('puts the result first, folds the settings into a summary and keeps the action at the bottom', async () => {
        service.bootstrap.mockResolvedValue({ ...bootstrap(), kept_suggestions: [{ generationId: 'old', date: '2026-10-13', suggestions: ['換座位'] }] })
        const wrapper = mountPanel()
        await flushPromises()

        // Before any result: settings open, kept suggestions under the focus field, button in the bottom bar.
        expect(wrapper.find('[data-testid="ai-settings-toggle"]').attributes('aria-expanded')).toBe('true')
        expect(wrapper.find('#ai-settings-body [data-testid="ai-kept-suggestions"]').exists()).toBe(true)
        expect(wrapper.find('footer [data-testid="ai-generate"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="ai-quota-left"]').text()).toBe('剩 3 次')

        await wrapper.find('[data-testid="ai-generate"]').trigger('click')
        await flushPromises()

        const tabPanel = wrapper.find('#ai-tab-panel')
        expect(tabPanel.element.firstElementChild?.getAttribute('aria-labelledby')).toBe('ai-result-title')
        expect(wrapper.find('[data-testid="ai-settings-toggle"]').attributes('aria-expanded')).toBe('false')
        expect(wrapper.find('[data-testid="ai-settings-summary"]').text()).toContain('Sonnet')
        expect(wrapper.find('[data-testid="ai-version-label"]').text()).toBe('第 1 版／共 1 版')
        expect(wrapper.find('section[aria-labelledby="ai-result-title"] [data-testid="ai-kept-suggestions"]').exists()).toBe(true)

        await wrapper.find('[data-testid="ai-settings-toggle"]').trigger('click')
        expect(wrapper.find('#ai-settings-body').exists()).toBe(true)
    })

    it('shows placeholders for sections still being written and a stop button', async () => {
        service.bootstrap.mockResolvedValue(bootstrap())
        let finish: (() => void) | undefined
        service.generate.mockImplementationOnce((_id: string, _body: unknown, hooks: { onPartial?: (draft: unknown) => void }) => new Promise((resolve) => {
            hooks.onPartial?.({ sections: [{ key: 'today', title: '今日學習', body: '王小明' }] })
            finish = () => resolve({ generation_id: 'g1', draft: { sections: [{ key: 'today', title: '今日學習', body: '王小明完成迴圈。' }], teachingSuggestions: [] }, unresolved_placeholders: [], quota_charged: 1, quota_remaining: 2 })
        }))
        const wrapper = mountPanel()
        await flushPromises()
        await wrapper.find('[data-testid="ai-generate"]').trigger('click')
        await flushPromises()

        expect(wrapper.findAll('[data-testid="ai-section-skeleton"]')).toHaveLength(2)
        expect(wrapper.find('[data-testid="ai-stop"]').exists()).toBe(true)
        expect(wrapper.text()).toContain('生成中，內容會逐段出現')
        finish!()
        await flushPromises()
        expect(wrapper.findAll('[data-testid="ai-section-skeleton"]')).toHaveLength(0)
    })

    it('explains errors above the button and keeps the AI service reply under details', async () => {
        service.bootstrap.mockResolvedValue(bootstrap())
        const { ApiV1Error } = await import('@/services/api/ApiV1Client')
        service.generate.mockRejectedValueOnce(new ApiV1Error(502, { error: { code: 'AI_RATE_LIMITED', message: '', request_id: '', trace_id: '', details: { reason: 'HTTP 429 – Rate limit exceeded' } } }))
        const wrapper = mountPanel()
        await flushPromises()
        await wrapper.find('[data-testid="ai-generate"]').trigger('click')
        await flushPromises()

        const notice = wrapper.find('footer [data-testid="ai-notice"]')
        expect(notice.attributes('role')).toBe('alert')
        expect(notice.text()).toContain('限流')
        expect(notice.find('details').text()).toContain('HTTP 429 – Rate limit exceeded')
    })

    it('lists earlier generations and opens one in the result area', async () => {
        service.bootstrap.mockResolvedValue(bootstrap())
        service.history.mockResolvedValue([
            { generation_id: 'g2', status: 'failed', created_at: '2026-10-20T09:00:00Z', completed_at: '2026-10-20T09:00:05Z', provider: 'ollama', model_id: 'qwen', error_code: 'TIMEOUT', quota_charged: 0, draft: null, unresolved_placeholders: [], suggestion_states: {}, adoption_count: 0, input: { system_prompt: null, prompt_version: 'report.v1', prompt: null }, error_detail: { status: 504, message: null } },
            { generation_id: 'g1', status: 'succeeded', created_at: '2026-10-20T08:00:00Z', completed_at: '2026-10-20T08:00:20Z', provider: 'ollama', model_id: 'qwen', error_code: null, quota_charged: 1, draft: { sections: [{ key: 'today', title: '今日學習', body: '先前的版本' }], teachingSuggestions: [] }, unresolved_placeholders: [], suggestion_states: {}, adoption_count: 1, input: { system_prompt: '系統規則', prompt_version: 'report.v2', prompt: '學生：[學生A]' }, error_detail: null },
        ])
        const wrapper = mountPanel()
        await flushPromises()

        await wrapper.find('#ai-tab-history').trigger('click')
        await flushPromises()
        const entries = wrapper.findAll('[data-testid="ai-history-entry"]')
        expect(entries).toHaveLength(2)
        expect(entries[0].text()).toContain('失敗')
        expect(entries[0].text()).toContain('AI 回應逾時')
        expect(entries[1].text()).toContain('已採用 1 次')
        expect(entries[1].find('[data-testid="ai-history-input"]').text()).toContain('學生：[學生A]')
        expect(entries[0].find('[data-testid="ai-history-input"]').exists()).toBe(false)

        await entries[1].findAll('button').find((button) => button.text().startsWith('開啟此版本'))!.trigger('click')
        expect(wrapper.find('#ai-tab-generate').attributes('aria-selected')).toBe('true')
        expect(wrapper.text()).toContain('先前的版本')
    })

    it('does not close on Escape from an input method or inside a text field', async () => {
        service.bootstrap.mockResolvedValue(bootstrap())
        const wrapper = mount(AiReportPanel, { props: { show: true, reportId: 'r1' }, global: { plugins: [i18n] }, attachTo: document.body })
        await flushPromises()
        const focus = document.body.querySelector<HTMLTextAreaElement>('#ai-settings-body textarea')!
        focus.focus()

        // 注音 / 倉頡: Esc drops the candidate list while composing.
        focus.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))
        expect(wrapper.emitted('close')).toBeUndefined()

        // Inside a field the first Esc only leaves the field…
        focus.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        expect(wrapper.emitted('close')).toBeUndefined()
        expect(document.activeElement).not.toBe(focus)

        // …and the next one closes the panel.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        expect(wrapper.emitted('close')).toHaveLength(1)
        wrapper.unmount()
    })
})
