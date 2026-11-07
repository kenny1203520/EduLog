import { apiV1Client } from '@/services/api/ApiV1Client'

export type TeacherLinkProfile = {
    id: string
    auth_user_id: string | null
    profile_version: number
    full_name: string | null
    nickname: string | null
    contact_email: string | null
    phone: string | null
    government_id: string | null
    address: string | null
    mailing_address: string | null
    birthday: string | null
    bio: string | null
    bio_document: unknown
}

export type TeacherLinkField = keyof Pick<TeacherLinkProfile, 'full_name' | 'nickname' | 'contact_email' | 'phone' | 'government_id' | 'address' | 'mailing_address' | 'birthday' | 'bio' | 'bio_document'>
export type TeacherLinkOwnership = Record<TeacherLinkField, 'account' | 'teacher' | 'target' | null>

export type TeacherAccountLinkPreview = { current_profile: TeacherLinkProfile | null; target_profile: TeacherLinkProfile | null }

export type TeacherAccountLinkRequest = {
    target_auth_user_id: string | null
    expected_profile_id: string
    expected_profile_version: number
    expected_target_profile_id: string | null
    expected_target_version: number | null
    field_ownership: TeacherLinkOwnership
}

/** Links a teacher record to a sign-in account and decides which profile keeps each field. */
export class TeacherAccountLinkService {
    static async preview(teacherId: string, targetAuthUserId?: string | null): Promise<TeacherAccountLinkPreview> {
        const query = targetAuthUserId ? `?target_auth_user_id=${encodeURIComponent(targetAuthUserId)}` : ''
        const response = await apiV1Client.get<TeacherAccountLinkPreview>(`/teachers/${encodeURIComponent(teacherId)}/account-link${query}`)
        return { current_profile: response.data?.current_profile ?? null, target_profile: response.data?.target_profile ?? null }
    }

    static async link(teacherId: string, request: TeacherAccountLinkRequest): Promise<void> {
        await apiV1Client.patch(`/teachers/${encodeURIComponent(teacherId)}/account-link`, request)
    }
}
