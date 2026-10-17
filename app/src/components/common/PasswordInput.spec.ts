import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import PasswordInput from './PasswordInput.vue'

function mountPasswordInput() {
    const i18n = createI18n({
        legacy: false,
        locale: 'en',
        messages: { en: { common: { show_password: 'Show password', hide_password: 'Hide password' } } },
    })
    return mount(PasswordInput, {
        props: { modelValue: '', autocomplete: 'new-password' },
        global: { plugins: [i18n] },
    })
}

describe('PasswordInput', () => {
    it('masks the value by default and toggles visibility with an accessible control', async () => {
        const wrapper = mountPasswordInput()
        const input = wrapper.get('input')
        const toggle = wrapper.get('button')

        expect(input.attributes('type')).toBe('password')
        expect(input.attributes('autocomplete')).toBe('new-password')
        expect(toggle.attributes('aria-pressed')).toBe('false')
        expect(toggle.attributes('aria-label')).toBe('Show password')

        await toggle.trigger('click')
        expect(input.attributes('type')).toBe('text')
        expect(toggle.attributes('aria-pressed')).toBe('true')
        expect(toggle.attributes('aria-label')).toBe('Hide password')
    })

    it('emits edits without interfering with native form autocomplete', async () => {
        const wrapper = mountPasswordInput()
        await wrapper.get('input').setValue('secret-value')

        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['secret-value'])
    })
})
