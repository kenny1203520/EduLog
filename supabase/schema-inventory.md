# Public schema inventory

This inventory reviews the repository's migration chain through `1000098_profile_names_and_auth_email.sql` against references in `app/src`, `server/src`, and database functions, triggers, and policies in the migrations. It is a static source review, not a live database catalog or row-count report: `psql`, Docker, and the Supabase CLI are not available in this environment. Confirm the deployed database before any cleanup.

`Referenced` means the app or server has a direct table/view reference. `Database-only` means repository SQL depends on the object even when no direct app/server table reference exists. Historical rows in migration files are not evidence that the object still exists in the current schema.

## Current tables

| Area | Table | Current use and evidence | Disposition |
| --- | --- | --- | --- |
| Teaching records | `students` | Student management, roster, reports, enrollment and aggregate API. | Active; retain. |
| Teaching records | `student_contacts`, `student_schools`, `student_credentials` | Student profile read/write services and sensitive-data endpoints. | Active; retain. |
| Teaching records | `teacher_records` | Teacher API and teacher-to-profile link; renamed from `teachers` in `1000097`. | Active; retain. |
| Teaching records | `teacher_credentials` | Teacher credential and external platform account flows. | Active; retain. |
| Teaching records | `classrooms`, `classroom_schedules` | Classroom management, role scopes, scheduling and aggregate APIs. | Active; retain. |
| Teaching records | `courses`, `lessons` | Course/catalog, enrollment, report and lesson APIs. | Active; retain. |
| Teaching records | `class_sessions`, `class_session_schedule_rules`, `class_session_teachers` | Session management, recurring schedules and instructor assignments. | Active; retain. |
| Teaching records | `enrollments`, `class_occurrences`, `occurrence_reports` | Enrollment, attendance, lesson occurrence and report workflows. | Active; retain. |
| Teaching records | `holidays`, `student_suspensions` | Holiday synchronization and student suspension workflows. | Active; retain. |
| Teaching records | `copy_templates`, `report_templates` | Template management and copy/report creation flows. | Active; retain. |
| Teaching records | `report_versions` | Report version history, restore and transfer support. | Active history; retain. |
| Teaching records | `single_lesson_transfers` | Transfer workflow and associated report updates. | Active; retain. |
| Collaboration | `report_collab_docs` | Collaborative report editor provider and server routes. | Active; retain. |
| Collaboration | `documents` | Generic document and report-field conflict handling. | Referenced by app conflict-resolution logic; confirm remaining feature use before considering cleanup. |
| Identity and RBAC | `profiles` | Canonical person profile; auth-facing and teacher-facing APIs. | Active; retain as the single person-profile source. |
| Identity and RBAC | `roles`, `permissions`, `role_inheritance`, `role_permission_policies`, `user_role_assignments` | Role catalogue, inheritance, scope policies and assignments. | Active authorization core; retain. |
| Identity and RBAC | `teachings`, `teaching_members` | Global teaching space membership and role/resource scope. | Active authorization core; retain. |
| Identity and RBAC | `user_preferences`, `user_entity_visibility_preferences` | User display preferences and per-user entity visibility. | Active preference features; retain. |
| Identity and RBAC | `rbac_policy_epoch` | Read and mutation RPCs use it to invalidate cached authorization state. | Database-only authorization dependency; retain. |
| Identity and RBAC | `rbac_domain_rebuild_state` | Migration `1000081` records completion; `1000082` checks it before installing management functions. | Migration-state candidate; do not remove without replacing the rerun/precondition guard and validating deployed history. |
| Audit and account operations | `audit_events` | Server audit writer, audit API and audit UI. | Active audit history; retain. |
| Audit and account operations | `user_status_events` | Account-status SQL function writes status-change history. | Database-only audit history; retain. |
| Audit and account operations | `api_idempotency_keys` | Idempotency RPCs used by server mutation flows. | Database-only request-safety dependency; retain. |
| Audit and account operations | `api_rate_limit_buckets` | Shared rate-limit RPC used by server middleware. | Database-only security dependency; retain. |
| Transfer history | `single_lesson_transfer_report_archives` | Transfer conflict-resolution SQL stores report snapshots here. | Database-only history; retain. |
| Migration support | `global_scope_migration_report` | Migrations `1000096`–`1000097` persist conversion counts, conflicts and review details; no current app/server reference found. | Cleanup candidate after its report has been reviewed and retained/exported as required. Not removed in this work. |

## Current compatibility and account views

| View | Purpose and evidence | Disposition |
| --- | --- | --- |
| `user_accounts` | Permission-filtered account directory used by server account search, RBAC assignment labels and the generic user resource. Login email comes from `auth.users`; profile names come from `profiles`. | Active API projection; retain. |
| `teachers` | Compatibility projection over canonical `teacher_records` and `profiles`, used by teaching APIs. | Active compatibility surface; retain until all callers migrate. |
| `teacher_role_types` | Compatibility projection over RBAC `roles`; not a physical table after the RBAC migration. | View, not a table-removal candidate; check external clients before removing. |
| `incomplete_report_notification_rules` | Compatibility projection over `role_permission_policies` for the existing incomplete-report notification permission. | View, not a physical table-removal candidate; check external clients before removing. |

## Objects already removed by the migration chain

| Object | Migration evidence | Current conclusion |
| --- | --- | --- |
| `person_profiles` | Created by `1000096`, merged into `profiles`, then dropped by `1000097`. | Already removed from the latest schema; the historical migration files must remain append-only. |
| `incomplete_report_notification_rules` table | Legacy table dropped by `1000027`; a compatibility view with the same name is created over RBAC policy data. | No physical table remains in the current chain. |
| `active_report_editors`, `report_collab_awareness`, `report_collab_ops`, `report_locks`, `report_sync_metadata` | Deprecated collaboration tables dropped by `1000017`. | Already removed; no additional drop migration is indicated. |
| `teachers` table | Renamed to `teacher_records` by `1000097`; a `teachers` view remains for compatibility. | Do not confuse the view with a second teacher table. |
| `teacher_role_types` table | Renamed to `roles` in the RBAC foundation; a compatibility view remains. | Do not confuse the view with a second role table. |

## Cleanup findings

- Static references support retaining the operational, profile, authorization, audit, collaboration, and transfer-history tables listed above.
- `global_scope_migration_report` is the only current table identified as migration-report storage without an app/server caller. Review and preserve its report contents before any future removal.
- `rbac_domain_rebuild_state` has no app/server caller but is read by later migration guards. Removal would require a reviewed replacement strategy for migration reruns and upgrade validation.
- Several tables are only read or written through SQL functions, triggers, or policies. A search for direct `.from('<table>')` calls alone would incorrectly label those as unused.
- This report does not verify production rows, external integrations, ad hoc SQL, deployed view definitions, or migration history. Those must be checked before approving any `DROP TABLE` or `DROP VIEW`.
