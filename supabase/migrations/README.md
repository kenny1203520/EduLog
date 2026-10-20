# EduLog migration chain

Before `1000096_global_teaching_scope_and_person_profiles.sql`, run the read-only `supabase/preflight/global_teaching_scope_report.sql` against the target database, review/export the counts and ID-only conflicts, and take a restorable backup. Before `1000097_profiles_as_person_master.sql`, run `supabase/preflight/profiles_person_master_report.sql`, export its counts and ID/field conflicts, and take a second restorable backup. The latter migration keeps `profiles` as the sole person-data table, folds `person_profiles` into it, preserves proven account/teacher links, and removes duplicate teacher profile fields. Do not apply either cutover until the relevant report and permission changes have been reviewed. The stored report is service-role only; do not grant general user access to it.

For authenticated self-service credential changes, configure Supabase Auth to require the current password for password updates. To match the email-change flow's new-address-only confirmation, disable Secure email change in the Supabase Auth project settings; this setting is external to the repository and must be applied separately in each environment.

The canonical chain is the individual migration files listed below. The former consolidated migration names are not valid inputs. Existing migrations through `1000080` remain unchanged. The current forward migrations add strict system/teaching RBAC domains (`1000081`), atomic RBAC management functions (`1000082`), system-managed account status (`1000083`), canonical suspension attendance/occupancy semantics (`1000084`), regular-enrollment-only report provisioning (`1000085`), the missing invoker table grants required by attendance evaluation (`1000086`), aligned report INSERT RLS (`1000087`), permission parity for roster provisioning (`1000088`), removal of the stale report INSERT policy (`1000089`), a narrow authenticated provisioning command that isolates placeholder insertion from interactive report CRUD (`1000090`), an occurrence-date-scoped class-session roster read model (`1000091`), scoped teaching-role permission policies (`1000092`), overlapping system-role assignment protection (`1000093`), the audit-event date index (`1000094`), classroom-scoped teaching-role assignments (`1000095`), the initial global teaching scope and canonical person profile transition (`1000096`), the final single-`profiles` person model (`1000097`), distinct full-name/nickname fields with Auth-owned login email (`1000098`), current report collaboration snapshot RLS (`1000103`), domain-aware permission policies (`1000104`), query-performance indexes (`1000105`), separate action-specific RBAC policy RLS (`1000106`), transfer-aware occurrence rosters with private class-session invalidation hints (`1000107`), date-scoped class-session invalidation (`1000108`), target-occurrence workspace inclusion for report-backed makeup enrollments (`1000109`), a restored standalone lesson course lookup index (`1000113`), a unified effective occurrence roster for report-backed makeup enrollments (`1000114`), report-occurrence-authoritative makeup roster membership (`1000115`), and web-extension integration metadata and revocable connection credentials (`1000116`). `1000041a_has_api_permission_compatibility.sql` intentionally sorts between `1000041` and `1000042`.

This directory contains the append-only database history for EduLog. Existing migrations must not be edited. The current chain includes the pre-1000058 compatibility step and the forward-only repairs through 1000141, without rewriting applied migration files. Versions 1000116–1000127 and 1000130–1000141 are the web-extension migrations from `feature/9-web-extension`; 1000128 and 1000129 only depend on the existing student table and permission functions, so a database that already recorded later web-extension migrations applies them as pending independent steps.

The `1000078` read-model migration covers courses, classrooms, teachers, incomplete reports, holidays, and class-session workspaces with authenticated-only, explicit projections.

The `1000079` read-model migration exposes only a student's current school name, grade, class, and status to the ordinary student read boundary; complete school history and school identifiers remain sensitive data.

The `1000080` read-model migration is the canonical source for incomplete-report calculation. It only considers existing present reports, applies the five-field completion rule, resolves notification policy once per classroom/session/date, and returns exact filtered totals with server-side pagination.

