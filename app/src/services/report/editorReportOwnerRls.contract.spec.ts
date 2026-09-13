import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
const migration = readFileSync(resolve(repoRoot, 'supabase/migrations/1000040_editor_report_owner_rls_fix.sql'), 'utf8')

describe('editor report owner RLS migration contract', () => {
    it('uses owner-aware, date-scoped access and key-based inserts', () => {
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.can_access_occurrence_report')
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.can_create_occurrence_report')
        expect(migration).toContain('session.user_id = auth.uid()')
        expect(migration).toContain('assignment.effective_from <= occurrence.occurrence_date')
        expect(migration).toContain('get_effective_occurrence_enrollment_ids')
        expect(migration).toContain('CREATE POLICY "Report editor insert is scoped"')
        expect(migration).not.toMatch(/FOR ALL[\s\S]*WITH CHECK \(public\.can_access_occurrence_report\(id\)\)/)
        expect(migration).toContain('SET search_path = public')
    })
})
