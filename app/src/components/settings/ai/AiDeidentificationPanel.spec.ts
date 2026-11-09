import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { DeidOverview } from '@/services/ai/AiDeidService'
import AiDeidentificationPanel from './AiDeidentificationPanel.vue'

const service = vi.hoisted(() => ({
    overview: vi.fn(),
    saveLanguages: vi.fn(),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
    saveAllowList: vi.fn(),
    test: vi.fn(),
}))
vi.mock('@/services/ai/AiDeidService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/ai/AiDeidService')>()),
    AiDeidService: service,
}))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => ({ success: vi.fn(), reportError: vi.fn() }) }))

const global = { plugins: [i18n], stubs: { Teleport: true } }

const overview = (): DeidOverview => ({
    connection: 'ok',
    installed_languages: ['zh', 'en'],
    available_languages: ['zh', 'en', 'ja', 'ko'],
    enabled_languages: ['zh'],
    rules: [{ id: 'r1', name: '社團', kind: 'deny_list', entries: ['火箭社'], pattern: null, placeholder_kind: 'organization', languages: [], enabled: true, score: 0.85 }],
    allow_list: ['仁愛'],
})

beforeEach(() => {
    vi.clearAllMocks()
    i18n.global.locale.value = 'zh-TW'
    service.overview.mockResolvedValue(overview())
})

describe('AiDeidentificationPanel', () => {
    it('shows loaded languages and a restart command for the ones to add', async () => {
        const wrapper = mount(AiDeidentificationPanel, { props: {}, global })
        await flushPromises()

        expect(wrapper.find('[data-test="deid-connection"]').text()).toBe('Presidio 連線正常')
        expect(wrapper.text()).toContain('日文（ja） · 未載入')
        const toAdd = wrapper.findAll('input[type="checkbox"]').find((input) => (input.element as HTMLInputElement).value === 'ja')!
        await toAdd.setValue(true)
        expect(wrapper.find('#deid-restart').text()).toBe('EDULOG_PRESIDIO_LANGUAGES=zh,en,ja docker compose up -d presidio-analyzer')
    })

    it('colours and labels each hit in the original and lists where it came from', async () => {
        service.test.mockResolvedValue({
            languages: ['zh', 'en'],
            sanitized: '[學生A]在[機構A]遇到 [人名A]。',
            ignored_exceptions: [],
            spans: [
                { start: 0, end: 3, text: '王小明', kind: 'student', token: '[學生A]', source: 'known', entity_type: 'EDULOG_KNOWN_0', rule_name: null, language: 'zh' },
                { start: 4, end: 7, text: '火箭社', kind: 'organization', token: '[機構A]', source: 'rule', entity_type: 'EDULOG_RULE_0', rule_name: '社團', language: 'zh' },
                { start: 10, end: 20, text: 'Kevin Chen', kind: 'person', token: '[人名A]', source: 'ner', entity_type: 'PERSON', rule_name: null, language: 'en' },
            ],
        })
        const wrapper = mount(AiDeidentificationPanel, { global })
        await flushPromises()
        await wrapper.find('textarea').setValue('王小明在火箭社遇到 Kevin Chen。')
        await wrapper.findAll('form').find((form) => form.text().includes('測試文字'))!.trigger('submit')
        await flushPromises()

        expect(service.test).toHaveBeenCalledWith(expect.objectContaining({
            text: '王小明在火箭社遇到 Kevin Chen。',
            names: [{ kind: 'student', name: '王小明' }, { kind: 'student', name: '陳大文' }, { kind: 'teacher', name: '林雅婷' }],
            rules: undefined,
        }))
        const marks = wrapper.find('[data-test="deid-original"]').findAll('mark')
        expect(marks.map((mark) => mark.attributes('data-kind'))).toEqual(['student', 'organization', 'person'])
        expect(marks.map((mark) => mark.text())).toEqual(['王小明學生', '火箭社機構', 'Kevin Chen人名'])
        expect(marks[0].classes()).toContain('bg-emerald-100')
        expect(wrapper.find('[data-test="deid-original"]').text()).toContain('遇到')
        expect(wrapper.find('[data-test="deid-sanitized"]').text()).toBe('[學生A]在[機構A]遇到 [人名A]。')
        const hits = wrapper.find('[data-test="deid-hits"]').findAll('li').map((item) => item.text())
        expect(hits[0]).toContain('已知名字')
        expect(hits[1]).toContain('自訂規則：社團')
        expect(hits[2]).toContain('自動辨識（PERSON，英文）')
        expect(wrapper.find('[data-test="deid-test-result"]').attributes('aria-live')).toBe('polite')
    })

    it('tests an unsaved draft rule together with the saved rules', async () => {
        service.test.mockResolvedValue({ languages: ['zh'], sanitized: '學號 [敏感A]', ignored_exceptions: [], spans: [] })
        const wrapper = mount(AiDeidentificationPanel, { global })
        await flushPromises()
        await wrapper.findAll('button').find((button) => button.text() === '新增規則')!.trigger('click')
        await wrapper.find('input[value="regex"]').setValue(true)
        await wrapper.find('#deid-pattern').setValue('S\\d{6}')
        await wrapper.findAll('button').find((button) => button.text() === '用草稿測試')!.trigger('click')
        await flushPromises()

        expect(service.test).toHaveBeenCalledWith(expect.objectContaining({
            allow_list: ['仁愛'],
            rules: [
                expect.objectContaining({ name: '社團', kind: 'deny_list', entries: ['火箭社'] }),
                expect.objectContaining({ name: '新增規則', kind: 'regex', pattern: 'S\\d{6}', entries: [], enabled: true }),
            ],
        }))
        expect(service.createRule).not.toHaveBeenCalled()
    })

    it('warns about an invalid pattern while typing', async () => {
        const wrapper = mount(AiDeidentificationPanel, { global })
        await flushPromises()
        await wrapper.findAll('button').find((button) => button.text() === '新增規則')!.trigger('click')
        await wrapper.find('input[value="regex"]').setValue(true)
        await wrapper.find('#deid-pattern').setValue('(unclosed')
        expect(wrapper.find('#deid-pattern-error').text()).toContain('格式有誤')
        await wrapper.find('#deid-pattern').setValue('(?P<id>S\\d+)')
        expect(wrapper.find('#deid-pattern-error').text()).toBe('')
    })
})