The `1000081` migration rebuilds the role catalogue into separate system and teaching domains while preserving business data and remapping memberships. `1000082` exposes the only authenticated RBAC mutation boundary through atomic, epoch-checked RPCs. `1000083` adds active/disabled account status, audit events, last-system-owner protection, and a service-role-only bootstrap function.

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
| 1000071 | `1000071_student_rls_enrollment_lookup_index.sql` | Index for correlated student RLS enrollment lookups |
| 1000072 | `1000072_sensitive_data_permissions.sql` | Owner-scoped sensitive student/teacher data boundary and guarded RPCs |
| 1000073 | `1000073_dashboard_page_read_model.sql` | RLS-scoped Dashboard page read model and query indexes |
| 1000074 | `1000074_dashboard_read_model_hardening.sql` | Dashboard count privilege/performance hardening and schema reload |
| 1000075 | `1000075_dashboard_query_segmentation.sql` | Segmented exact-count invoker RPC for Dashboard API |
| 1000076 | `1000076_dashboard_counts_set_based.sql` | Controlled set-based exact Dashboard aggregate |
| 1000077 | `1000077_students_overview_set_based.sql` | Controlled set-based Student overview pagination and exact total |
| 1000078 | `1000078_page_api_performance_read_models.sql` | Controlled set-based Course, Classroom, and Teacher Page API read models |
| 1000079 | `1000079_student_profile_school_summary.sql` | Safe current-school summary for Student overview and profile Page APIs |
| 1000080 | `1000080_incomplete_report_calculation.sql` | Canonical incomplete-report calculation, notification scope, filtering and pagination |
| 1000081 | `1000081_rbac_domain_rebuild.sql` | Strict system/teaching role domains, built-in templates, remapping and domain guards |
| 1000082 | `1000082_rbac_management_functions.sql` | Epoch-checked atomic role, inheritance, policy and system assignment management RPCs |
| 1000083 | `1000083_system_user_status.sql` | Active/disabled account status, status audit and protected system-owner bootstrap |
| 1000084 | `1000084_suspension_attendance_and_capacity.sql` | Effective suspension attendance, roster-preserving occupancy and atomic suspension synchronization |
| 1000085 | `1000085_report_provisioning_status_guard.sql` | Restrict new occurrence report placeholders to regular enrollments |
| 1000086 | `1000086_report_attendance_table_grants.sql` | Grant authenticated invoker reads protected by attendance RLS policies |
| 1000087 | `1000087_report_provisioning_rls_alignment.sql` | Align report placeholder INSERT RLS with regular-enrollment provisioning |
| 1000088 | `1000088_report_provisioning_permission_parity.sql` | Keep report provisioning RLS permissions in parity with the command |
| 1000089 | `1000089_remove_stale_report_insert_policy.sql` | Remove the pre-canonical all-operation report policy |
| 1000090 | `1000090_narrow_report_provisioning_command.sql` | Isolate guarded placeholder insertion from interactive report CRUD RLS |
| 1000091 | `1000091_session_roster_as_of_occurrence_date.sql` | Scope class-session roster reads to the selected occurrence date and completed-report boundary |
| 1000092 | `1000092_scoped_teaching_role_permission_matrix.sql` | Add teaching-role policies at teaching, classroom, and class-session scopes |
| 1000093 | `1000093_system_role_assignment_overlap_guard.sql` | Merge and prevent overlapping effective intervals for the same system role assignment |
| 1000094 | `1000094_audit_events_created_at_index.sql` | Support newest-first audit pagination and date-range queries |
| 1000095 | `1000095_classroom_teaching_role_assignments.sql` | Support authorized classroom-scoped teaching-role assignments with overlap protection |
| 1000096 | `1000096_global_teaching_scope_and_person_profiles.sql` | Establish global teaching scope, canonical account/teacher person profiles, and an ID-only cutover report |
| 1000097 | `1000097_profiles_as_person_master.sql` | Make `profiles` the only person table and move teacher data to it |
| 1000098 | `1000098_profile_names_and_auth_email.sql` | Separate formal name and nickname; keep login email in Supabase Auth |
| 1000099 | `1000099_platform_teaching_role_hierarchy.sql` | Promote teaching roles to the platform root with classroom/session exclusions |
| 1000100 | `1000100_platform_teaching_roles_without_workspace.sql` | Remove teaching workspaces from runtime role and policy scopes |
| 1000101 | `1000101_private_invoker_views_and_lint_remediation.sql` | Restrict private user/teacher views and address reported RLS/index lints |
| 1000102 | `1000102_student_overview_global_visibility.sql` | Include standalone students for platform-level readers while retaining scoped enrollment access |
| 1000103 | `1000103_report_collaboration_authorization.sql` | Bind report snapshots to current teaching RBAC and split RLS by operation |
| 1000104 | `1000104_domain_aware_permission_policies.sql` | Align permission-policy replacement authorization with permission domains |
| 1000105 | `1000105_query_performance_indexes.sql` | Add report creation, lesson sequence, and student birthday indexes recommended by Query Performance |
| 1000106 | `1000106_rbac_policy_select_overlap.sql` | Split RBAC policy read/write RLS to leave one authenticated permissive SELECT policy |
| 1000107 | `1000107_effective_session_roster_and_invalidation.sql` | Use transfer-effective class occurrence rosters and broadcast private class-session invalidation hints |
| 1000108 | `1000108_date_scoped_class_session_invalidation.sql` | Scope class-session invalidation hints to affected dates for reports, rosters, transfers, suspensions, and holidays |
| 1000109 | `1000109_makeup_reports_in_session_workspace.sql` | Include report-backed one-off makeup enrollments in the target occurrence workspace only |
| 1000110 | `1000110_teaching_role_sources_and_enrollment_visibility.sql` | Link class-session teacher assignments to reversible role grants and use student-read access for enrollment creation |
| 1000111 | `1000111_qualify_effective_teaching_role_columns.sql` | Qualify effective-role CTE columns to avoid PL/pgSQL output-variable ambiguity |
| 1000112 | `1000112_target_scoped_enrollment_visibility.sql` | Require student read and enrollment create permissions in the target teaching scope |
| 1000113 | `1000113_lessons_course_id_index.sql` | Restore a standalone B-tree index for lesson lookups by course |
| 1000114 | `1000114_unified_occurrence_makeup_roster.sql` | Unify report-backed makeup eligibility in the shared effective occurrence roster |
| 1000115 | `1000115_report_occurrence_authoritative_roster.sql` | Make the target occurrence's report link authoritative for makeup roster membership |
| 1000116 | `1000116_web_extension_integrations.sql` | Browser extension pairing, revocable token hashes, source links, import metadata, and report push audit |
| 1000117 | `1000117_web_extension_installations.sql` | Browser installation labels, one active authorization per known installation, atomic pairing claim and legacy adoption |
| 1000128 | `1000128_student_create_permission_alignment.sql` | Align student INSERT RLS with platform create permission and allow INSERT RETURNING through the existing platform read grant |
| 1000129 | `1000129_student_sensitive_permission_alignment.sql` | Resolve student sensitive permissions through platform grants or authorized enrollment paths without requiring an enrollment for platform access |
| 1000142 | `1000142_cancel_single_lesson_transfer_chain.sql` | Cancel single-lesson transfers with their onward chain, restore merged reports, and list an occurrence's transfers |
| 1000143 | `1000143_enrollment_class_history.sql` | Date-effective enrollment class history for rosters and class transfers |
| 1000144 | `1000144_sync_enrollment_reports.sql` | Keep an enrollment's placeholder reports on its first eligible lessons |
| 1000145 | `1000145_dashboard_schedule_visibility_permission.sql` | Permissions that let roles see every class in today's schedule |
| 1000146 | `1000146_single_lesson_transfer_rbac_permission.sql` | Authorize single-lesson transfers by RBAC and close the ownerless-enrollment check gap |
| 1000147 | `1000147_dashboard_schedule_scoped_visibility.sql` | Per-classroom and per-class today's-schedule modes, including hiding the schedule |
| 1000148 | `1000148_source_report_identity.sql` | Source report IDs as the import identity backbone |
| 1000149 | `1000149_ai_report_assist.sql` | AI report assistant tables, AI permissions and per-user AI preferences |
| 1000150 | `1000150_report_version_null_content.sql` | Version snapshots accept a cleared (NULL) learning report |
| 1000153 | `1000153_ai_generation_running.sql` | AI generations recorded as running from the start, with completed_at |

