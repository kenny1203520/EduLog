type Translate = (key: string) => string
type RoleDisplayInput = { code?: string | null; name: string; is_system?: boolean }
type RoleDescriptionInput = { code?: string | null; description?: string | null; is_builtin?: boolean }

const BUILT_IN_ROLE_CODES = new Set([
    'owner', 'teaching_owner', 'manager', 'teaching_manager', 'assistant', 'viewer', 'member',
    'instructor', 'assistant_instructor', 'trainee_instructor', 'trainee_assistant',
    'teacher', 'learning_coach', 'coach', 'trainee_teacher', 'trainee_tutor',
    'trainee_learning_coach', 'trainee_coach'
])
const TEACHING_BUILT_IN_ROLE_CODES = new Set(['teaching_owner', 'teaching_manager', 'teacher', 'assistant', 'viewer', 'member'])

/** Returns a localized label for built-in roles and the stored name for custom roles. */
export function roleDisplayName(role: RoleDisplayInput, translate: Translate): string {
    if (role.is_system || (role.code && BUILT_IN_ROLE_CODES.has(role.code))) {
        if (role.code && TEACHING_BUILT_IN_ROLE_CODES.has(role.code)) {
            const key = `rbac.roles.${role.code}.name`
            const localizedName = translate(key)
            if (localizedName !== key) return localizedName
        }
        const candidates = [role.code, role.name]
            .filter((value): value is string => Boolean(value))
            .map(value => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))

        for (const code of candidates) {
            const key = `settings.teacher_roles.names.${code}`
            const localizedName = translate(key)
            if (localizedName !== key) return localizedName
        }
    }

    return role.name
}

/** Localizes built-in role descriptions while preserving user-authored custom descriptions. */
export function roleDisplayDescription(role: RoleDescriptionInput, translate: Translate): string {
    if (role.is_builtin && role.code) {
        const key = `rbac.roles.${role.code}.description`
        const localizedDescription = translate(key)
        if (localizedDescription !== key) return localizedDescription
    }

    return role.description ?? ''
}
