import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
    resolve(process.cwd(), '../supabase/migrations/1000032_repeatable_single_lesson_transfers.sql'),
    'utf8'
)

describe('repeatable single lesson transfer migration contract', () => {
    it('supports chaining and closing the inactive return path atomically', () => {
        expect(migration).toContain('prepare_repeatable_single_lesson_transfer')
        expect(migration).toContain('WITH RECURSIVE path AS')
        expect(migration).toContain('SOURCE_OCCURRENCE_NOT_EFFECTIVE')
        expect(migration).toContain('TARGET_OCCURRENCE_ALREADY_EFFECTIVE')
        expect(migration).toContain('SET cancelled_at = now()')
        expect(migration).toContain('Intermediate chain nodes are targets historically')
        expect(migration).toContain('manually recreated source report is authoritative')
        expect(migration).toContain('SELECT incoming.enrollment_id FROM transferred_in AS incoming')
    })

    it('uses the same repeatable chain logic for normal and conflict transfers', () => {
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.transfer_single_lesson')
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.resolve_single_lesson_transfer_conflict')
        expect(migration.match(/prepare_repeatable_single_lesson_transfer/g)?.length).toBeGreaterThanOrEqual(3)
    })
})
