import { supabase } from '@/lib/supabase'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

export interface AuthUserSearchResultDTO {
    id: string
    email: string
    created_at?: string
    last_sign_in_at?: string | null
}

export class AuthUserSearchService {
    /**
     * Search Supabase Auth users by email fragment.
     */
    static async searchUsersByEmail(query: string, options?: { onlyUnlinked?: boolean }): Promise<AuthUserSearchResultDTO[]> {
        const normalizedQuery = query.trim()

        if (getApiV1Mode() === 'v1') {
            if (!normalizedQuery) return []
            const params = new URLSearchParams({ query: normalizedQuery })
            if (options?.onlyUnlinked) params.set('only_unlinked', 'true')
            const response = await apiV1Client.get<AuthUserSearchResultDTO[]>(/users/search?)
            return response.data || []
        }

        if (!normalizedQuery) return []

        const payload: any = { query: normalizedQuery }
        if (options?.onlyUnlinked) payload.only_unlinked = true

        const { data, error } = await supabase.functions.invoke('user-search', {
            body: payload
        })

        if (error) throw new Error(error.message)

        return ((data as { users?: AuthUserSearchResultDTO[] } | null)?.users ?? []).filter(
            (user) => Boolean(user.id && user.email)
        )
    }
}