The missing versions `1000010`, `1000015`, and `1000016` are historical unused numbers, not missing files. Apply migrations in lexical order; `1000041a` sorts between `1000041` and `1000042`, and `1000057a` sorts between `1000057` and `1000058`.

## Current canonical chain

The security and scope changes are intentionally kept as separate migration files. Apply `1000040` through `1000061` in lexical order, including `1000057a` before `1000058`, then apply `1000062` through `1000141` in order. Enrollment creation requires both student-read and enrollment-create permission in the destination teaching scope; it does not require a pre-existing enrollment to make the student visible. Do not use the deleted consolidated migration names; they are not part of the current chain.

## Clean install

Start a disposable PostgreSQL/Supabase-compatible database, apply `supabase/tests/postgres_bootstrap.sql`, then run every `supabase/migrations/*.sql` file in lexical order with `ON_ERROR_STOP=1`. Finish with `supabase/tests/migration_chain_integration.sql` and `supabase/tests/student_create_permission_integration.sql`. The student fixture rolls back its grants and data, verifies platform teacher INSERT RETURNING with null legacy ownership, and denies local, unassigned, explicitly denied, and create-only read access. Repeat 1000128 and the fixture to verify rerun safety.

## Upgrade an existing database

Apply `1000129` to fix false privacy restrictions on students without enrollments. It replaces only the sensitive-permission helper, preserving its signature and dependent RPC/RLS contracts. Platform read-sensitive and update-sensitive grants are independent of enrollment state; local grants require at least one authorized enrollment path. Local denies apply to that path, platform denies remain effective across paths, and legacy ownership does not grant sensitive access. Direct SELECT/UPDATE privileges on student PII remain restricted. Run `supabase/tests/student_sensitive_permission_integration.sql` after applying the migration and again after rerunning it; the rollback-only fixture checks profile capabilities, private RPCs, child-table RLS, read/write separation, enrollment changes and deny precedence.

