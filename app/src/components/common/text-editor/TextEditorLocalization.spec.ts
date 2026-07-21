import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import TextEditorToolbar from './TextEditorToolbar.vue'
import TextEditorSettingsPanel from './TextEditorSettingsPanel.vue'
import CopyTemplateEditorModal from '@/components/common/CopyTemplateEditorModal.vue'
import enEditor from '@/locales/en/editor.json'
import zhEditor from '@/locales/zh-TW/editor.json'
import type { TextEditorFormattingState } from './types'

function createEditorI18n(locale: 'en' | 'zh-TW' = 'en') {
    return createI18n({
        legacy: false,
        locale,
        fallbackLocale: 'en',
        messages: { en: { editor: enEditor }, 'zh-TW': { editor: zhEditor } }
    })
}

const formattingState: TextEditorFormattingState = {
    bold: false, italic: false, underline: false, strike: false, paragraph: true,
    headingLevel: null, bulletList: false, orderedList: false, blockquote: false,
    highlight: false, link: false
}

describe('text editor localization', () => {
    it('localizes toolbar labels, tooltips, accessibility names, and link prompt', async () => {
        const i18n = createEditorI18n('en')
        const execute = vi.fn(() => true)
        const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com')
        const wrapper = mount(TextEditorToolbar, {
            props: { state: formattingState, execute, canExecute: () => true },
            global: { plugins: [i18n] }
        })

        expect(wrapper.attributes('aria-label')).toBe('Text formatting')
        expect(wrapper.get('button[aria-label="Bold"]').attributes('title')).toBe('Bold')
        expect(wrapper.text()).toContain('Bullet list')

        await wrapper.get('button[aria-label="Link"]').trigger('click')
        expect(prompt).toHaveBeenCalledWith('Link URL', 'https://')
        expect(execute).toHaveBeenCalledWith('set-link', { href: 'https://example.com' })

        i18n.global.locale.value = 'zh-TW'
        await nextTick()
        expect(wrapper.attributes('aria-label')).toBe('文字格式工具列')
        expect(wrapper.get('button[aria-label="粗體"]').attributes('title')).toBe('粗體')
        expect(wrapper.text()).toContain('項目清單')
        expect(wrapper.text()).toContain('移除連結')
    })

    it('localizes style controls and preset names after a runtime locale switch', async () => {
        const i18n = createEditorI18n('zh-TW')
        const wrapper = mount(TextEditorSettingsPanel, {
            props: {
                preset: 'report',
                style: { minHeight: 300, fontScale: 100, mono: false, resize: 'vertical', padding: '1rem', borderRadius: '.5rem', lineHeight: 1.7 }
            },
            global: { plugins: [i18n] }
        })

        expect(wrapper.text()).toContain('樣式控制')
        expect(wrapper.text()).toContain('報告')
        expect(wrapper.get('button').text()).toBe('重設')

        i18n.global.locale.value = 'en'
        await nextTick()
        expect(wrapper.text()).toContain('Style controls')
        expect(wrapper.text()).toContain('Report')
        expect(wrapper.get('button').text()).toBe('Reset')
    })

    it('localizes template editor badges and variable count', async () => {
        const i18n = createEditorI18n('en')
        const wrapper = mount(CopyTemplateEditorModal, {
            props: {
                modelValue: true,
                title: 'Template', hint: 'Hint', variableTitle: 'Variables', contentTitle: 'Content',
                previewTitle: 'Preview title', previewHint: 'Preview hint', previewEmpty: 'Empty',
                variableCount: 2, cancelText: 'Cancel', saveText: 'Save', savingText: 'Saving'
            },
            global: { plugins: [i18n], stubs: { Teleport: true, TextEditor: true } }
        })

        expect(wrapper.text()).toContain('Editor')
        expect(wrapper.text()).toContain('Preview')
        expect(wrapper.text()).toContain('2 variables')

        i18n.global.locale.value = 'zh-TW'
        await nextTick()
        expect(wrapper.text()).toContain('編輯器')
        expect(wrapper.text()).toContain('預覽')
        expect(wrapper.text()).toContain('2 個變數')
    })
})
