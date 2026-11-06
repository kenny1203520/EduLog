import { apiV1Client } from '@/services/api/ApiV1Client'

export type AccountStatus = 'active' | 'disabled'

/** System-managed account state for another user (requires the account-status permission). */
export class UserAccountService {
    static async updateStatus(userId: string, status: AccountStatus, reason: string | null, expectedEpoch: number | null): Promise<{ account_status: AccountStatus; disabled_at: string | null }> {
        const result = await apiV1Client.patch<{ account_status: AccountStatus; disabled_at: string | null }>(`/users/${userId}/status`, { status, reason, expected_epoch: expectedEpoch })
        return result.data
    }
}
