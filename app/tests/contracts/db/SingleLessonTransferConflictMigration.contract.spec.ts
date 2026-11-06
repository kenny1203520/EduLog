import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
    resolve(process.cwd(), '../supabase/migrations/1000031_single_lesson_transfer_conflict_resolution.sql'),
    'utf8'
)

describe('single-lesson transfer conflict migration', () => {
    it('archives the source report and its history before deletion', () => {
        expect(migration).toContain('single_lesson_transfer_report_archives')
        expect(migration).toContain('source_versions jsonb')
        expect(migration).toContain('to_jsonb(v_source_report.*)')
        expect(migration).toContain('DELETE FROM public.report_versions')
    })

    it('validates authentication, field choices, and optimistic versions', () => {
        expect(migration).toContain('AUTHENTICATION_REQUIRED')
        expect(migration).toContain('INVALID_TRANSFER_FIELD_SELECTIONS')
        expect(migration).toContain('TRANSFER_CONFLICT_STALE')
        expect(migration).toContain('COALESCE(v_target_report.version, 1) <> p_target_version')
    })

    it('updates rich-text pairs and records the transfer in one function', () => {
        expect(migration).toContain('resolve_single_lesson_transfer_conflict')
        expect(migration).toContain('INSERT INTO public.single_lesson_transfers')
        expect(migration).toContain('contact_notes_document = CASE')
        expect(migration).toContain('content_document = CASE')
    })
})
