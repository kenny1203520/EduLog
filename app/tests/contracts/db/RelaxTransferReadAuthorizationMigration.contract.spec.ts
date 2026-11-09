import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
    resolve(process.cwd(), '../supabase/migrations/1000035_relax_transfer_read_authorization.sql'),
    'utf8'
)

describe('relax transfer read authorization migration contract', () => {
    it('drops the transfer-rooted assignment gate that blocked assigned teachers with no transfer rows', () => {
        // The gate this migration removes lived only in 1000033/1000034: an EXISTS
        // rooted at single_lesson_transfers, empty (and thus always FORBIDDEN) for
        // any enrollment with no transfer history, regardless of whether the caller
        // was the enrollment's actually assigned teacher. The error code may still
        // be mentioned in an explanatory comment, but must never be raised.
        expect(migration).not.toContain("RAISE EXCEPTION 'SINGLE_LESSON_TRANSFER_FORBIDDEN'")
        expect(migration).not.toContain('v_enrollment_owner')
        expect(migration).not.toContain('class_session_teachers AS assignment')
    })

    it('still requires authentication and a valid enrollment for both read functions', () => {
        expect(migration).toContain('get_effective_single_lesson_transfer_targets')
        expect(migration).toContain('get_single_lesson_transfer_history')
        const authRequiredCount = migration.split("RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'").length - 1
        const enrollmentNotFoundCount = migration.split("RAISE EXCEPTION 'ENROLLMENT_NOT_FOUND'").length - 1
        expect(authRequiredCount).toBe(2)
        expect(enrollmentNotFoundCount).toBe(2)
    })

    it('keeps both functions SECURITY DEFINER with a locked search_path and authenticated-only execute grants', () => {
        const definerCount = migration.split('SECURITY DEFINER').length - 1
        expect(definerCount).toBe(2)
        expect(migration).toContain("SET search_path = ''")
        expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_effective_single_lesson_transfer_targets(uuid) FROM PUBLIC')
        expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_single_lesson_transfer_history(uuid) FROM PUBLIC')
        expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_effective_single_lesson_transfer_targets(uuid) TO authenticated, service_role')
        expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_single_lesson_transfer_history(uuid) TO authenticated, service_role')
    })

    it('preserves the effective-target leaf logic and full transfer history projection unchanged', () => {
        expect(migration).toContain('is_effective_target boolean')
        expect(migration).toContain('onward.source_occurrence_id IS NULL')
        expect(migration).toContain('ORDER BY transfer.created_at DESC')
    })
})
