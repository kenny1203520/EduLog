import { apiV1Client } from '@/services/api/ApiV1Client'

export type ExtensionDevice = { installation_id?: string | null; device_name?: string | null; browser_name?: string | null; platform_name?: string | null }
export type ExtensionPairApproval = ExtensionDevice & { id: string; status: 'pending' | 'approved' | 'claimed'; extension_origin: string; expires_at: string; token_id?: string | null }
export type ExtensionToken = ExtensionDevice & { id: string; extension_origin: string; created_at: string; last_used_at: string | null; expires_at: string; revoked_at: string | null }

const fresh = (signal?: AbortSignal) => ({ signal, cache: 'no-store' as RequestCache })

/** The signed-in user's browser-extension connections and pending pair requests. */
export class WebExtensionService {
    static async listTokens(signal?: AbortSignal): Promise<ExtensionToken[]> {
        return (await apiV1Client.get<ExtensionToken[]>('/extension/tokens', fresh(signal))).data ?? []
    }

    /** The pair request awaiting approval, or null once it is gone or expired (404/410). */
    static async getPairApproval(requestId: string, signal?: AbortSignal): Promise<ExtensionPairApproval | null> {
        try {
            return (await apiV1Client.get<ExtensionPairApproval>(`/extension/pair-requests/${encodeURIComponent(requestId)}/approval`, fresh(signal))).data ?? null
        } catch (cause: any) {
            if (cause?.status === 404 || cause?.status === 410) return null
            throw cause
        }
    }

    static async approvePair(requestId: string, deviceName: string): Promise<void> {
        await apiV1Client.post(`/extension/pair-requests/${encodeURIComponent(requestId)}/approve`, { device_name: deviceName })
    }

    static async renameToken(tokenId: string, deviceName: string): Promise<void> {
        await apiV1Client.patch(`/extension/tokens/${encodeURIComponent(tokenId)}`, { device_name: deviceName })
    }

    static async revokeToken(tokenId: string): Promise<void> {
        await apiV1Client.delete(`/extension/tokens/${encodeURIComponent(tokenId)}`)
    }
}
