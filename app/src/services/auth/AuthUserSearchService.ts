import { supabase } from '@/lib/supabase'

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