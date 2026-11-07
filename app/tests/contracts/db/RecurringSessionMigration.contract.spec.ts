/// <reference types="node" />

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(process.cwd(), '../supabase/migrations/1000024_recurring_and_camp_sessions.sql')

describe('recurring and camp session migration', () => {
    const source = readFileSync(migrationPath, 'utf8')

    it('backfills existing sessions as weekly rules', () => {
        expect(source).toContain("SELECT id, 'weekly', day_of_week, start_time, end_time")
        expect(source).toContain('ON CONFLICT DO NOTHING')
    })

    it('enforces one rule per session day and valid time ranges', () => {
        expect(source).toContain('class_session_schedule_rules_weekly_unique')
        expect(source).toContain('class_session_schedule_rules_monthly_unique')
        expect(source).toContain('class_session_schedule_rules_date_unique')
        expect(source).toContain('CHECK (start_time < end_time)')
    })

    it('saves sessions and rules atomically through an RPC', () => {
        expect(source).toContain('save_class_session_with_schedule')
        expect(source).toContain('DELETE FROM public.class_session_schedule_rules')
        expect(source).toContain('jsonb_to_recordset')
    })
})
