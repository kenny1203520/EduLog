import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), '../supabase/migrations/1000041_editor_rbac_rpc_guard.sql'), 'utf8')
const rpcSection = migration

describe('editor RBAC RPC guard migration contract', () => {
    it('guards policy replacement and keeps execution scoped to authenticated administrators', () => {
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.replace_role_permission_policies')
        expect(migration).toContain('public.can_manage_editor_rbac()')
        expect(migration).toContain("MESSAGE = 'RBAC_MANAGE_REQUIRED'")
        expect(migration).toContain("ERRCODE = '42501'")
        expect(migration).toContain('SECURITY INVOKER')
        expect(migration).toContain('SET search_path = public')
        expect(migration).toContain('REVOKE ALL ON FUNCTION public.replace_role_permission_policies')
        expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.replace_role_permission_policies')
        expect(rpcSection).not.toContain('FOR UPDATE')
    })
})
