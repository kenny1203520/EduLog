import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import TextEditor from './TextEditor.vue'
import { createTextEditorContent } from './content'
import type { TextEditorHandle } from './types'

describe('TextEditor', () => {
    it('upgrades legacy plain text and exposes rich, plain, and HTML content', async () => {
        const wrapper = mount(TextEditor, { props: { modelValue: 'first\r\nsecond', toolbarVisible: false } })
        await nextTick()
        const handle = wrapper.vm as unknown as TextEditorHandle

        expect(handle.getText()).toBe('first\nsecond')
        expect(handle.getJSON().schemaVersion).toBe(1)
        expect(handle.getHTML()).toContain('<p>first</p><p>second</p>')

        handle.replaceText('updated\r\ncontent', { emitChange: true })
        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['updated\ncontent'])
        expect(wrapper.emitted('change')?.at(-1)?.[0]).toMatchObject({ value: 'updated\ncontent', source: 'local' })
    })

    it('supports silent replacement and selection-aware insertion', async () => {
        const wrapper = mount(TextEditor, { props: { modelValue: 'abcd', toolbarVisible: false } })
        await nextTick()
        const handle = wrapper.vm as unknown as TextEditorHandle & { editor: any }

        handle.replaceText('abcd')
        expect(wrapper.emitted('change')).toBeUndefined()

        handle.editor.commands.setTextSelection({ from: 2, to: 4 })
        handle.insertText('X')
        await nextTick()
        expect(handle.getText()).toBe('aXd')
        expect(wrapper.emitted('change')?.at(-1)?.[0]).toMatchObject({ value: 'aXd', source: 'local' })
    })

    it('executes formatting commands and persists document appearance', async () => {
        const wrapper = mount(TextEditor, {
            props: { modelValue: createTextEditorContent('hello'), toolbarVisible: false, preset: 'template' }
        })
        await nextTick()
        const handle = wrapper.vm as unknown as TextEditorHandle & { editor: any }
        handle.editor.commands.selectAll()
        expect(handle.execute('bold')).toBe(true)
        expect(handle.getJSON().doc.content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('bold')

        handle.setStyle({ fontScale: 110, minHeight: 220, mono: false, resize: 'none' })
        await nextTick()
        expect(handle.getJSON().appearance).toMatchObject({ fontScale: 110, minHeight: 220, mono: false, resize: 'none' })
        expect(wrapper.attributes('style')).toContain('--text-editor-font-size: 110%')
    })

    it('supports read and disabled modes plus placeholder state', async () => {
        const wrapper = mount(TextEditor, {
            props: { modelValue: '', disabled: true, placeholder: 'Notes', toolbarVisible: false }
        })
        await nextTick()
        const handle = wrapper.vm as unknown as TextEditorHandle

        expect(wrapper.attributes('data-disabled')).toBe('true')
        expect(wrapper.text()).toContain('Notes')
        expect(handle.getMode()).toBe('disabled')
        handle.setMode('read')
        expect(handle.getMode()).toBe('read')
        expect(handle.execute('bold')).toBe(false)
    })
})
