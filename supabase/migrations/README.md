# EduLog migration chain

This directory contains the append-only database history for EduLog. Migrations through `1000039` are historical and must not be edited. The unreleased `1000040_backend_security_reconciliation.sql` consolidates the former 1000040–1000062 work into one canonical, dependency-ordered migration. The following `1000041_legacy_upgrade_consistency.sql` is a separate forward bridge for databases upgraded from the historical chain.

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
| 1000040 | `1000040_backend_security_reconciliation.sql` | Consolidated report/editor RLS, API/RBAC, teaching scope, rate limiting, child-resource scope, idempotency, and report lifecycle |
| 1000041 | `1000041_legacy_upgrade_consistency.sql` | Legacy-to-canonical teaching-scope backfill and derived-resource consistency checks |

The missing versions `1000010`, `1000015`, and `1000016` are historical unused numbers, not missing files. The consolidated 1000040 file preserves the former 1000040–1000062 sections in dependency order because none of those files has been deployed. `1000041` must run after 1000040; it is intentionally not folded into the canonical security migration so operators can identify and verify the legacy-data upgrade step independently.

## Consolidated 1000040 security migration

The single unreleased migration contains these ordered sections:

1. Report editor ownership and collaboration RLS.
2. Editor RBAC RPC guard and the pre-API fail-closed compatibility shim.
3. API/RBAC foundation, teaching backfill, canonical teaching scope helpers, and RLS.
4. RBAC epoch/cycle prevention and canonical action-specific policies.
5. Core sensitive-resource RLS hardening and hashed shared rate-limit storage.
6. Teacher permission catalogue, student/course scope fallback, holiday scope isolation, and session scope integrity.
7. Child-resource, transfer, enrollment, and teaching-scoped RBAC authorization.
8. Idempotency route/length/concurrency rules and report lifecycle atomicity.

Each section remains guarded, uses `CREATE OR REPLACE`/`DROP POLICY IF EXISTS`/conflict-safe backfills where appropriate, and is executed in the same order as the former files. The result is one canonical database state instead of multiple patches repeatedly redefining the same resolver and policy.

## Clean install

Start a disposable PostgreSQL/Supabase-compatible database, apply `supabase/tests/postgres_bootstrap.sql`, then run every `supabase/migrations/*.sql` file in lexical order with `ON_ERROR_STOP=1`. Finish with `supabase/tests/migration_chain_integration.sql`.

## Upgrade an existing database

Back up the database first. Apply only migrations not recorded in the migration history. For a pre-reconciliation database, apply `1000040_backend_security_reconciliation.sql` followed by `1000041_legacy_upgrade_consistency.sql` after the legacy fixture/compatibility checks, then run `supabase/tests/migration_upgrade_assertions.sql`, `supabase/tests/report_lifecycle_integration.sql`, and `supabase/tests/core_rls_security.sql`. Do not edit migrations through 1000039.

## Rerun and rollback

The consolidated `1000040_backend_security_reconciliation.sql` and the `1000041` bridge are written to be rerunnable where PostgreSQL permits it (`IF EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT`, and guarded backfills). Always take a backup before rerunning. Prefer restoring the backup or applying a reviewed forward migration for rollback; do not use destructive `down` scripts against production history.

## Verification

The CI database gate runs clean install, reruns the consolidated 1000040 migration and the 1000041 bridge, the report lifecycle assertion, upgrade fixture and assertions, rate-limit checks, and the executable cross-teaching RLS fixture. The backend security gate runs Deno static tests. The frontend gate runs `npm ci`, `npm run test -- --run`, and `npm run build` in `app`.
