# EduLog migration chain

This directory contains the append-only database history for EduLog. Applied migrations from `1000001` through `1000048` are historical and must not be edited. The reconciliation migrations `1000049` and later are forward fixes for teaching ownership, RLS, RBAC policy epoch, API scope integrity, child-resource isolation, and the API contract.

## Ordered migrations

| Version | File | Purpose |
| --- | --- | --- |
| 1000001 | `1000001_core_schema.sql` | Core users, teachers, students and classrooms |
| 1000002 | `1000002_academics.sql` | Courses, lessons and enrollments |
| 1000003 | `1000003_operations.sql` | Sessions, occurrences and reports |
| 1000004 | `1000004_enhance_report_versions.sql` | Report versioning |
| 1000005 | `1000005_user_visibility_preferences.sql` | Visibility preferences |
| 1000006 | `1000006_copy_templates.sql` | Copy templates |
| 1000007 | `1000007_user_preferences.sql` | User preferences |
| 1000008 | `1000008_session_time_zones.sql` | Session time zones |
| 1000009 | `1000009_date_record_time_zones.sql` | Date record time zones |
| — | 1000010 | Historical version intentionally unused |
| 1000011 | `1000011_create_profiles_table.sql` | Profiles |
| 1000012 | `1000012_debug_report_access.sql` | Report access diagnostics |
| 1000012a | `1000012a_legacy_collaboration_rpc_compatibility.sql` | Legacy collaboration RPC compatibility |
| 1000013 | `1000013_fix_rpc_authorization.sql` | RPC authorization |
| 1000014 | `1000014_yjs_collab.sql` | Yjs collaboration |
| — | 1000015 | Historical version intentionally unused |
| — | 1000016 | Historical version intentionally unused |
| 1000017 | `1000017_cleanup_deprecated_collab.sql` | Deprecated collaboration cleanup |
| 1000018 | `1000018_generic_yjs_documents.sql` | Generic Yjs documents |
| 1000019 | `1000019_koding_code_check.sql` | Koding code checks |
| 1000020 | `1000020_merge_orange_apple_koding_credentials.sql` | Credential merge |
| 1000021 | `1000021_teacher_leave_and_safe_report_versions.sql` | Teacher leave and safe reports |
| 1000022 | `1000022_report_collab_snapshot_versioning.sql` | Collaboration snapshots |
| 1000023 | `1000023_rich_text_documents.sql` | Rich text documents |
| 1000024 | `1000024_recurring_and_camp_sessions.sql` | Recurring and camp sessions |
| 1000025 | `1000025_enrollment_classroom_consistency.sql` | Enrollment consistency |
| 1000026 | `1000026_teacher_roles_and_incomplete_report_notifications.sql` | Teacher roles and notifications |
| 1000027 | `1000027_rbac_foundation_and_scoped_permissions.sql` | RBAC foundation and scoped permissions |
| 1000028 | `1000028_rbac_security_performance_and_enrollment_completion.sql` | RBAC security and performance |
| 1000029 | `1000029_strict_incomplete_report_notification_eligibility.sql` | Notification eligibility |
| 1000030 | `1000030_single_lesson_transfers.sql` | Single-lesson transfers |
| 1000031 | `1000031_single_lesson_transfer_conflict_resolution.sql` | Transfer conflict resolution |
| 1000032 | `1000032_repeatable_single_lesson_transfers.sql` | Repeatable transfers |
| 1000033 | `1000033_single_lesson_transfer_history.sql` | Transfer history |
| 1000034 | `1000034_repair_effective_single_lesson_transfer_reports.sql` | Effective transfer report repair |
| 1000035 | `1000035_relax_transfer_read_authorization.sql` | Transfer read authorization |
| 1000036 | `1000036_editor_collaboration_reliability.sql` | Editor collaboration reliability |
| 1000037 | `1000037_editor_security_hardening.sql` | Editor security hardening |
| 1000038 | `1000038_editor_rbac_boundary_hardening.sql` | Editor RBAC boundaries |
| 1000039 | `1000039_editor_report_insert_rls_fix.sql` | Report insert RLS |
| 1000040 | `1000040_editor_report_owner_rls_fix.sql` | Report owner RLS |
| 1000041 | `1000041_editor_rbac_rpc_guard.sql` | Editor RPC guard |
| 1000041a | `1000041a_has_api_permission_compatibility.sql` | Pre-1000042 fail-closed API permission shim |
| 1000042 | `1000042_api_rbac_rest_foundation.sql` | API/RBAC foundation |
| 1000043 | `1000043_teaching_scope_reconciliation.sql` | Teaching backfill and canonical scopes |
| 1000044 | `1000044_rbac_epoch_and_api_contract.sql` | RBAC epoch and canonical API/RLS reconciliation |

