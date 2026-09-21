import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/settings/RolePermissionEditor.vue'), 'utf8')

describe('role permission editor contract', () => {
    it('uses the canonical local/inherited/effective permission fields', () => {
        expect(source).toContain('local_effect')
        expect(source).toContain('inherited_effect')
        expect(source).toContain('effective_effect')
        expect(source).toContain('RoleService.replaceRolePermissions')
    })

    it('supports both system and teaching scopes without a second evaluator', () => {
        expect(source).toContain("domain: RbacDomain")
        expect(source).toContain("scope_type: props.domain === 'system' ? 'system' : 'teaching'")
        expect(source).not.toContain('CASL')
    })

    it('keeps protected roles read-only and preserves epoch conflicts', () => {
        expect(source).toContain('selectedRole?.is_protected')
        expect(source).toContain('RBAC_VERSION_CONFLICT')
        expect(source).toContain('conflict.value = true')
    })
})
