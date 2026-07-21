import type { TextEditorAppearance } from './types'

export interface EditorUserSettings {
    appearance?: Partial<TextEditorAppearance>
    formattingEnabled: boolean
    toolbarVisible: boolean
    styleControlsEnabled: boolean
    autoSave: {
        enabled: boolean
        debounceMs: number
        saveOnBlur: boolean
        saveOnSwitch: boolean
        saveOnUnmount: boolean
    }
    collaboration: {
        enabled: boolean
        snapshotDebounceMs: number
        presenceEnabled: boolean
    }
    notificationsEnabled: boolean
}

export const DEFAULT_EDITOR_USER_SETTINGS: EditorUserSettings = {
    formattingEnabled: true,
    toolbarVisible: true,
    styleControlsEnabled: true,
    autoSave: { enabled: true, debounceMs: 2000, saveOnBlur: false, saveOnSwitch: true, saveOnUnmount: true },
    collaboration: { enabled: true, snapshotDebounceMs: 2500, presenceEnabled: true },
    notificationsEnabled: true
}

export function normalizeEditorUserSettings(value: unknown): EditorUserSettings {
    const input = value && typeof value === 'object' ? value as Partial<EditorUserSettings> : {}
    return {
        ...DEFAULT_EDITOR_USER_SETTINGS,
        ...input,
        appearance: input.appearance ? { ...input.appearance } : undefined,
        autoSave: { ...DEFAULT_EDITOR_USER_SETTINGS.autoSave, ...(input.autoSave || {}) },
        collaboration: { ...DEFAULT_EDITOR_USER_SETTINGS.collaboration, ...(input.collaboration || {}) }
    }
}