| 1000045 | 1000045_missing_core_rls_hardening.sql | Forward-only hardening for missing core-table RLS policies |
| 1000046 | 1000046_api_rate_limit_shared_store.sql | Hashed shared API rate-limit buckets and atomic service-role RPC |
| 1000047 | `1000047_canonical_teacher_permissions.sql` | Forward completion of canonical teaching teacher permissions |
| 1000048 | `1000048_student_scope_course_fallback.sql` | Student scope resolution through session, classroom, or course teaching |
| 1000049 | `1000049_holiday_scope_rls_hardening.sql` | Holiday scope RLS, mixed-scope isolation, and permission-gated global holidays |
| 1000050 | `1000050_scope_integrity_and_session_rpc.sql` | Scoped permission resolver and teaching-derived class-session save RPC |
| 1000051 | `1000051_child_scope_write_hardening.sql` | Parent-boundary enforcement for sensitive child resources |
| 1000052 | `1000052_transfer_scope_authorization.sql` | Transfer cancellation scope preflight |
| 1000053 | `1000053_enrollment_scope_and_student_guard.sql` | Enrollment course fallback and student-parent authorization |
| 1000054 | `1000054_rbac_teaching_scope_rpc.sql` | Teaching-scoped RBAC policy replacement |
| 1000055 | `1000055_idempotency_route_binding.sql` | Bind idempotency keys to method and route |
| 1000056 | `1000056_canonical_rbac_policy_scope_rls.sql` | Canonical system/teaching/classroom/session RBAC policy-management RLS |
| 1000057 | `1000057_holiday_read_permission_alias.sql` | Accept holiday read/list permissions while preserving system-only global mutations |
| 1000058 | `1000058_teaching_role_scope_isolation.sql` | Prevent teaching-member roles from using system-scoped teaching policies |
| 1000059 | `1000059_idempotency_key_contract.sql` | Align database Idempotency-Key length with the API contract |
| 1000060 | `1000060_permission_scope_and_session_regression.sql` | Bind scoped permission checks to the canonical teaching and keep global holiday mutations system-only |
| 1000061 | `1000061_scope_and_idempotency_concurrency.sql` | Bind teaching policy scopes, least-privilege RBAC scope validation, and serialize concurrent idempotency requests |

The missing versions `1000010`, `1000015`, and `1000016` are historical unused numbers, not missing files. `1000041a` is an intentional compatibility migration and is ordered before `1000042`.

## 1000048 student scope course fallback

Apply 1000048 after 1000047. It is a rerunnable forward migration that preserves the enrollment consistency trigger while resolving student access through the class session, classroom, or course teaching. It never broadens access beyond an active teaching membership and should be verified after a backup.

## 1000047 canonical teacher permissions

Apply 1000047 after 1000046. It is a rerunnable forward migration that fills the teaching teacher permission catalogue required by the `/teachers` API and preserves scoped evaluation through teaching membership.

## 1000046 shared rate limiting

Apply 1000046 after the RLS hardening migration. The migration stores only hashed bucket keys and exposes the atomic consume RPC to service_role; application traffic must use the Supabase/Postgres adapter in production. Memory rate limiting is only for tests/local development. Back up before applying and verify the RPC grant and table policies.

## 1000045 forward hardening

Apply 1000045 after 1000043 and 1000044. It is forward-only and restores action-specific RLS for students, student contacts, student schools, student credentials, teacher credentials, classroom schedules, and student suspensions. It may be rerun after a backup; it fails fast when the canonical scope helpers are unavailable.

## 1000049 holiday scope hardening

Apply 1000049 after 1000048. It is a rerunnable forward migration that removes the historical authenticated-wide holiday policy. Scoped holidays require every referenced classroom and session to be visible under the caller's teaching permission; mixed teaching references are rejected. Global holidays remain supported only when the caller has the canonical global `teaching.holidays.*` permission. Verify scoped, mixed, global, insert, update, and delete cases with `supabase/tests/core_rls_security.sql` after taking a backup.

## 1000050 scope integrity and session RPC

