import { supabase } from '@/lib/supabase'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import type { EditorUserSettings } from '@/components/common/text-editor/settings'

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
        if (getApiV1Mode() === 'v1') {
            return (await apiResourceClient.get<UserPreferenceDTO>('user-preferences', 'me', 'v1')).data
        }
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return null

        const { data, error } = await supabase
            .from('user_preferences')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle()

        if (error) throw new Error(error.message)
        return data as UserPreferenceDTO | null
    }

    static async updateCurrentUserTimeZone(timeZone: string): Promise<void> {
        if (getApiV1Mode() === 'v1') {
            await apiResourceClient.update('user-preferences', 'me', { time_zone: timeZone }, 'v1'); return
        }
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { error } = await supabase
            .from('user_preferences')
            .upsert({ user_id: user.id, time_zone: timeZone }, { onConflict: 'user_id' })

        if (error) throw new Error(error.message)
    }

    static async updateCurrentUserEditorSettings(editorSettings: EditorUserSettings): Promise<void> {
        if (getApiV1Mode() === 'v1') {
            await apiResourceClient.update('user-preferences', 'me', { editor_settings: editorSettings }, 'v1'); return
        }
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { error } = await supabase
            .from('user_preferences')
            .upsert({ user_id: user.id, editor_settings: editorSettings }, { onConflict: 'user_id' })
        if (error) throw new Error(error.message)
    }
}