Back up the database first. Apply only migrations not recorded in the migration history. For a database at 1000039, apply the individual 1000040-1000061 files in lexical order, including 1000057a before 1000058, then apply 1000062-1000153 in order. Run both 1000096 and 1000097 preflight reports against the relevant pre-migration schemas, and do not apply 1000097 before its report has been reviewed. A database that has already recorded 1000058 must not apply 1000057a out of order; apply the pending forward repairs in version order. Finish with the migration upgrade, RBAC scope, report lifecycle, sensitive-data, Dashboard read-model, core RLS, RBAC domain, suspension/occupancy, report-provisioning, attendance privilege, report RLS, stale-policy, narrow-command, occurrence-roster, audit-index, profiles-person, student-overview, role-policy-per-action, transfer-aware session invalidation, date-scoped invalidation, makeup-roster, unified occurrence-roster, report-authoritative roster, and target-scoped enrollment authorization assertions. Do not edit historical migrations.

## Rerun and rollback

The individual migrations are written to be rerunnable where PostgreSQL permits it (`IF EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT`, and guarded backfills). Always take a backup before rerunning. Prefer restoring the backup or applying a reviewed forward migration for rollback; do not use destructive `down` scripts against production history. Migrations `1000074` and `1000105` create indexes with ordinary `CREATE INDEX` for transactional migration compatibility; schedule them during a low-write window because index builds can hold write-blocking table locks.

