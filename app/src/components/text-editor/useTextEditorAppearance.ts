import { computed, type CSSProperties, type Ref } from 'vue'
import {
    type TextEditorAppearance,
    type TextEditorPreset,
    type TextEditorResize
} from './types'
import { resolveTextEditorAppearance } from './content'

interface AppearanceInput {
    preset: Ref<TextEditorPreset>
    minHeight: Ref<number | undefined>
    fontScale: Ref<number | undefined>
    mono: Ref<boolean | null | undefined>
    resize: Ref<TextEditorResize | undefined>
    lineHeight?: Ref<number | undefined>
    documentAppearance?: Ref<Partial<TextEditorAppearance> | undefined>
}

export function useTextEditorAppearance(input: AppearanceInput) {
    const appearance = computed(() => {
        return resolveTextEditorAppearance(input.preset.value, input.documentAppearance?.value, {
            minHeight: input.minHeight.value,
            fontScale: input.fontScale.value,
            mono: input.mono.value ?? undefined,
            resize: input.resize.value,
            lineHeight: input.lineHeight?.value
        })
    })

    const appearanceStyle = computed<CSSProperties>(() => ({
        '--text-editor-min-height': `${appearance.value.minHeight}px`,
        '--text-editor-font-size': `${appearance.value.fontScale}%`,
        '--text-editor-font-family': appearance.value.mono
            ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace'
            : 'inherit',
        '--text-editor-resize': appearance.value.resize,
        '--text-editor-padding': appearance.value.padding,
        '--text-editor-radius': appearance.value.borderRadius,
        '--text-editor-line-height': String(appearance.value.lineHeight)
    }))

    return { appearance, appearanceStyle }
}
