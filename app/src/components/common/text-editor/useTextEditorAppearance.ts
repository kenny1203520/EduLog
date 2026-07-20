import { computed, type CSSProperties, type Ref } from 'vue'
import {
    TEXT_EDITOR_PRESETS,
    type TextEditorPreset,
    type TextEditorResize
} from './types'

interface AppearanceInput {
    preset: Ref<TextEditorPreset>
    minHeight: Ref<number | undefined>
    fontScale: Ref<number | undefined>
    mono: Ref<boolean | null | undefined>
    resize: Ref<TextEditorResize | undefined>
}

export function useTextEditorAppearance(input: AppearanceInput) {
    const appearance = computed(() => {
        const preset = TEXT_EDITOR_PRESETS[input.preset.value]
        return {
            ...preset,
            minHeight: input.minHeight.value ?? preset.minHeight,
            fontScale: input.fontScale.value ?? preset.fontScale,
            mono: input.mono.value ?? preset.mono,
            resize: input.resize.value ?? preset.resize
        }
    })

    const appearanceStyle = computed<CSSProperties>(() => ({
        '--text-editor-min-height': `${appearance.value.minHeight}px`,
        '--text-editor-font-size': `${appearance.value.fontScale}%`,
        '--text-editor-font-family': appearance.value.mono
            ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace'
            : 'inherit',
        '--text-editor-resize': appearance.value.resize,
        '--text-editor-padding': appearance.value.padding,
        '--text-editor-radius': appearance.value.borderRadius
    }))

    return { appearance, appearanceStyle }
}