## Verification

The CI database gate runs clean install, historical upgrade, `1000062`–`1000098` rerun, RBAC scope constraint checks, report lifecycle and replay assertions, rate-limit, sensitive-data and Dashboard read-model checks, upgrade fixture and assertions, and the executable cross-teaching RLS fixture. The backend security gate runs Deno static tests. The frontend gate runs `npm ci`, `npm run test -- --run`, and `npm run build` in `app`.

## Append-only history boundary

Do not consolidate, rename, delete, or rewrite existing migrations `1000040`–`1000073`. An existing database records migration versions, so replacing a file with the same version cannot repair an already-applied database. Use new forward migrations such as `1000074+` for deployed databases. The `1000057a` compatibility file is for ordered clean/upgrade chains before `1000058`; it is not a replacement for `1000065` on a database that has already applied `1000058`. The `1000041a` compatibility migration remains before `1000042` so its function grant target exists during clean installation. `1000066` keeps the policy replacement RPC explicitly scope-authorized and atomic while preserving RLS for direct table access. `1000067` qualifies idempotency table columns to avoid collisions with its output variables. `1000068` grants authenticated session table operations only alongside per-action teaching-scoped RLS policies, and requires the session RPC to remain invoker-security. `1000069` fills legacy report-template teaching scopes from their instructor owner and isolates unresolved rows in quarantine. `1000070` grants the invoker session RPC SELECT on referenced classroom/course tables only after verifying their teaching-scoped SELECT RLS policies; anonymous SELECT remains revoked. `1000071` adds only the missing enrollment foreign-key index required by the student RLS predicate and does not relax any policy. `1000072` adds owner-scoped sensitive-data permissions and guarded RPCs without changing the general page projections. `1000073` adds only the Dashboard read model and supporting date/report indexes; `1000074` replaces its count path with explicit visible student IDs, adds the owner lookup index, and reloads the PostgREST schema cache; neither migration bypasses RLS. Index creation takes a write-blocking table lock while it builds, so deploy it during a low-write window on production; the index is deliberately created with ordinary `CREATE INDEX` to remain compatible with transactional migration runners.

## Extension work-record metadata (1000131)

`1000131_extension_work_record_metadata.sql` adds account-scoped names, pin/archive state, and verified source/target summaries for extension work records. It does not store source report text, form contents, or local drafts. Apply it after `1000130_import_preview_dependencies_and_diagnostics.sql` when deploying the current extension package. The extension capability endpoint reports work-record metadata support only when the migration RPC is available.

## Extension report skip decisions (1000132)

`1000132_extension_report_skip_decisions.sql` stores account-scoped skip fingerprints and revisions, without source report text. It supports resolve and revision-checked confirm/clear batches of up to 50 reports, with a 30-day confirmation window. Apply it after `1000131_extension_work_record_metadata.sql`; the extension exposes cross-device skip memory only when the capability RPC succeeds.

## Extension stale-import recovery and submission rounds (1000136)

`1000136_import_preview_diagnostics_and_work_rounds.sql` adds safe, allowlisted `PREVIEW_STALE` diagnostics and account-scoped links from one stable local work record to successive server import jobs. Apply it after `1000135_extension_mapping_conflict_diagnostics.sql`. The migration does not store source report text or change import/apply permissions; stale batches remain blocked until the teacher reviews a fresh preview.

`1000139_precise_preview_stale_diagnostics.sql` replaces rollback-time stale checks with diagnostics emitted at the actual preview, target-version, and history-to-occurrence version checks. Apply after `1000138_paused_import_repreview.sql`; keep the existing version and transaction checks unchanged. Only checks marked `version_check` may produce allowlisted `error.fields`; the API logs sanitized identity and version metadata without report contents.

## Single-lesson transfer cancellation (1000142)

