# EduLog migration chain

The canonical chain is the individual migration files listed below. The former consolidated migration names are not valid inputs. Existing migrations through `1000064` remain unchanged. `1000057a_rbac_scope_constraint_compatibility.sql` is a new clean/upgrade compatibility step before `1000058`; `1000065_rbac_scope_constraint_reconciliation.sql` is the forward-only repair for databases that have already applied `1000058`, `1000066_atomic_scoped_rbac_policy_replacement.sql` repairs the authorized policy replacement RPC without weakening direct-table RLS, `1000067_idempotency_output_column_qualification.sql` fixes the ambiguous replay lookup, `1000068_class_session_scoped_table_access.sql` restores session RPC table privileges behind canonical teaching-scoped RLS, `1000069_report_template_teaching_backfill.sql` repairs missing owner-based teaching scopes for legacy report templates, and `1000070_class_session_rpc_reference_reads.sql` grants the invoker session RPC reference reads while canonical classroom/course RLS keeps the rows scoped. `1000041a_has_api_permission_compatibility.sql` intentionally sorts between `1000041` and `1000042`.

This directory contains the append-only database history for EduLog. Existing migrations through `1000064` must not be edited. The current chain adds the pre-`1000058` compatibility step and `1000065`–`1000070` forward-only repairs without rewriting applied migration files.

The former consolidated migration names are intentionally absent. `1000041a_has_api_permission_compatibility.sql` is an intentional compatibility migration and sorts between `1000041` and `1000042`.

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
| 1000040 | `1000040_editor_report_owner_rls_fix.sql` | Report owner/editor RLS |
| 1000041 | `1000041_editor_rbac_rpc_guard.sql` | Editor RBAC RPC guard |
| 1000041a | `1000041a_has_api_permission_compatibility.sql` | Pre-RBAC compatibility shim |
| 1000042 | `1000042_api_rbac_rest_foundation.sql` | API/RBAC foundation |
| 1000043 | `1000043_teaching_scope_reconciliation.sql` | Teaching scope reconciliation and backfill |
| 1000044 | `1000044_rbac_epoch_and_api_contract.sql` | RBAC epoch and canonical API policies |
| 1000045 | `1000045_missing_core_rls_hardening.sql` | Core sensitive-resource RLS hardening |
| 1000046 | `1000046_api_rate_limit_shared_store.sql` | Shared rate-limit buckets and RPC |
| 1000047 | `1000047_canonical_teacher_permissions.sql` | Canonical teacher permissions |
| 1000048 | `1000048_student_scope_course_fallback.sql` | Student scope course fallback |
| 1000049 | `1000049_holiday_scope_rls_hardening.sql` | Holiday scope RLS |
| 1000050 | `1000050_scope_integrity_and_session_rpc.sql` | Scope integrity and session RPC |
| 1000051 | `1000051_child_scope_write_hardening.sql` | Child-resource scope write hardening |
| 1000052 | `1000052_transfer_scope_authorization.sql` | Transfer scope authorization |
| 1000053 | `1000053_enrollment_scope_and_student_guard.sql` | Enrollment and student guard |
| 1000054 | `1000054_rbac_teaching_scope_rpc.sql` | Teaching-scoped RBAC RPC |
| 1000055 | `1000055_idempotency_route_binding.sql` | Idempotency route binding |
| 1000056 | `1000056_canonical_rbac_policy_scope_rls.sql` | Canonical RBAC policy scope RLS |
| 1000057 | `1000057_holiday_read_permission_alias.sql` | Holiday read permission alias |
| 1000057a | `1000057a_rbac_scope_constraint_compatibility.sql` | Replace legacy RBAC scope checks before teaching-scoped policies |
| 1000058 | `1000058_teaching_role_scope_isolation.sql` | Teaching role scope isolation |
| 1000059 | `1000059_idempotency_key_contract.sql` | Idempotency key contract |
| 1000060 | `1000060_permission_scope_and_session_regression.sql` | Permission scope and session regression |
| 1000061 | `1000061_scope_and_idempotency_concurrency.sql` | Scope and idempotency concurrency |
| 1000062 | `1000062_report_lifecycle_atomicity.sql` | Forward-only atomic report lifecycle |
| 1000063 | `1000063_report_mutation_contract_and_delete_replay.sql` | Report RPC validation and DELETE replay |
| 1000064 | `1000064_report_delete_replay_rbac.sql` | Current-user RBAC validation for DELETE replay |
| 1000065 | `1000065_rbac_scope_constraint_reconciliation.sql` | Forward-only RBAC scope constraint repair |
| 1000066 | `1000066_atomic_scoped_rbac_policy_replacement.sql` | Atomic, scope-authorized RBAC policy replacement |
| 1000067 | `1000067_idempotency_output_column_qualification.sql` | Qualify idempotency replay columns |
| 1000068 | `1000068_class_session_scoped_table_access.sql` | Restore session RPC table access behind scoped RLS |
| 1000069 | `1000069_report_template_teaching_backfill.sql` | Backfill legacy report-template teaching ownership |
| 1000070 | `1000070_class_session_rpc_reference_reads.sql` | Grant class-session RPC reference reads behind teaching-scoped RLS |

