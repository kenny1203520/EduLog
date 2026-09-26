import { apiV1Client } from '@/services/api/ApiV1Client'

export interface AuthUserSearchResultDTO {
    id: string
    email: string
    display_name?: string | null
    account_status?: 'active' | 'disabled' | null
    created_at?: string
    last_sign_in_at?: string | null
}

export class AuthUserSearchService {
    static async searchUsers(query: string, options?: { onlyUnlinked?: boolean }): Promise<AuthUserSearchResultDTO[]> {
        const normalizedQuery = query.trim()
        if (!normalizedQuery) return []
        const params = new URLSearchParams({ query: normalizedQuery })
        if (options?.onlyUnlinked) params.set('only_unlinked', 'true')
        const response = await apiV1Client.get<AuthUserSearchResultDTO[]>(`/users/search?${params.toString()}`)
        return response.data || []
    }

    static async searchUsersByEmail(query: string, options?: { onlyUnlinked?: boolean }): Promise<AuthUserSearchResultDTO[]> {
        return this.searchUsers(query, options)
    }
}
