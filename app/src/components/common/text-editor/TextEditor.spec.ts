import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import TextEditor from './TextEditor.vue'

describe('TextEditor', () => {
    it('normalizes line endings and emits the shared change contract', async () => {
        const wrapper = mount(TextEditor, {
            props: { modelValue: 'first\r\nsecond' }
        })
        const input = wrapper.get('textarea')

        expect((input.element as HTMLTextAreaElement).value).toBe('first\nsecond')

        await input.setValue('updated\r\ncontent')

        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['updated\ncontent'])
        expect(wrapper.emitted('change')?.at(-1)).toEqual([{
            value: 'updated\ncontent',
            source: 'local'
        }])
    })

    it('supports silent replacement and selection-aware insertion', async () => {
        const wrapper = mount(TextEditor, {
            props: { modelValue: 'abcd' }
        })
        const handle = wrapper.vm as unknown as {
            replaceText: (value: string) => void
            insertText: (value: string) => void
        }

        handle.replaceText('abcd')
        expect(wrapper.emitted('change')).toBeUndefined()

        const input = wrapper.get('textarea').element as HTMLTextAreaElement
        input.setSelectionRange(1, 3)
        handle.insertText('X')
        await nextTick()

        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['aXd'])
        expect(wrapper.emitted('change')?.at(-1)).toEqual([{ value: 'aXd', source: 'local' }])
    })

    it('resolves preset styles and explicit appearance overrides', () => {
        const wrapper = mount(TextEditor, {
            props: {
                modelValue: '',
                preset: 'template',
                minHeight: 220,
                fontScale: 110,
                mono: false,
                resize: 'none'
            }
        })
        const style = wrapper.attributes('style')

        expect(wrapper.attributes('data-preset')).toBe('template')
        expect(style).toContain('--text-editor-min-height: 220px')
        expect(style).toContain('--text-editor-font-size: 110%')
        expect(style).toContain('--text-editor-font-family: inherit')
        expect(style).toContain('--text-editor-resize: none')
    })

    it('forwards disabled and placeholder state to the native input', () => {
        const wrapper = mount(TextEditor, {
            props: { modelValue: '', disabled: true, placeholder: 'Notes' }
        })

        expect(wrapper.attributes('data-disabled')).toBe('true')
        expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
        expect(wrapper.get('textarea').attributes('placeholder')).toBe('Notes')
    })
})
