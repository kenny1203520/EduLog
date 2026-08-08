import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
    resolve(process.cwd(), '../supabase/migrations/1000033_single_lesson_transfer_history.sql'),
    'utf8'
)

describe('single lesson transfer history migration contract', () => {
    it('exposes a protected, audit-focused history RPC', () => {
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_single_lesson_transfer_history')
        expect(migration).toContain('SECURITY DEFINER')
        expect(migration).toContain("RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'")
        expect(migration).toContain("RAISE EXCEPTION 'SINGLE_LESSON_TRANSFER_FORBIDDEN'")
        expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_single_lesson_transfer_history(uuid) FROM PUBLIC')
        expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_single_lesson_transfer_history(uuid) TO authenticated, service_role')
    })

    it('returns active and closed records with both occurrence contexts, newest first', () => {
        expect(migration).toContain('transfer.created_at')
        expect(migration).toContain('transfer.cancelled_at')
        expect(migration).toContain('COALESCE(course.display_name, course.subject)')
        expect(migration).toContain('source_occurrence.occurrence_date')
        expect(migration).toContain('target_occurrence.occurrence_date')
        expect(migration).toContain('source_session.name')
        expect(migration).toContain('target_session.name')
        expect(migration).toContain('ORDER BY transfer.created_at DESC')
    })
})
