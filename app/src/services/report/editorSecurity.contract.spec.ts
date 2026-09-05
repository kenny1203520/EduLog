import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
const rbacBoundary = readFileSync(resolve(repoRoot, 'supabase/migrations/1000038_editor_rbac_boundary_hardening.sql'), 'utf8')
const insertRlsFix = readFileSync(resolve(repoRoot, 'supabase/migrations/1000039_editor_report_insert_rls_fix.sql'), 'utf8')

describe('editor security contracts', () => {
    it('restricts RBAC mutation and legacy admin grant to editor administrators', () => {
        expect(rbacBoundary).toContain('can_manage_editor_rbac')
        expect(rbacBoundary).toContain('REVOKE EXECUTE ON FUNCTION public.grant_admin_access(text) FROM authenticated')
        expect(rbacBoundary).not.toContain("USING ((SELECT auth.role()) = 'authenticated')")
    })
    it('scopes report data and private realtime rooms', () => {
const migration = readFileSync(resolve(repoRoot, 'supabase/migrations/1000037_editor_security_hardening.sql'), 'utf8')
        expect(migration).toContain('can_access_occurrence_report')
        expect(migration).toContain('realtime.messages')
        expect(migration).toContain('Report editor access is scoped')
        expect(migration).not.toContain('FOR UPDATE')
    })

    it('uses a key-based INSERT policy for report placeholder provisioning', () => {
        expect(insertRlsFix).toContain('can_create_occurrence_report')
        expect(insertRlsFix).toContain('CREATE POLICY "Report editor insert is scoped"')
        expect(insertRlsFix).toContain('WITH CHECK (')
        expect(insertRlsFix).not.toMatch(/FOR ALL[\s\S]*WITH CHECK \(public\.can_access_occurrence_report\(id\)\)/)
        expect(insertRlsFix).toContain('get_effective_occurrence_enrollment_ids')
        expect(insertRlsFix).toContain('SET search_path = public')
    })
    it('keeps collaboration channels private and payloads bounded', () => {
        const provider = readFileSync(resolve(repoRoot, 'app/src/services/report/SupabaseProvider.ts'), 'utf8')
        expect(provider).toContain('private: true')
        expect(provider).toContain('MAX_YJS_UPDATE_BYTES')
        expect(provider).toContain('MAX_SNAPSHOT_BYTES')
        expect(provider).toContain('decodeBoundedBase64')
    })

    it('uses optimistic concurrency for restore and conflict resolution', () => {
        const command = readFileSync(resolve(repoRoot, 'app/src/services/report/ReportCommandService.ts'), 'utf8')
        expect(command).toContain(".eq('occurrence_report_id', reportId)")
        expect(command).toContain(".eq('version', currentVersion)")
        expect(command).toContain('expectedVersion is required')
        expect(command).toContain('authenticatedUserId')
    })
})