import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), '../supabase/migrations/1000027_rbac_foundation_and_scoped_permissions.sql'), 'utf8')
const correction = readFileSync(resolve(process.cwd(), '../supabase/migrations/1000028_rbac_security_performance_and_enrollment_completion.sql'), 'utf8')
const strictNotificationEligibility = readFileSync(resolve(process.cwd(), '../supabase/migrations/1000029_strict_incomplete_report_notification_eligibility.sql'), 'utf8')
const scopedTeachingMatrix = readFileSync(resolve(process.cwd(), '../supabase/migrations/1000092_scoped_teaching_role_permission_matrix.sql'), 'utf8')
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

    it('resolves only roles effective on the occurrence date with deny precedence', () => {
        expect(migration).toContain('class_teacher.effective_from <= p_effective_date')
        expect(migration).toContain('class_teacher.effective_to >= p_effective_date')
        expect(migration).toContain('assignment.effective_from <= p_effective_date')
        expect(migration).toContain('assignment.effective_to >= p_effective_date')
        expect(migration).toContain("COALESCE(bool_or(effect = 'deny'), false)")
    })

    it('routes notification aggregation through the strict class-role evaluator', () => {
        expect(edgeFunction).toContain("client.rpc('resolve_incomplete_report_notification_permission'")
        expect(edgeFunction).toContain('canReceiveIncompleteReportNotification')
        expect(edgeFunction).toContain('isTeacherPresentForScope')
        expect(notificationPolicy).toContain('if (!isPresent) return false')
        expect(notificationPolicy).toContain('if (!decision.policy_configured) return false')
        expect(notificationPolicy).toContain('return decision.is_allowed && !decision.is_denied')
        expect(edgeFunction).toContain("'Cache-Control': 'private, no-store'")
        expect(edgeFunction).not.toContain("'Cache-Control': 'public")
    })

    it('requires an effective class assignment and explicit three-level policy', () => {
        expect(strictNotificationEligibility).toContain('resolve_incomplete_report_notification_permission')
        expect(strictNotificationEligibility).toContain('FROM public.class_session_teachers AS class_teacher')
        expect(strictNotificationEligibility).toContain('class_teacher.effective_from <= p_effective_date')
        expect(strictNotificationEligibility).toContain('class_teacher.effective_to >= p_effective_date')
        expect(strictNotificationEligibility).toContain("WHEN 'class_session' THEN 3")
        expect(strictNotificationEligibility).toContain("WHEN 'classroom' THEN 2")
        expect(strictNotificationEligibility).toContain("COALESCE(bool_or(effect = 'deny'), false)")
        expect(strictNotificationEligibility).not.toContain('user_role_assignments')
    })

    it('hardens compatibility views, trigger search paths and duplicate indexes', () => {
        expect(correction.match(/security_invoker = true/g)).toHaveLength(2)
        expect(correction).toContain('SET search_path = \'\'')
        expect(correction).toContain('DROP INDEX IF EXISTS public.idx_class_session_teachers_role_type_id')
        expect(correction).toContain('DROP INDEX IF EXISTS public.teacher_role_types_code_unique')
        expect(correction).toContain('DROP INDEX IF EXISTS public.teacher_role_types_name_unique')
        expect(correction).toContain('SECURITY INVOKER')
    })

    it('supports scoped teaching-role matrices and keeps teaching authorization deny-first', () => {
        expect(scopedTeachingMatrix).toContain("p_scope_type NOT IN ('teaching', 'classroom', 'class_session')")
        expect(scopedTeachingMatrix).toContain('public.rbac_scope_teaching_id(p_scope_type, p_scope_id)')
        expect(scopedTeachingMatrix).toContain("policy.scope_id IS NULL OR policy.scope_id = p_teaching_id")
        expect(scopedTeachingMatrix).toContain("COALESCE(bool_or(matched.effect = 'deny'), false)")
        expect(scopedTeachingMatrix).toContain("WHEN 'class_session' THEN public.has_api_permission")
        expect(scopedTeachingMatrix).toContain("scope_type = 'teaching' AND scope_id IS NULL")
        expect(scopedTeachingMatrix).toContain("v_role.domain <> v_permission.domain")
        expect(scopedTeachingMatrix).toContain('CREATE OR REPLACE FUNCTION public.can_access_report')
        expect(scopedTeachingMatrix).toContain('session.classroom_id, session.id')
        expect(scopedTeachingMatrix).toContain('public.can_access_enrollment_scope')
    })
})
