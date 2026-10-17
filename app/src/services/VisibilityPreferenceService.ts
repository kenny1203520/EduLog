import { apiResourceClient } from '@/services/api/ApiResourceClient'

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
        const response = await apiResourceClient.list<EntityVisibilityPreferenceDTO>('visibility-preferences', { perPage: 100, entityType, entityIds })
        return new Set((response.data || []).filter((row) => row.is_hidden && row.entity_type === entityType && (!entityIds?.length || entityIds.includes(row.entity_id))).map((row) => row.entity_id))
    }

    static async setEntityHidden(entityType: VisibilityEntityType, entityId: string, isHidden: boolean): Promise<void> {
        const existing = await apiResourceClient.list<EntityVisibilityPreferenceDTO>('visibility-preferences', { perPage: 100, entityType, entityId })
        const row = existing.data?.find((candidate) => candidate.entity_id === entityId && candidate.entity_type === entityType)
        if (isHidden && !row) await apiResourceClient.create('visibility-preferences', { entity_type: entityType, entity_id: entityId, is_hidden: true })
        if (!isHidden && row?.id) await apiResourceClient.remove('visibility-preferences', row.id)
    }
}