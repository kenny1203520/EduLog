import { apiResourceClient } from '@/services/api/ApiResourceClient'
import type { EditorUserSettings } from '@/components/text-editor/settings'

export interface UserPreferenceDTO {
    id?: string
    user_id?: string
    time_zone: string
    editor_settings?: EditorUserSettings
    created_at?: string
    updated_at?: string
}

export class UserPreferenceService {
    static async getCurrentUserPreferences(): Promise<UserPreferenceDTO | null> {
        try { return (await apiResourceClient.get<UserPreferenceDTO>('user-preferences', 'me')).data } catch (error) { if ((error as any)?.status === 404) return null; throw error }
    }
    static async updateCurrentUserTimeZone(timeZone: string): Promise<void> {
        await apiResourceClient.update('user-preferences', 'me', { time_zone: timeZone })
    }
    static async updateCurrentUserEditorSettings(editorSettings: EditorUserSettings): Promise<void> {
        await apiResourceClient.update('user-preferences', 'me', { editor_settings: editorSettings })
    }
}