import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ToggleSwitch from './ToggleSwitch.vue'

function mountSwitch(props: { modelValue: boolean, disabled?: boolean }) {
    return mount(ToggleSwitch, { props: { label: '啟用模型 Gemma', ...props } })
}

describe('ToggleSwitch', () => {
    it('is a labelled switch button that reports its state', () => {
        const button = mountSwitch({ modelValue: true }).get('button')
        expect(button.attributes()).toMatchObject({ type: 'button', role: 'switch', 'aria-checked': 'true', 'aria-label': '啟用模型 Gemma' })
        expect(mountSwitch({ modelValue: false }).get('button').attributes('aria-checked')).toBe('false')
    })

    it('emits the flipped value when clicked', async () => {
        const wrapper = mountSwitch({ modelValue: false })
        await wrapper.get('button').trigger('click')
        expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    })

    it('does nothing while disabled', async () => {
        const wrapper = mountSwitch({ modelValue: true, disabled: true })
        const button = wrapper.get('button')
        expect(button.attributes('disabled')).toBeDefined()
        await button.trigger('click')
        expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })
})
