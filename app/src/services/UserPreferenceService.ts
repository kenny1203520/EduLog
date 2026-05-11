import { supabase } from '@/lib/supabase'

export interface UserPreferenceDTO {
    id?: string
    user_id?: string
    time_zone: string
    created_at?: string
    updated_at?: string
}

export class UserPreferenceService {
    static async getCurrentUserPreferences(): Promise<UserPreferenceDTO | null> {
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
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { error } = await supabase
            .from('user_preferences')
            .upsert({ user_id: user.id, time_zone: timeZone }, { onConflict: 'user_id' })

        if (error) throw new Error(error.message)
    }
}
