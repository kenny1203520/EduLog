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

        await wrapper.findAll('button').find((button) => button.text() === '全部取代學習報告')!.trigger('click')
        expect(wrapper.emitted('replace')).toBeUndefined()
        expect(wrapper.text()).toContain('取代學習報告？')
    })

    it('lists earlier generations and opens one in the result area', async () => {
        service.bootstrap.mockResolvedValue(bootstrap())
        service.history.mockResolvedValue([
            { generation_id: 'g2', status: 'failed', created_at: '2026-10-20T09:00:00Z', completed_at: '2026-10-20T09:00:05Z', provider: 'ollama', model_id: 'qwen', error_code: 'TIMEOUT', quota_charged: 0, draft: null, unresolved_placeholders: [], suggestion_states: {}, adoption_count: 0 },
            { generation_id: 'g1', status: 'succeeded', created_at: '2026-10-20T08:00:00Z', completed_at: '2026-10-20T08:00:20Z', provider: 'ollama', model_id: 'qwen', error_code: null, quota_charged: 1, draft: { sections: [{ key: 'today', title: '今日學習', body: '先前的版本' }], teachingSuggestions: [] }, unresolved_placeholders: [], suggestion_states: {}, adoption_count: 1 },
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

        await entries[1].findAll('button').find((button) => button.text().startsWith('開啟此版本'))!.trigger('click')
        expect(wrapper.find('#ai-tab-generate').attributes('aria-selected')).toBe('true')
        expect(wrapper.text()).toContain('先前的版本')
    })
})
