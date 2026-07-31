import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), '../supabase/migrations/1000027_rbac_foundation_and_scoped_permissions.sql'), 'utf8')
const edgeFunction = readFileSync(resolve(process.cwd(), '../supabase/volumes/functions/aggregate-incomplete-reports/index.ts'), 'utf8')
const notificationPolicy = readFileSync(resolve(process.cwd(), '../supabase/volumes/functions/aggregate-incomplete-reports/policy.ts'), 'utf8')

describe('RBAC migration contract', () => {
    it('preserves legacy role and assignment identifiers during conversion', () => {
        expect(migration).toContain('ALTER TABLE public.teacher_role_types RENAME TO roles')
        expect(migration).toContain('RENAME COLUMN role_type_id TO role_id')
        expect(migration).toContain('SELECT legacy.role_type_id')
        expect(migration).toContain('ON CONFLICT DO NOTHING')
    })

    it('provides atomic policy replacement and centralized resolution', () => {
        expect(migration).toContain('replace_role_permission_policies')
        expect(migration).toContain('resolve_user_permission')
        expect(migration).toContain("effect text NOT NULL CHECK (effect IN ('allow', 'deny'))")
        expect(migration).toContain("WHEN 'class_session' THEN 3 WHEN 'classroom' THEN 2 ELSE 1")
    })

    it('routes notification aggregation through the evaluator with legacy fallback', () => {
        expect(edgeFunction).toContain("client.rpc('resolve_user_permission'")
        expect(edgeFunction).toContain('canReceiveIncompleteReportNotification')
        expect(edgeFunction).toContain('isTeacherPresentForScope')
        expect(notificationPolicy).toContain('if (!isPresent) return false')
        expect(notificationPolicy).toContain('if (!decision.policy_configured) return true')
        expect(notificationPolicy).toContain('return decision.is_allowed && !decision.is_denied')
        expect(edgeFunction).not.toContain('resolveNotificationRoleIds')
    })
})
