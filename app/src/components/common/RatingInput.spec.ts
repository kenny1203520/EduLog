import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import RatingInput from './RatingInput.vue'

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string) => key })
}))

describe('RatingInput', () => {
    it('shows unrated state and emits a score when selected', async () => {
        const wrapper = mount(RatingInput, { props: { modelValue: null } })
        expect(wrapper.text()).toContain('report.editor.unrated')
        await wrapper.findAll('button')[0].trigger('click')
        expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([0.5])
    })

    it('can clear an existing score back to null', async () => {
        const wrapper = mount(RatingInput, { props: { modelValue: 3 } })
        const clearButton = wrapper.findAll('button').at(-1)
        await clearButton?.trigger('click')
        expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([null])
    })
})
