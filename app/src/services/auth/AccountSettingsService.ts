import { apiV1Client } from '@/services/api/ApiV1Client'
import type { SettingsOverview } from '@/models/Rbac'

export type PersonProfileForm = {
    full_name?: string | null
    nickname?: string | null
    display_name?: string | null
    contact_email?: string | null
    phone?: string | null
    address?: string | null
    mailing_address?: string | null
    birthday?: string | null
    government_id?: string | null
    bio?: string | null
    bio_document?: Record<string, unknown> | null
}

const PERSON_PROFILE_FIELDS = ['full_name', 'nickname', 'contact_email', 'phone', 'address', 'mailing_address', 'birthday', 'government_id', 'bio', 'bio_document'] as const

/** The signed-in user's own settings page: capabilities, person profile and sign-in credentials. */
export class AccountSettingsService {
    static async getOverview(): Promise<SettingsOverview> {
        return (await apiV1Client.get<SettingsOverview>('/pages/settings/overview')).data
    }

    static async getPersonProfile(): Promise<PersonProfileForm> {
        return (await apiV1Client.get<PersonProfileForm>('/pages/me/person-profile')).data ?? {}
    }

    /** Saves the editable profile fields; an empty string clears a field. Returns the stored profile. */
    static async updatePersonProfile(profile: PersonProfileForm): Promise<PersonProfileForm | null> {
        const values = profile as Record<string, unknown>
        const patch = Object.fromEntries(PERSON_PROFILE_FIELDS.map((field) => [field, values[field] === '' ? null : values[field]]))
        return (await apiV1Client.patch<PersonProfileForm>('/pages/me/person-profile', patch)).data ?? null
    }

    static async requestEmailChange(input: { current_password: string; email: string }): Promise<void> {
        await apiV1Client.post('/auth/me/email', input)
    }

    static async changePassword(input: { current_password: string; new_password: string; confirm_password: string }): Promise<void> {
        await apiV1Client.post('/auth/me/password', input)
    }
}
