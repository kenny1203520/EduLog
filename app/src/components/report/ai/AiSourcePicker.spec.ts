import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import type { ReportAssistSource } from '@/services/ai/ReportAssistService'
import AiSourcePicker from './AiSourcePicker.vue'

const site = (id: string, weight: number, extra: Partial<ReportAssistSource> = {}): ReportAssistSource => ({
    model_row_id: id, model_id: id, display_name: `Model ${id}`, provider: 'ollama', credential_scope: 'site',
    credential_label: 'School', quota_weight: weight, is_default: false, ...extra,
})
const mine: ReportAssistSource = { ...site('mine', 0), credential_scope: 'user', credential_label: 'My key' }

function mountPicker(modelValue: string, quotaRemaining = 2) {
    return mount(AiSourcePicker, {
        props: { sources: [site('a', 1, { compat_mode: true }), site('b', 5), mine], modelValue, quotaRemaining },
        global: { plugins: [i18n] },
    })
}

beforeEach(() => { i18n.global.locale.value = 'zh-TW' })

describe('AiSourcePicker', () => {
    it('groups site and personal sources and shows cost, compatibility and quota tags', () => {
        const wrapper = mountPicker('a')
        expect(wrapper.text()).toContain('站台')
        expect(wrapper.text()).toContain('個人')
        const cards = wrapper.findAll('[role="radio"]')
        expect(cards[0].attributes('aria-checked')).toBe('true')
        expect(cards[0].text()).toContain('相容模式')
        expect(cards[1].attributes('aria-disabled')).toBe('true')
        expect(cards[1].text()).toContain('額度不足')
        expect(cards[2].text()).toContain('個人額度')
    })

    it('selects by click and arrow keys, skipping sources the quota cannot cover', async () => {
        const wrapper = mountPicker('a')
        await wrapper.findAll('[role="radio"]')[1].trigger('click')
        expect(wrapper.emitted('update:modelValue')).toBeUndefined()

        await wrapper.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowDown' })
        expect(wrapper.emitted('update:modelValue')).toEqual([['mine']])
        await wrapper.findAll('[role="radio"]')[2].trigger('keydown', { key: 'Enter' })
        expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['mine'])
    })

    it('has one tab stop, on the selected card', () => {
        const tabbable = mountPicker('mine').findAll('[role="radio"]').map((card) => card.attributes('tabindex'))
        expect(tabbable).toEqual(['-1', '-1', '0'])
    })
})