`1000142_cancel_single_lesson_transfer_chain.sql` replaces `cancel_single_lesson_transfer` (now returning a jsonb summary) so any user allowed by `can_access_single_lesson_transfer` can cancel. Cancelling a transfer cancels its active onward chain and returns the report to the original occurrence; a blank placeholder on the source is removed, a source report with content raises `SOURCE_REPORT_HAS_CONTENT`, and a conflict-tool merge is undone by restoring the archived source report while the target report stays on the target. It also adds `get_occurrence_lesson_transfers` for the class page. Apply after `1000141_import_lifecycle_effect_receipts.sql` and run `supabase/tests/single_lesson_transfer_cancel_integration.sql`.

## Date-effective class transfers (1000143)

`1000143_enrollment_class_history.sql` adds `enrollment_class_history`, a per-enrollment record of which class it belonged to over time; `enrollments.class_session_id` stays the current class. The occurrence roster, the class session workspace and the single-lesson transfer source check read the history, so a student stays on the old class's roster before a class transfer's effective date. The transfer source check also accepts an occurrence that holds the student's report. `transfer_enrollment_class` moves an enrollment from an effective date (inclusive): blank placeholder reports on or after that date move to the new class's lessons in date order, and reports with content stay in the old class and are returned as `retained_reports`. A trigger keeps the history in step with enrollment inserts, start-date edits and direct class changes (which switch from today).

The backfill opens one segment per enrollment for its current class. A previous class is inferred only when the enrollment holds at least two reports there that are not single-lesson transfer targets and that all predate its first report in the current class; isolated make-up reports stay report-backed. Review the inferred segments after applying (`SELECT * FROM enrollment_class_history WHERE effective_to IS NOT NULL`). Apply after `1000142_cancel_single_lesson_transfer_chain.sql` and run `supabase/tests/enrollment_class_history_integration.sql`.

## Enrollment report placeholders (1000144)

`1000144_sync_enrollment_reports.sql` adds `sync_enrollment_reports(enrollment, target_count, start_date, dry_run)`. It keeps the enrollment's blank placeholder reports on its first eligible lessons from the start date, for this enrollment only, trial enrollments included. Reports with content, reports on an active transfer target, and reports outside the class history are fixed: they count toward the target and are never moved or deleted. The API uses it when an enrollment is created with a report count, when a trial becomes regular, and when the start date changes (the same number of reports shifts with the new date). `GET /api/enrollments/{id}/start-date-impact` returns the dry run so the client can warn before saving. Apply after `1000143_enrollment_class_history.sql` and run `supabase/tests/enrollment_report_sync_integration.sql`.

## Dashboard schedule visibility (1000145)

`1000145_dashboard_schedule_visibility_permission.sql` adds `teaching.dashboard.schedule.all` (allowed for `teaching_owner` and `teaching_manager`) and `system.dashboard.schedule.all` (allowed for `system_owner` and `system_admin`). The dashboard API shows every scheduled, non-cancelled occurrence visible through RLS to users holding either permission, and only class sessions with an effective `class_session_teachers` assignment to everyone else. Apply after `1000144_sync_enrollment_reports.sql`.

## Single-lesson transfer authorization (1000146)

`1000146_single_lesson_transfer_rbac_permission.sql` recreates `prepare_repeatable_single_lesson_transfer` so a user with `teaching.enrollments.update` in both the source and target class may transfer, in addition to the enrollment owner and the assigned teacher of both lessons. It also fixes a gap in that check and in `repair_single_lesson_transfer_report`: the guard compared `enrollments.user_id <> auth.uid()`, which is NULL for enrollments without an owner, so the check was skipped and any signed-in user calling the RPC directly could transfer or repair. Both now use `IS DISTINCT FROM`. Apply after `1000145_dashboard_schedule_visibility_permission.sql` and run `supabase/tests/single_lesson_transfer_permission_integration.sql`.

## Dashboard schedule scoped visibility (1000147)

