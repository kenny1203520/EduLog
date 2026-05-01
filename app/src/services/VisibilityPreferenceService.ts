import { supabase } from '@/lib/supabase'

export type VisibilityEntityType = 'classroom' | 'class_session'

export interface EntityVisibilityPreferenceDTO {
    id?: string
    user_id?: string
    entity_type: VisibilityEntityType
    entity_id: string
    is_hidden: boolean
    created_at?: string
    updated_at?: string
}

export class VisibilityPreferenceService {
    static async getHiddenEntityIds(entityType: VisibilityEntityType, entityIds?: string[]): Promise<Set<string>> {
        let query = supabase
            .from('user_entity_visibility_preferences')
            .select('entity_id')
            .eq('entity_type', entityType)
            .eq('is_hidden', true)

        if (entityIds && entityIds.length > 0) {
            query = query.in('entity_id', entityIds)
        }

        const { data, error } = await query

        if (error) throw new Error(error.message)

        return new Set((data || []).map((row: any) => row.entity_id as string))
    }

    static async setEntityHidden(entityType: VisibilityEntityType, entityId: string, isHidden: boolean): Promise<void> {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('User not authenticated')

        if (!isHidden) {
            const { error } = await supabase
                .from('user_entity_visibility_preferences')
                .delete()
                .eq('user_id', user.id)
                .eq('entity_type', entityType)
                .eq('entity_id', entityId)

            if (error) throw new Error(error.message)
            return
        }

        const payload: EntityVisibilityPreferenceDTO = {
            user_id: user.id,
            entity_type: entityType,
            entity_id: entityId,
            is_hidden: true
        }

        const { error } = await supabase
            .from('user_entity_visibility_preferences')
            .upsert(payload, { onConflict: 'user_id,entity_type,entity_id' })

        if (error) throw new Error(error.message)
    }
}
