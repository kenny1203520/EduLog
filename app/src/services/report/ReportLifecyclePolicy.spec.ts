import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
    resolve(process.cwd(), '../supabase/migrations/1000028_rbac_security_performance_and_enrollment_completion.sql'),
    'utf8'
)
const lifecycle = readFileSync(resolve(process.cwd(), 'src/services/report/ReportLifecyclePolicy.ts'), 'utf8')

describe('final attended lesson enrollment completion', () => {
    it('uses one database trigger for every persisted report mutation path', () => {
        expect(migration).toContain('AFTER INSERT OR UPDATE OF attendance_status, is_completed, lesson_id')
        expect(migration).toContain("NEW.attendance_status = 'present'")
        expect(migration).toContain('NEW.is_completed IS TRUE')
        expect(migration).toContain('NEW.lesson_id IS NOT NULL')
        expect(migration).toContain("enrollment.status = 'regular'")
    })

    it('recognizes the final lesson by course sequence without chapter checks', () => {
        expect(migration).toContain('later_lesson.sequence > current_lesson.sequence')
        expect(migration).not.toMatch(/chapter/i)
    })

    it('backfills existing eligible reports and never downgrades completed enrollments', () => {
        expect(migration).toContain('Reconcile records saved before this trigger existed')
        expect(migration).toContain("WHERE enrollment.status = 'regular'")
        expect(migration).not.toContain("SET status = 'regular'")
    })

    it('keeps the client lifecycle focused on idempotent next-report creation', () => {
        expect(lifecycle).toContain('ensureNextOccurrenceReportAfterSave')
        expect(lifecycle).not.toContain('isFinalCompletedLesson')
        expect(lifecycle).not.toContain(".update({ status: 'completed' })")
    })
})