`1000147_dashboard_schedule_scoped_visibility.sql` adds `teaching.dashboard.schedule.view` and `resolve_dashboard_schedule_modes(user, class_session_ids, date)`. Each teaching role picks one of four modes per system, classroom or class scope: all (`schedule.all` and `schedule.view` allowed), assigned (`schedule.all` denied, `schedule.view` allowed), hidden (`schedule.view` denied) or inherit (no policy). Per role the most specific scope wins; across the user's teaching roles the strictest explicit mode wins (hidden > assigned > all). Roles without a policy never restrict, and a user with no explicit mode sees only the classes they teach. Only teaching roles decide the schedule: `system.dashboard.schedule.all` from 1000145 is deleted, so system owners and administrators without a teaching role set to all now see only the classes they teach. No new policies are seeded. Apply after `1000146_single_lesson_transfer_rbac_permission.sql` and run `supabase/tests/dashboard_schedule_visibility_integration.sql`.

## AI report assistant (1000149)

`1000149_ai_report_assist.sql` adds the AI report assistant data layer: `ai_credentials`, `ai_models`, `ai_prompt_versions`, `ai_quota_policies`, `ai_quota_ledger`, `ai_generations`, `ai_teaching_suggestion_states`, `ai_adoptions`, `ai_notice_acknowledgements` and the single-row `ai_settings` (master switch off by default, notice version, default model). It seeds `teaching.ai.generate` (allowed for `teaching_owner`, `teaching_manager` and `teacher`), `system.ai.manage` (`system_owner`, `system_admin`) and `system.ai.logs.view_all` (`system_owner`, `system_admin`, `auditor`), and adds `user_preferences.ai_settings`. Authenticated users only read: their own generations, adoptions, ledger rows, acknowledgements and personal credentials, plus active site credentials; `system.ai.logs.view_all` reads every generation and `system.ai.manage` reads the admin tables. All writes go through the API's service role. `ai_credentials.secret_ciphertext` is excluded from the authenticated column grant, so it is never returned through PostgREST. Generation logs are permanent: deleting a report, user, credential or model nulls the reference. Apply after `1000148_source_report_identity.sql` and run `supabase/tests/ai_report_assist_integration.sql`.

## Cleared report versions (1000150)

`1000150_report_version_null_content.sql` fixes saving a report after its learning report was cleared. The lifecycle RPC stores an emptied body as NULL, but `report_versions.content` is NOT NULL, so the next change failed in `create_report_version_snapshot`. The snapshot now records NULL as an empty string; the full row stays in `snapshot`. Apply after `1000149_ai_report_assist.sql`.

## AI de-identification rules (1000151)

`1000151_ai_deidentification_rules.sql` lets administrators tune de-identification from Settings → AI report assistant → De-identification. `ai_deid_rules` holds custom rules: `deny_list` (words always replaced), `regex` (a pattern always replaced) and `allow_list` (exception words NER must not replace); `placeholder_kind` picks the token (`sensitive` is the new `[敏感A]`), and `languages` limits a rule to some languages (empty = every enabled one). Exceptions never override known students, teachers or schools; the API drops exception words that contain a known name and the residual check still fails closed. `ai_settings.deid_languages` (default `{zh}`) lists the Presidio languages analyzed for each request; every language must be installed in the analyzer image (`PRESIDIO_LANGUAGES` build argument). Only `system.ai.manage` reads the rules; writes go through the API's service role. Apply after `1000150_report_version_null_content.sql` and run `supabase/tests/ai_deidentification_rules_integration.sql`.

## Running AI generations (1000153)

`1000153_ai_generation_running.sql` lets `ai_generations.status` be `running` and adds `completed_at`, which a trigger sets when a generation leaves `running` and clears while running. The API records a generation when it starts and finishes the row when it ends, so a teacher who loses connection still finds the result. Running rows cannot charge quota. Apply after `1000152_incomplete_report_notification_rbac.sql` and run `supabase/tests/ai_generation_running_integration.sql`.
