export const KODING_PLATFORM = 'Koding School'

export interface KodingCredential {
    id?: string
    platform?: string
    username?: string | null
}

export interface KodingCodeCheckParams {
    admissionId: string
    userName: string
    lesson: number | string
}

export function getKodingCredentials(credentials: KodingCredential[] | undefined | null): KodingCredential[] {
    return (credentials || []).filter(credential =>
        credential.platform === KODING_PLATFORM && Boolean(credential.username?.trim())
    )
}

export function buildKodingCodeCheckUrl({ admissionId, userName, lesson }: KodingCodeCheckParams): string {
    const params = new URLSearchParams({
        admission_id: admissionId.trim(),
        user_name: userName.trim(),
        lesson: String(lesson).trim()
    })

    return `https://koding.school/students/code_check?${params.toString()}`
}
