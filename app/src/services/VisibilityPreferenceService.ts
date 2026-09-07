import { supabase } from '@/lib/supabase'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

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
        if (getApiV1Mode() === 'v1') {
            const response = await apiResourceClient.list<EntityVisibilityPreferenceDTO>('visibility-preferences', { mode: 'v1', search: entityIds?.join(',') }); return new Set((response.data || []).filter((row) => row.is_hidden && row.entity_type === entityType).map((row) => row.entity_id))
        }
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
        if (getApiV1Mode() === 'v1') {
            const existing = await apiResourceClient.list<EntityVisibilityPreferenceDTO>('visibility-preferences', { mode: 'v1', search: entityId }); const row = existing.data?.find((candidate) => candidate.entity_id === entityId && candidate.entity_type === entityType); if (isHidden && !row) await apiResourceClient.create('visibility-preferences', { entity_type: entityType, entity_id: entityId, is_hidden: true }, 'v1'); if (!isHidden && row?.id) await apiResourceClient.remove('visibility-preferences', row.id, 'v1'); return
        }
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