Apply 1000050 after 1000049. It is a rerunnable forward migration that makes classroom/session scope checks agree with the referenced teaching, and replaces the legacy session save RPC so `teaching_id` is derived from validated classroom/course references. It rejects mixed teaching references and never permits a session teaching scope to change during update.

## 1000051 child scope write hardening

Apply 1000051 after 1000050. It removes child-resource owner shortcuts that could associate a new contact, credential, or schedule row with another teaching's parent. Child SELECT/INSERT/UPDATE/DELETE now resolves authorization through the referenced student, teacher, or classroom. The migration is forward-only and rerunnable.

## 1000052 transfer scope authorization

Apply 1000052 after 1000051. It adds a user-JWT transfer cancellation preflight that checks enrollment ownership or permission on both source and target sessions before idempotency reservation. The cancellation RPC remains the final authorization boundary.

## 1000053 enrollment scope and student guard

Apply 1000053 after 1000052. It resolves course-only enrollments, binds enrollment access to the resolved teaching, and requires access to the referenced student before create or reassignment.

## 1000054 teaching-scoped RBAC policy replacement

Apply 1000054 after 1000053. It allows the canonical role-policy replacement RPC to accept system, teaching, classroom, and class-session scopes while preserving the system administrator guard.

## 1000055 idempotency route binding

Apply 1000055 after 1000054. It rejects reuse of an idempotency key across different HTTP methods or routes.

## 1000056 canonical RBAC policy scope RLS

Apply 1000056 after 1000055. It reconciles the SECURITY INVOKER RBAC replacement RPC with the table RLS boundary: system policy changes require `system.roles.manage`, while teaching, classroom, and class-session policy changes require the corresponding scoped teaching permission. Historical `rbac.manage` decisions are copied to the canonical system permission for compatibility.

## 1000057 holiday read permission alias

Apply 1000057 after 1000056. Holiday SELECT accepts either the scoped `read` or `list` permission. Empty-scope global holiday create/update/delete remains system-authorized only; this migration does not widen mutation access.

## 1000058 teaching role scope isolation

Apply 1000058 after 1000057. It moves `teaching_owner` teaching permissions from the global policy scope to each teaching, provisions them for new teachings, and makes the resolver retain the assignment scope while traversing role inheritance. A teaching member therefore cannot use a teaching permission in another teaching.

## 1000059 idempotency key contract

Apply 1000059 after 1000058. It changes the database key constraint to the API's 8–255 character contract, allowing long but bounded retry keys without weakening validation.

## 1000060 permission scope and session regression

Apply 1000060 after 1000059. It makes the system permission resolver return false for an unmatched policy, binds classroom/session permission checks to the referenced teaching, and keeps empty-scope holiday mutations on the system-only path. The CI fixture also executes same-teaching session create/update and mixed-teaching rejection through `save_class_session_with_schedule`.

## 1000061 scope and idempotency concurrency

Apply 1000061 after 1000060. It preserves teaching-member access to global holiday reads while keeping global mutations system-only, binds every teaching-scoped RBAC policy to the requested teaching, validates RBAC scopes through a narrow definer helper, and adds a short idempotency lease so concurrent requests cannot execute the same mutation twice. A stale lease can be reclaimed after fifteen minutes.
## Clean install

Start a disposable PostgreSQL/Supabase-compatible database, apply `supabase/tests/postgres_bootstrap.sql`, then run every `supabase/migrations/*.sql` file in lexical order with `ON_ERROR_STOP=1`. Finish with `supabase/tests/migration_chain_integration.sql`.

## Upgrade an existing database

Back up the database first. Apply only migrations not recorded in the migration history. For a pre-reconciliation database, apply `1000043` through `1000061` after the legacy fixture/compatibility checks, then run `supabase/tests/migration_upgrade_assertions.sql` and `supabase/tests/core_rls_security.sql`. Do not edit or squash already deployed migration files.

## Rerun and rollback

`1000043` through `1000061` are written to be safely rerunnable where PostgreSQL permits it (`IF EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT`, and guarded backfills). Always take a backup before rerunning. Prefer restoring the backup or applying a reviewed forward migration for rollback; do not use destructive `down` scripts against production history.

## Verification

The CI database gate runs clean install, reruns `1000043` through `1000061`, upgrade fixture and assertions, rate-limit checks, and the executable cross-teaching RLS fixture. The backend security gate runs Deno static tests. The frontend gate runs `npm ci`, `npm run test -- --run`, and `npm run build` in `app`.
