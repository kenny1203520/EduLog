import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LanguageSwitcher from './LanguageSwitcher.vue'

const preferences = reactive({ locale: 'zh-TW' })

vi.mock('@/stores/usePreferencesStore', () => ({ usePreferencesStore: () => preferences }))
vi.mock('vue-i18n', () => ({
    useI18n: () => ({
        t: (key: string) => ({
            'common.language': 'Language',
            'common.languages.zh-TW': '繁體中文',
            'common.languages.en': 'English'
        }[key] || key)
    })
}))

describe('LanguageSwitcher', () => {
    beforeEach(() => { preferences.locale = 'zh-TW' })

    it('opens an accessible menu and changes locale without navigation', async () => {
        const wrapper = mount(LanguageSwitcher, { attachTo: document.body })
        const trigger = wrapper.get('button[aria-haspopup="menu"]')
        expect(trigger.attributes('aria-label')).toContain('繁體中文')

        await trigger.trigger('click')
        const menu = document.body.querySelector('[role="menu"]') as HTMLElement
        expect(menu).toBeTruthy()
        const english = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
            .find(button => button.textContent?.includes('English'))!
        english.click()
        await wrapper.vm.$nextTick()

        expect(preferences.locale).toBe('en')
        expect(wrapper.get('button[aria-haspopup="menu"]').attributes('aria-label')).toContain('English')
        wrapper.unmount()
    })

    it('supports keyboard opening and Escape focus restoration', async () => {
        const wrapper = mount(LanguageSwitcher, { attachTo: document.body })
        const trigger = wrapper.get('button[aria-haspopup="menu"]')
        await trigger.trigger('keydown', { key: 'ArrowDown' })
        expect(document.body.querySelector('[role="menu"]')).toBeTruthy()
        const first = document.body.querySelector('[role="menuitemradio"]') as HTMLButtonElement
        await first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await wrapper.vm.$nextTick()
        expect(document.body.querySelector('[role="menu"]')).toBeFalsy()
        expect(document.activeElement).toBe(trigger.element)
        wrapper.unmount()
    })
})