The missing versions `1000010`, `1000015`, and `1000016` are historical unused numbers, not missing files. Apply migrations in lexical order; `1000041a` sorts between `1000041` and `1000042`, and `1000057a` sorts between `1000057` and `1000058`.

## Current canonical chain

The security and scope changes are intentionally kept as separate migration files. Apply `1000040` through `1000061` in lexical order, including `1000057a` before `1000058`, then apply `1000062_report_lifecycle_atomicity.sql` through `1000070_class_session_rpc_reference_reads.sql` in order. Do not use the deleted consolidated migration names; they are not part of the current chain.

## Clean install

Start a disposable PostgreSQL/Supabase-compatible database, apply `supabase/tests/postgres_bootstrap.sql`, then run every `supabase/migrations/*.sql` file in lexical order with `ON_ERROR_STOP=1`. Finish with `supabase/tests/migration_chain_integration.sql`.

## Upgrade an existing database

Back up the database first. Apply only migrations not recorded in the migration history. For a database at `1000039`, apply the individual `1000040`–`1000061` files in lexical order, including `1000057a` before `1000058`, then apply `1000062`–`1000070` in order. A database that has already recorded `1000058` must not apply `1000057a` out of order; apply the pending forward repairs in version order. Finish with the migration upgrade, RBAC scope, report lifecycle, and core RLS assertions. Do not edit historical migrations.

## Rerun and rollback

The individual migrations are written to be rerunnable where PostgreSQL permits it (`IF EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT`, and guarded backfills). Always take a backup before rerunning. Prefer restoring the backup or applying a reviewed forward migration for rollback; do not use destructive `down` scripts against production history.

## Verification

The CI database gate runs clean install, historical upgrade, `1000062`–`1000070` rerun, RBAC scope constraint checks, report lifecycle and replay assertions, upgrade fixture and assertions, rate-limit checks, and the executable cross-teaching RLS fixture. The backend security gate runs Deno static tests. The frontend gate runs `npm ci`, `npm run test -- --run`, and `npm run build` in `app`.

## Append-only history boundary

Do not consolidate, rename, delete, or rewrite existing migrations `1000040`–`1000064`. An existing database records migration versions, so replacing a file with the same version cannot repair an already-applied database. Use new forward migrations such as `1000065+` for deployed databases. The `1000057a` compatibility file is for ordered clean/upgrade chains before `1000058`; it is not a replacement for `1000065` on a database that has already applied `1000058`. The `1000041a` compatibility migration remains before `1000042` so its function grant target exists during clean installation. `1000066` keeps the policy replacement RPC explicitly scope-authorized and atomic while preserving RLS for direct table access. `1000067` qualifies idempotency table columns to avoid collisions with its output variables. `1000068` grants authenticated session table operations only alongside per-action teaching-scoped RLS policies, and requires the session RPC to remain invoker-security. `1000069` fills legacy report-template teaching scopes from their instructor owner and isolates unresolved rows in quarantine. `1000070` grants the invoker session RPC SELECT on referenced classroom/course tables only after verifying their teaching-scoped SELECT RLS policies; anonymous SELECT remains revoked.
