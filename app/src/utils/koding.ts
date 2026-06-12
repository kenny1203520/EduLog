export const KODING_PLATFORM = 'Koding School (Orange Apple)'
export const KODING_PLATFORM_ALIASES = [
    KODING_PLATFORM,
    'Koding School',
    'Orange Apple'
]

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
        isKodingPlatform(credential.platform) && Boolean(credential.username?.trim())
    )
}

export function isKodingPlatform(platform: string | undefined | null): boolean {
    const normalized = platform?.trim().toLowerCase()
    return Boolean(normalized && KODING_PLATFORM_ALIASES.some(alias => alias.toLowerCase() === normalized))
}

export function buildKodingCodeCheckUrl({ admissionId, userName, lesson }: KodingCodeCheckParams): string {
    const params = [
        ['admission_id', admissionId.trim()],
        ['user_name', userName.trim()],
        ['lesson', String(lesson).trim()]
    ]
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&')

    return `https://koding.school/students/code_check?${params}`
}
