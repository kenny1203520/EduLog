import { assert, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const migrationDir = new URL('../migrations/', import.meta.url)
const canonical = await Deno.readTextFile(new URL('1000040_backend_security_reconciliation.sql', migrationDir))
const legacyUpgrade = await Deno.readTextFile(new URL('1000041_legacy_upgrade_consistency.sql', migrationDir))
function section(marker: string): string {
  const start = canonical.indexOf(`-- Former migration ${marker}`)
  if (start < 0) throw new Error(`missing consolidated migration section: ${marker}`)
  const next = canonical.indexOf('\n-- Former migration ', start + 1)
  return canonical.slice(start, next < 0 ? undefined : next)
}

const reconciliation = section('1000043_teaching_scope_reconciliation.sql')
const hardening = section('1000044_rbac_epoch_and_api_contract.sql')
const compatibility = section('1000041a_has_api_permission_compatibility.sql')
const rateLimit = section('1000046_api_rate_limit_shared_store.sql')
const studentScope = section('1000048_student_scope_course_fallback.sql')
const holidayScope = section('1000049_holiday_scope_rls_hardening.sql')
const scopeIntegrity = section('1000050_scope_integrity_and_session_rpc.sql')
const childScope = section('1000051_child_scope_write_hardening.sql')
const transferScope = section('1000052_transfer_scope_authorization.sql')
const enrollmentScope = section('1000053_enrollment_scope_and_student_guard.sql')
const rbacTeachingScope = section('1000054_rbac_teaching_scope_rpc.sql')
const idempotencyBinding = section('1000055_idempotency_route_binding.sql')
const rbacPolicyScope = section('1000056_canonical_rbac_policy_scope_rls.sql')
const holidayRead = section('1000057_holiday_read_permission_alias.sql')
const teachingRoleScope = section('1000058_teaching_role_scope_isolation.sql')
const idempotencyContract = section('1000059_idempotency_key_contract.sql')
const permissionScope = section('1000060_permission_scope_and_session_regression.sql')
const concurrencyScope = section('1000061_scope_and_idempotency_concurrency.sql')
const lifecycle = section('1000062_report_lifecycle_atomicity.sql')
const lifecycleIntegration = await Deno.readTextFile(new URL('report_lifecycle_integration.sql', import.meta.url))
const upgradeFixture = await Deno.readTextFile(new URL('migration_upgrade_fixture.sql', import.meta.url))
const coreRls = await Deno.readTextFile(new URL('core_rls_security.sql', import.meta.url))

Deno.test('reconciliation migration is present and fail-closed', () => {
  assertStringIncludes(reconciliation, 'CREATE TABLE IF NOT EXISTS public.teachings')
  assertStringIncludes(reconciliation, 'CREATE TABLE IF NOT EXISTS public.teaching_members')
  assertStringIncludes(reconciliation, 'RAISE EXCEPTION')
  assertStringIncludes(reconciliation, 'DROP POLICY IF EXISTS "Enable all access for authenticated users"')
  assertStringIncludes(reconciliation, 'GRANT EXECUTE ON FUNCTION public.can_teaching_action')
  assertStringIncludes(reconciliation, 'matched.effect')
  assertStringIncludes(reconciliation, 'FROM matched;')
  assertStringIncludes(reconciliation, 'WITH resolved_sessions AS')
})

Deno.test('forward hardening adds epoch, cycle prevention, and action-specific RLS', () => {
  assertStringIncludes(hardening, 'CREATE TABLE IF NOT EXISTS public.rbac_policy_epoch')
  assertStringIncludes(hardening, 'RBAC_ROLE_INHERITANCE_CYCLE')
  assertStringIncludes(hardening, 'CREATE OR REPLACE FUNCTION public.has_api_permission')
  assertStringIncludes(hardening, 'public.resolve_user_permission(uuid,text,uuid,uuid,date)')
  assertStringIncludes(hardening, '(select auth.uid())')
  assertStringIncludes(hardening, 'Report editor read is scoped')
  assertStringIncludes(hardening, 'Canonical reports read')
  assertStringIncludes(hardening, 'Canonical reports create')
  assertStringIncludes(hardening, 'Canonical reports update')
  assertStringIncludes(hardening, 'Canonical reports delete')
  for (const policyName of [
    'Teaching owners create teachings',
    'Teaching owners update teachings',
    'Teaching owners delete teachings',
    'Users read own audit events',
    'Teaching templates read',
    'Teaching templates create',
    'Teaching templates update',
    'Teaching templates delete',
    'Teaching credentials read',
    'Teaching credentials create',
    'Teaching credentials update',
    'Teaching credentials delete',
    'Canonical teachers read',
    'Canonical teachers create',
    'Canonical teachers update',
    'Canonical teachers delete',
  ]) {
    assertStringIncludes(hardening, policyName)
  }
  assertStringIncludes(hardening, 'Teaching enrollments create')
  assert(!hardening.includes('FOR ALL TO authenticated'))
})

Deno.test('historical migration versions are preserved', async () => {
  const names = []
  for await (const entry of Deno.readDir(migrationDir)) {
    if (entry.isFile && entry.name.endsWith('.sql')) names.push(entry.name)
  }
  names.sort()
  for (const version of ['1000001', '1000002', '1000003', '1000040']) {
    assert(names.some((name) => name.startsWith(version)), `missing migration ${version}`)
  }
  assert(names.includes('1000040_backend_security_reconciliation.sql'))
  assert(names.includes('1000041_legacy_upgrade_consistency.sql'))
  assert(!names.some((name) => /^100004[2-9].*\.sql$/.test(name) || /^100005[0-9].*\.sql$/.test(name) || /^100006[0-2].*\.sql$/.test(name)))
  assert(canonical.indexOf('Former migration 1000041a_has_api_permission_compatibility.sql') < canonical.indexOf('Former migration 1000042_api_rbac_rest_foundation.sql'))
  assertStringIncludes(compatibility, 'public.has_api_permission(uuid,text,uuid,uuid)')
  assertStringIncludes(compatibility, 'SELECT false;')
  assert(!names.some((name) => name.startsWith('1000010')))
  assert(!names.some((name) => name.startsWith('1000015')))
  assert(!names.some((name) => name.startsWith('1000016')))
})

Deno.test('1000041 bridges historical data into canonical teaching scope', () => {
  assertStringIncludes(legacyUpgrade, 'requires 1000040_backend_security_reconciliation.sql')
  assertStringIncludes(legacyUpgrade, 'UPDATE public.report_templates')
  assertStringIncludes(legacyUpgrade, 'Legacy report templates did not carry a teaching scope')
  assertStringIncludes(legacyUpgrade, 'ON CONFLICT (teaching_id, user_id) DO UPDATE')
  assertStringIncludes(legacyUpgrade, 'report teaching consistency failed')
  assert(!legacyUpgrade.includes('CREATE POLICY "Enable all access for authenticated users"'))
})

Deno.test('report lifecycle migration is transactional and rerunnable', () => {
  assertStringIncludes(lifecycle, 'CREATE OR REPLACE FUNCTION public.apply_occurrence_report_lifecycle')
  assertStringIncludes(lifecycle, 'SECURITY DEFINER')
  assertStringIncludes(lifecycle, 'can_mutate_occurrence_report')
  const lifecycleSql = lifecycle
    .replace(/--[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  assert(!/can_access_occurrence_report\s*\(/.test(lifecycleSql))
  assertStringIncludes(lifecycle, 'v_enrollment.class_session_id')
  assertStringIncludes(lifecycle, 'v_base_session.end_date')
  assertStringIncludes(lifecycle, 'v_report.is_completed IS TRUE')
  assertStringIncludes(lifecycle, 'DELETE FROM public.report_versions WHERE occurrence_report_id = p_report_id')
  assertStringIncludes(lifecycle, "holiday.kind = 'closure'")
  assertStringIncludes(lifecycle, "v_next_absence_reason := 'suspension'")
  assertStringIncludes(lifecycle, "NULLIF(p_patch->'content_document', 'null'::jsonb)")
  assertStringIncludes(lifecycle, 'FOR UPDATE')
  assertStringIncludes(lifecycle, 'ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING')
  assertStringIncludes(lifecycle, 'generate_series')
  assertStringIncludes(lifecycle, 'VERSION_CONFLICT')
  assertStringIncludes(lifecycle, 'GRANT EXECUTE ON FUNCTION public.apply_occurrence_report_lifecycle')
})

Deno.test('report lifecycle integration is executable and authenticated', () => {
  assertStringIncludes(lifecycleIntegration, 'SET LOCAL ROLE authenticated')
  assertStringIncludes(lifecycleIntegration, 'apply_occurrence_report_lifecycle')
  assertStringIncludes(lifecycleIntegration, 'VERSION_CONFLICT')
  assertStringIncludes(lifecycleIntegration, 'cross-teaching report write was authorized')
  assertStringIncludes(lifecycleIntegration, 'ROLLBACK')
})

Deno.test('1000050 preserves scoped authorization and derives session teaching', () => {
  assertStringIncludes(scopeIntegrity, "RAISE EXCEPTION '1000050 prerequisites missing")
  assertStringIncludes(scopeIntegrity, 'CREATE OR REPLACE FUNCTION public.has_api_permission')
  assertStringIncludes(scopeIntegrity, 'has_system_permission(p_user_id, p_permission_key)')
  assertStringIncludes(scopeIntegrity, "session.teaching_id = classroom.teaching_id")
  assertStringIncludes(scopeIntegrity, "'teaching.class_sessions.create'")
  assertStringIncludes(scopeIntegrity, "'teaching.class_sessions.update'")
  assertStringIncludes(scopeIntegrity, 'teaching_id, user_id')
  assertStringIncludes(scopeIntegrity, 'Classroom and course references must belong to one teaching')
  assertStringIncludes(scopeIntegrity, 'CREATE OR REPLACE FUNCTION public.save_class_session_with_schedule')
  assertStringIncludes(scopeIntegrity, 'array_agg(course.teaching_id ORDER BY course.teaching_id)')
  assert(!/min\s*\(\s*course\.teaching_id\s*\)/i.test(scopeIntegrity))
})

Deno.test('1000051 binds child writes to their real parent scope', () => {
  assertStringIncludes(childScope, "RAISE EXCEPTION '1000051 prerequisites missing")
  assertStringIncludes(childScope, 'Canonical student contacts create')
  assertStringIncludes(childScope, "can_access_student(student_id, 'teaching.students.update')")
  assertStringIncludes(childScope, 'Canonical student credentials create')
  for (const policyName of ['Teaching credentials read', 'Teaching credentials create', 'Teaching credentials update', 'Teaching credentials delete']) {
    assertStringIncludes(childScope, `DROP POLICY IF EXISTS "${policyName}" ON public.student_credentials`)
  }
  assertStringIncludes(childScope, 'Canonical teacher credentials create')
  assertStringIncludes(childScope, 'teacher.user_id = (select auth.uid())')
  assertStringIncludes(childScope, "to_regprocedure('public.can_access_class_session(uuid,text)')")
  assertStringIncludes(childScope, 'Canonical classroom schedules create')
  assertStringIncludes(childScope, "can_access_classroom(classroom_id, 'teaching.classrooms.update')")
  assertStringIncludes(childScope, 'authenticated-wide child policies remain')
})

Deno.test('1000052 authorizes transfer cancellation before replay reservation', () => {
  assertStringIncludes(transferScope, "RAISE EXCEPTION '1000052 prerequisites missing")
  assertStringIncludes(transferScope, 'CREATE OR REPLACE FUNCTION public.can_access_single_lesson_transfer')
  assertStringIncludes(transferScope, 'source_occurrence.class_session_id')
  assertStringIncludes(transferScope, 'target_occurrence.class_session_id')
  assertStringIncludes(transferScope, 'enrollment.user_id = auth.uid()')
})

Deno.test('1000053 binds enrollment access to both teaching and student scope', () => {
  assertStringIncludes(enrollmentScope, "RAISE EXCEPTION '1000053 prerequisites missing")
  assertStringIncludes(enrollmentScope, 'COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id)')
  assertStringIncludes(enrollmentScope, 'can_access_student(enrollment.student_id, p_permission_key)')
  assertStringIncludes(enrollmentScope, 'Canonical enrollments create')
  assertStringIncludes(enrollmentScope, 'Canonical enrollments update')
})

Deno.test('1000054 permits teaching-scoped RBAC policy replacement', () => {
  assertStringIncludes(rbacTeachingScope, "p_scope_type NOT IN ('system', 'teaching', 'classroom', 'class_session')")
  assertStringIncludes(rbacTeachingScope, "p_scope_type = 'teaching'")
  assertStringIncludes(rbacTeachingScope, 'teaching.members.manage')
})

Deno.test('1000055 rejects cross-route idempotency replay', () => {
  assertStringIncludes(idempotencyBinding, 'IDEMPOTENCY_KEY_REUSED')
  assertStringIncludes(idempotencyBinding, 'v_method IS DISTINCT FROM p_method')
  assertStringIncludes(idempotencyBinding, 'v_route IS DISTINCT FROM p_route')
})

Deno.test('1000056 uses one scope-aware canonical RBAC policy boundary', () => {
  assertStringIncludes(rbacPolicyScope, "RAISE EXCEPTION '1000056 prerequisites missing")
  assertStringIncludes(rbacPolicyScope, "'system.roles.manage'")
  assertStringIncludes(rbacPolicyScope, "WHEN 'teaching' THEN public.has_teaching_permission")
  assertStringIncludes(rbacPolicyScope, "WHEN 'classroom' THEN public.has_api_permission")
  assertStringIncludes(rbacPolicyScope, "WHEN 'class_session' THEN public.has_api_permission")
  assertStringIncludes(rbacPolicyScope, 'RBAC managers can manage role policies')
  assertStringIncludes(rbacPolicyScope, 'RBAC managers can manage role assignments')
  assertStringIncludes(rbacPolicyScope, "system.audit.list")
  assert(!rbacPolicyScope.includes('CREATE POLICY "Editor admins can manage role policies"'))
})

Deno.test('1000057 accepts holiday read or list permission without widening mutations', () => {
  assertStringIncludes(holidayRead, "RAISE EXCEPTION '1000057 prerequisites missing")
  assertStringIncludes(holidayRead, "'teaching.holidays.read'")
  assertStringIncludes(holidayRead, "'teaching.holidays.list'")
  assert(!holidayRead.includes('Canonical holidays create'))
  assert(!holidayRead.includes('FOR ALL TO authenticated'))
})

Deno.test('1000058 isolates teaching-member role policies from system scope', () => {
  assertStringIncludes(teachingRoleScope, "RAISE EXCEPTION '1000058 prerequisites missing")
  assertStringIncludes(teachingRoleScope, "policy.scope_type = 'system' AND role.source_scope_type = 'system'")
  assertStringIncludes(teachingRoleScope, 'ensure_teaching_owner_policies')
  assertStringIncludes(teachingRoleScope, "policy.scope_type = 'teaching'")
  assertStringIncludes(teachingRoleScope, 'teaching_owner teaching policy remains system-scoped')
})

Deno.test('1000059 aligns the database idempotency key length contract', () => {
  assertStringIncludes(idempotencyContract, 'DROP CONSTRAINT IF EXISTS api_idempotency_key_shape')
  assertStringIncludes(idempotencyContract, 'length(idempotency_key) BETWEEN 8 AND 255')
})

Deno.test('1000060 keeps global mutations system-only and binds scoped permission', () => {
  assertStringIncludes(permissionScope, "RAISE EXCEPTION '1000060 prerequisites missing")
  assertStringIncludes(permissionScope, 'COALESCE((SELECT bool_or(matched.effect = \'allow\') FROM matched), false)')
  assertStringIncludes(permissionScope, 'session.teaching_id = classroom.teaching_id')
  assertStringIncludes(permissionScope, "'teaching.holidays.create'")
  assertStringIncludes(permissionScope, "THEN public.has_system_permission(p_user_id, p_permission_key)")
  assert(!/SELECT\s+auth\.role\(\).*FROM\s+matched/i.test(permissionScope))
})

Deno.test('1000061 binds RBAC scopes and serializes idempotency reservations', () => {
  assertStringIncludes(concurrencyScope, "RAISE EXCEPTION '1000061 prerequisites missing")
  assertStringIncludes(concurrencyScope, 'policy.scope_id = p_teaching_id')
  assertStringIncludes(concurrencyScope, 'CREATE OR REPLACE FUNCTION public.rbac_scope_exists')
  assertStringIncludes(concurrencyScope, "public.has_teaching_permission(auth.uid(), 'teaching.members.manage'")
  assertStringIncludes(concurrencyScope, "public.has_api_permission(auth.uid(), 'teaching.members.manage'")
  assertStringIncludes(concurrencyScope, 'processing_started_at')
  assertStringIncludes(concurrencyScope, 'IDEMPOTENCY_IN_PROGRESS')
  assertStringIncludes(concurrencyScope, "interval '15 minutes'")
  assertStringIncludes(concurrencyScope, 'RETURNING true INTO v_inserted')
  assertStringIncludes(concurrencyScope, 'IF v_inserted THEN')
  assertStringIncludes(concurrencyScope, 'DROP POLICY IF EXISTS "Canonical holidays read"')
  assertStringIncludes(concurrencyScope, "public.has_api_permission(auth.uid(), 'teaching.holidays.list'")
  assertStringIncludes(concurrencyScope, "public.can_access_classroom(scoped_classroom_id, 'teaching.holidays.list'")
  assertStringIncludes(concurrencyScope, "public.can_access_class_session(scoped_session_id, 'teaching.holidays.list'")
  assertStringIncludes(concurrencyScope, "'teaching.holidays.read', 'teaching.holidays.list'")
})


Deno.test('1000048 resolves student scope through course fallback', () => {
  assertStringIncludes(studentScope, 'CREATE OR REPLACE FUNCTION public.can_access_student')
  assertStringIncludes(studentScope, 'COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id)')
  assertStringIncludes(studentScope, "RAISE EXCEPTION '1000048 prerequisites missing")
  assertStringIncludes(studentScope, 'GRANT EXECUTE ON FUNCTION public.can_access_student(uuid, text) TO authenticated, service_role')
})

Deno.test('1000046 uses a service-role-only shared rate limit store', () => {
  assertStringIncludes(rateLimit, 'CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets')
  assertStringIncludes(rateLimit, 'CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(')
  assertStringIncludes(rateLimit, 'p_bucket_key text')
  assertStringIncludes(rateLimit, 'p_limit integer')
  assertStringIncludes(rateLimit, 'p_window_seconds integer')
  assertStringIncludes(rateLimit, 'ON CONFLICT (bucket_key) DO UPDATE')
  assertStringIncludes(rateLimit, 'GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role')
})

Deno.test('upgrade fixture satisfies the teachers email contract', () => {
  assertStringIncludes(upgradeFixture, 'INSERT INTO public.teachers(id, name, user_id, email)')
  assertStringIncludes(upgradeFixture, 'teacher-b@example.test')
  assertStringIncludes(upgradeFixture, 'Legacy owner template')
  assertStringIncludes(upgradeFixture, '51000000-0000-0000-0000-0000000000aa')
  assertStringIncludes(upgradeFixture, 'Legacy global holiday')
  assertStringIncludes(upgradeFixture, "'{}'::uuid[]")
})

Deno.test('1000049 hardens holiday scope without an authenticated-wide policy', () => {
  assertStringIncludes(holidayScope, "RAISE EXCEPTION '1000049 prerequisites missing")
  assertStringIncludes(holidayScope, "to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)')")
  assertStringIncludes(holidayScope, 'Canonical holidays read')
  assertStringIncludes(holidayScope, 'Canonical holidays create')
  assertStringIncludes(holidayScope, 'Canonical holidays update')
  assertStringIncludes(holidayScope, 'Canonical holidays delete')
  assertStringIncludes(holidayScope, 'can_access_classroom')
  assertStringIncludes(holidayScope, 'can_access_class_session')
  assertStringIncludes(holidayScope, 'session.teaching_id = classroom.teaching_id')
  assertStringIncludes(holidayScope, 'p_classroom_id IS NOT NULL AND p_class_session_id IS NOT NULL')
  assertStringIncludes(holidayScope, 'WHEN p_classroom_id IS NOT NULL THEN EXISTS')
  assertStringIncludes(holidayScope, 'WHEN p_class_session_id IS NOT NULL THEN EXISTS')
  assertStringIncludes(holidayScope, "'teaching.holidays.delete'")
  assertStringIncludes(holidayScope, 'has_api_permission(auth.uid(), \'teaching.holidays.read\'')
  assertStringIncludes(holidayScope, 'has_api_permission(auth.uid(), \'teaching.holidays.create\'')
  assertStringIncludes(holidayScope, 'has_api_permission(auth.uid(), \'teaching.holidays.update\'')
  assertStringIncludes(holidayScope, 'has_api_permission(auth.uid(), \'teaching.holidays.delete\'')
  assertStringIncludes(holidayScope, "COALESCE(classroom_ids, '{}'::uuid[])")
  assertStringIncludes(holidayScope, "COALESCE(class_session_ids, '{}'::uuid[])")
  assertStringIncludes(holidayScope, 'COALESCE(cardinality(classroom_ids), 0) > 0 OR COALESCE(cardinality(class_session_ids), 0) > 0')
  assert((holidayScope.match(/AS scoped_classroom\(scoped_classroom_id\)/g) ?? []).length >= 4)
  assert((holidayScope.match(/AS scoped_session\(scoped_session_id\)/g) ?? []).length >= 4)
  assert(!/FOR\s+ALL\s+TO\s+authenticated/i.test(holidayScope))
})

Deno.test('core RLS fixture executes holiday cross-teaching and global compatibility cases', () => {
  assertStringIncludes(coreRls, '-- Holiday regression: scoped rows, mixed scopes')
  assertStringIncludes(coreRls, 'RLS Holiday A')
  assertStringIncludes(coreRls, 'RLS Holiday B')
  assertStringIncludes(coreRls, 'RLS Holiday Mixed')
  assertStringIncludes(coreRls, 'RLS Holiday Global')
  assertStringIncludes(coreRls, 'mixed holiday insert unexpectedly succeeded')
  assertStringIncludes(coreRls, 'holiday RLS fixture was unexpectedly mutated')
  assertStringIncludes(coreRls, 'cross-teaching scoped permission unexpectedly allowed')
  assertStringIncludes(coreRls, 'cross-teaching session permission unexpectedly allowed')
  assertStringIncludes(coreRls, 'cross-teaching child insert unexpectedly succeeded')
  assertStringIncludes(coreRls, 'Cross teaching contact injection')
  assertStringIncludes(coreRls, 'cross-teaching student credential insert unexpectedly succeeded')
  assertStringIncludes(coreRls, 'cross-teaching student credential update unexpectedly succeeded')
  assertStringIncludes(coreRls, 'course-only enrollment insert failed')
  assertStringIncludes(coreRls, 'cross-teaching student enrollment unexpectedly succeeded')
  assertStringIncludes(coreRls, 'teaching-only owner global holiday insert unexpectedly succeeded')
  assertStringIncludes(coreRls, 'RLS Global Admin Updated')
  assertStringIncludes(coreRls, 'save_class_session_with_schedule')
  assertStringIncludes(coreRls, 'same-teaching session RPC create failed')
  assertStringIncludes(coreRls, 'mixed-teaching session RPC unexpectedly succeeded')
  assertStringIncludes(coreRls, 'cross-teaching student school insert unexpectedly succeeded')
  assertStringIncludes(coreRls, 'cross-teaching student school update unexpectedly succeeded')
  assertStringIncludes(coreRls, 'cross-teaching teacher credential insert unexpectedly succeeded')
  assertStringIncludes(coreRls, 'cross-teaching teacher credential update unexpectedly succeeded')
  assertStringIncludes(coreRls, 'cross-teaching classroom schedule insert unexpectedly succeeded')
  assertStringIncludes(coreRls, 'cross-teaching classroom schedule update unexpectedly succeeded')
  assertStringIncludes(coreRls, 'teaching-scoped RBAC policy leaked from Teaching B to A')
  assertStringIncludes(coreRls, 'unauthorized RBAC scope existence oracle exposed')
  assertStringIncludes(coreRls, 'teaching-scoped RBAC policy replacement succeeded')
  assertStringIncludes(coreRls, 'idempotency concurrent reservation unexpectedly proceeded')
  assertStringIncludes(coreRls, 'idempotency first reservation did not proceed')
  assertStringIncludes(coreRls, 'idempotency completed replay failed')
  assertStringIncludes(coreRls, 'IDEMPOTENCY_IN_PROGRESS')
})
