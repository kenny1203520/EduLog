import { apiV1Client } from '@/services/api/ApiV1Client'

export type PendingAccount = { id: string; email: string | null; provider: string; display_name: string | null; created_at: string }
export type GrantableRole = { id: string; code: string | null; name: string; domain: 'system' | 'teaching' }

/** Review of accounts waiting for approval, invitations and the default roles of new accounts. */
export class AccountApprovalService {
    static async pending(): Promise<{ accounts: PendingAccount[]; default_role_ids: string[] }> {
        return (await apiV1Client.get<{ accounts: PendingAccount[]; default_role_ids: string[] }>('/accounts/pending')).data
    }

    /** 0 and can_review=false for people who cannot review accounts. */
    static async pendingCount(): Promise<{ count: number; can_review: boolean }> {
        return (await apiV1Client.get<{ count: number; can_review: boolean }>('/accounts/pending/count')).data
    }

    static async approve(userId: string, roleIds: string[]): Promise<void> {
        await apiV1Client.post(`/accounts/${userId}/approve`, { role_ids: roleIds })
    }

    static async invite(email: string): Promise<{ id: string; role_ids: string[] }> {
        return (await apiV1Client.post<{ id: string; role_ids: string[] }>('/accounts/invite', { email })).data
    }

    static async defaultRoles(): Promise<{ role_ids: string[]; roles: GrantableRole[] }> {
        return (await apiV1Client.get<{ role_ids: string[]; roles: GrantableRole[] }>('/settings/account-default-roles')).data
    }

    static async saveDefaultRoles(roleIds: string[]): Promise<string[]> {
        return (await apiV1Client.put<{ role_ids: string[] }>('/settings/account-default-roles', { role_ids: roleIds })).data.role_ids
    }
}
