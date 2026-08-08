import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
    resolve(process.cwd(), '../supabase/migrations/1000034_repair_effective_single_lesson_transfer_reports.sql'),
    'utf8'
)

describe('effective single lesson transfer report repair migration contract', () => {
    it('returns every active source while marking only leaf targets effective', () => {
        expect(migration).toContain('get_effective_single_lesson_transfer_targets')
        expect(migration).toContain('is_effective_target boolean')
        expect(migration).toContain('onward.source_occurrence_id IS NULL')
        expect(migration).not.toContain('WHERE onward.source_occurrence_id IS NULL')
    })

    it('repairs only a missing report at an effective target without overwriting', () => {
        expect(migration).toContain('repair_single_lesson_transfer_report')
        expect(migration).toContain("RAISE EXCEPTION 'TARGET_OCCURRENCE_NOT_EFFECTIVE'")
        expect(migration).toContain("RAISE EXCEPTION 'REPORT_ALREADY_EXISTS'")
        expect(migration).toContain('INSERT INTO public.occurrence_reports')
        expect(migration).toContain('v_is_suspended OR v_is_holiday')
    })
})
