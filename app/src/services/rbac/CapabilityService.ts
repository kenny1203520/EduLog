import { apiV1Client } from '@/services/api/ApiV1Client'

/** Where a teaching permission holds for the signed-in user. */
export interface CapabilityGrant {
    /** Held in at least one classroom or class session, or platform-wide. */
    any: boolean
    /** Held platform-wide. Needed to change platform data such as courses. */
    platform: boolean
}

export type CapabilityMap = Record<string, CapabilityGrant>

function isGrant(value: unknown): value is CapabilityGrant {
    return Boolean(value) && typeof value === 'object'
        && typeof (value as CapabilityGrant).any === 'boolean'
        && typeof (value as CapabilityGrant).platform === 'boolean'
}

export class CapabilityService {
    /**
     * Reads the teaching capability summary used to build navigation and to
     * show or hide actions. The server still enforces every request.
     */
    static async getMyCapabilities(): Promise<CapabilityMap> {
        const data = (await apiV1Client.get<Record<string, unknown>>('/pages/me/capabilities')).data ?? {}
        const result: CapabilityMap = {}
        for (const [key, value] of Object.entries(data)) {
            if (isGrant(value)) result[key] = { any: value.any, platform: value.platform }
        }
        return result
    }
}
