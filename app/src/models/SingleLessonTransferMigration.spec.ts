import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
    resolve(process.cwd(), '../supabase/migrations/1000030_single_lesson_transfers.sql'),
    'utf8'
)

describe('single lesson transfer migration contract', () => {
    it('persists active source and target occurrence overrides', () => {
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.single_lesson_transfers')
        expect(migration).toContain('single_lesson_transfers_active_source_unique')
        expect(migration).toContain('single_lesson_transfers_active_target_unique')
        expect(migration).toContain('transfer.cancelled_at IS NULL')
    })

    it('resolves the effective roster and moves reports atomically', () => {
        expect(migration).toContain('get_effective_occurrence_enrollment_ids')
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.transfer_single_lesson')
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.cancel_single_lesson_transfer')
        expect(migration).toContain('TARGET_REPORT_ALREADY_EXISTS')
        expect(migration).toContain('SOURCE_REPORT_ALREADY_EXISTS')
    })

    it('withholds direct authenticated writes to transfer records', () => {
        expect(migration).toContain('REVOKE ALL ON public.single_lesson_transfers FROM anon, authenticated')
        expect(migration).toContain('SINGLE_LESSON_TRANSFER_FORBIDDEN')
    })
})
