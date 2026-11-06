/// <reference types="node" />

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(process.cwd(), '../supabase/migrations/1000025_enrollment_classroom_consistency.sql')

describe('enrollment classroom consistency migration', () => {
    const source = readFileSync(migrationPath, 'utf8')

    it('backfills classroom references from class sessions', () => {
        expect(source).toContain('SET classroom_id = session.classroom_id')
        expect(source).toContain('enrollment.class_session_id = session.id')
        expect(source).toContain('IS DISTINCT FROM session.classroom_id')
    })

    it('validates course compatibility and aligns future enrollment writes', () => {
        expect(source).toContain('align_enrollment_session_context')
        expect(source).toContain('NEW.course_id = ANY(target_course_ids)')
        expect(source).toContain('TARGET_SESSION_COURSE_MISMATCH')
        expect(source).toContain('BEFORE INSERT OR UPDATE OF class_session_id, course_id')
    })

    it('propagates classroom changes from sessions', () => {
        expect(source).toContain('sync_session_classroom_to_enrollments')
        expect(source).toContain('AFTER UPDATE OF classroom_id')
    })
})
