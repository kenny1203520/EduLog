# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0-alpha.3] - 2026-10-23

### Added
- Added the AI report assistant with personal provider credentials, model selection, de-identification rules, generation history, and adoption tracking.
- Added the browser-extension side-panel report editor and direct form filling, with interface translations that follow the teaching site.
- Added class timelines, a paged class calendar, and clearer transfer-history feedback.

### Changed
- Report editing keeps local drafts safe through network loss, retries unsent changes, and resolves conflicts using editable fields only.
- AI generation can continue after disconnects and recover structured drafts from more provider response formats.
- Realtime side-panel connections use one-time tickets, while cached reads remain available as the ticket is issued.

### Fixed
- Fixed report and classroom loading, AI assistant panel visibility, OpenRouter sign-in return handling, and extension side-panel form checks.

### Deployment Notes
- Publish matching frontend and API images tagged `2.0.0-alpha.3`; alpha images do not update stable aliases.
- Back up the database, then apply all unapplied migrations in filename order through `1000155_enrollment_transfer_log.sql`.
- Configure `API_EXTENSION_ALLOWED_ORIGINS` and `EDULOG_WEB_BASE_URL` before using the extension integration. No production deployment is included.
- Release notes are generated from GitHub pull requests and commits when the `v2.0.0-alpha.3` tag is published.

## [2.0.0-alpha.2] - 2026-10-17

### Added
- Added the browser-extension integration: PKCE pairing with revocable extension-scoped credentials, a workspace API for catalog and field mappings, and history report import with preview, reconciliation and lifecycle receipts.
- Rebuilt the extension provider view with a weekly to-do, class roster cards, lesson report cards, quick attendance tiles and a copyable attendance summary.
- Added date-effective class transfers recorded in a class history, and cancellation of single-lesson transfers from the class page and transfer history.
- Added per-classroom and per-class today's-schedule visibility for teaching roles: all classes, assigned classes only, or hidden, set beside report notifications under Role settings.
- Added a Playwright test runner and workflow scaffold.

### Changed
- Single-lesson transfers are authorized by RBAC (`teaching.enrollments.update` in both classes) in addition to teacher assignment.
- Report placeholders follow the enrollment start date, and back-dated lessons are filled in before placeholders are synced.
- Today's schedule is decided by teaching roles only; `system.dashboard.schedule.all` is removed.
- Student creation and sensitive-data access follow platform and scoped permissions; blank student emails are normalized.
- Reorganized the API source into config, http, infra, auth, domain, routes (rest, pages, extension), realtime and openapi folders.

### Fixed
- Fixed iOS Safari zooming in on focused inputs and staying zoomed; pinch zoom still works. The font-size steppers no longer zoom on double tap.
- Fixed the class page's live-status popover being clipped by the sidebar.
- Fixed single-lesson transfer rejections being shown without a reason, and v1 report occurrences not being read.
- Fixed ownerless enrollments skipping the single-lesson transfer and repair authorization checks.
- Fixed the release image check starting the API without the required `EDULOG_WEB_BASE_URL`.

### Tests
- Added integration fixtures for transfer cancellation, class history, report syncing, transfer RBAC and today's-schedule modes, plus unit coverage for the schedule editor and iOS viewport handling.

### Deployment Notes
- Publish matching frontend and API images tagged `2.0.0-alpha.2`; do not update stable image aliases for alpha releases.
- Back up an existing database and apply all unapplied migrations in filename order through `1000147_dashboard_schedule_scoped_visibility.sql`; follow `docs/deployment/rollout-1000142-1000146.md` for 1000142-1000146.
- After upgrading, system roles no longer widen today's schedule; assign a teaching role set to All classes where needed.
- The browser extension needs `API_EXTENSION_ALLOWED_ORIGINS` and `EDULOG_WEB_BASE_URL`; see `docs/deployment/web-extension.md`. No production deployment is included.
- See `.github/releases/v2.0.0-alpha.2.md` for prerequisites and limitations.

## [2.0.0-alpha.1] - 2026-10-04

### Added
- Introduced the Express authentication/API backend with same-origin cookie sessions and server-only Supabase credentials.
- Added system administration, audit logs, and scoped teaching role assignments with inheritance and exclusions.
- Added course progress gap hints and effective occurrence rosters, including makeup students.

### Changed
- Routed frontend data and collaboration through the API backend; production configuration uses API v1.
- Improved scoped enrollment visibility, page read models, and collaboration reconnection.
- Published the currently available 2.0 functionality as an alpha prerelease; subsequent functionality will arrive in numbered alpha releases.

### Fixed
- Fixed school history edits sending read-only IDs and timestamps, causing `UNKNOWN_FIELD` errors.
- Fixed school history creation with a blank end date and clearing existing dates by sending `null`; unspecified PATCH dates remain unchanged.
- Fixed the Nginx bootstrap emitting a literal `api_location` directive instead of the API proxy configuration, preventing frontend container startup.
- Fixed occurrence report roster consistency, committed report state, and upstream WebSocket teardown.

### Tests
- Added school history form, writable-payload, nullable-date, and strict API validation regression coverage.
- Kept frontend/API tests and builds and migration/RLS/security gates required before image publication.

### Deployment Notes
- Publish matching frontend and API images tagged `2.0.0-alpha.1`; do not update stable image aliases for alpha releases.
- No production deployment is included. OAuth callbacks and a Storage proxy remain unavailable.
- Back up an existing database and apply all unapplied migrations in filename order through `1000115_report_occurrence_authoritative_roster.sql` before using this version. An image downgrade does not reverse schema changes.
- See `.github/releases/v2.0.0-alpha.1.md` and `docs/deployment/alpha-roadmap.md` for prerequisites, limitations, and stable promotion criteria.

## [1.8.1] - 2026-09-05

### Fixed
- Fixed report placeholder provisioning failing with `42501` under scoped RLS, which previously caused class detail pages to show a course-load error.
- Added a key-based report INSERT policy that validates the effective occurrence roster and assigned teacher, including single-lesson transfers.
- Kept class workspace loading usable when optional placeholder provisioning is denied; existing reports remain available.

### Tests
- Added regression coverage for RLS-denied placeholder upserts, non-authorization failures, and the editor INSERT policy contract.

### Deployment Notes
- Apply `1000037_editor_security_hardening.sql`, `1000038_editor_rbac_boundary_hardening.sql`, and `1000039_editor_report_insert_rls_fix.sql` in staging, verify assigned and unassigned teacher access, then deploy to production.
- Rebuild and redeploy the frontend with package version `1.8.1`.

## [1.8.0] - 2026-08-16

### Added
- Added a central error-feedback layer (`useFeedback`, a typed `AppError` hierarchy, and Supabase/domain error mappers) that resolves any thrown or returned error to a translated, persistent toast instead of raw English text, an untranslated domain code, or `[object Object]`.
- Added `datetimeFormats`/`numberFormats` to the i18n configuration and CLDR plural forms for count-based messages.
- Added a batched, narrow-column progress-summary query for session rosters, replacing one paginated full-row request per student with a single request for the whole roster.

### Changed
- Routed date/time display through the app's selected language instead of the browser's for the 13 places that previously formatted dates with no explicit locale, and rewrote autosave's relative-time labels with `Intl.RelativeTimeFormat`.
- Translated the remaining hardcoded strings across the report editor, save pipeline, and student detail views: icon-button tooltips, save-result and collaboration messages, and version/loading labels.
- Trimmed rich-text jsonb columns out of list-only report queries and the report save pre-fetch; the save pre-fetch now only pulls the full row when a conflict is actually detected.
- Batched several per-item request loops (teacher bulk delete, guest-enrollment lookups) into single queries, and removed a redundant session-teachers re-fetch that ran on every occurrence date navigation.

### Fixed
- Fixed several previously silent failures (transfer/enrollment schedule regeneration, a confirm-modal action, dashboard load, split-pane report search) to show an explanatory, actionable message instead of nothing or a misleading "no results" state.
- Fixed the `dashboard.schedule.time_zone` translation key being present in zh-TW but missing from en.
- Replaced the native `confirm()` prompt for PWA updates with the app's own confirmation dialog.
- Fixed the report editor showing an incorrect online participant count when multiple teachers shared a report.
- Fixed collaborative editor initialization races, stale refs, and Tiptap update timing that could hide inputs or throw runtime errors.
- Added bounded Yjs/Realtime payload validation, scoped report access, safe external links, and version-checked restore/conflict resolution.

### Tests
- Added regression coverage for the error mapping utilities, autosave retry behavior, the notifier's persistent-error-toast timeout, locale key parity between en and zh-TW, and the batched progress-summary query.
- Added coverage for collaboration participant counts, three-way conflict merge, private report access, bounded payloads, and safe external links.

### Deployment Notes
- Deploy migrations `1000037_editor_security_hardening.sql` and `1000038_editor_rbac_boundary_hardening.sql` before enabling private collaboration.
- Rebuild and redeploy the frontend with package version `1.8.0`.

## [1.7.5] - 2026-08-16

### Fixed
- Fixed the class report list rendering empty for enrollments with no single-lesson transfer history, even though the incomplete-reports banner correctly showed pending entries; `get_effective_single_lesson_transfer_targets` and `get_single_lesson_transfer_history` no longer require a transfer record to authorize an assigned teacher's read.
- Fixed assigned teachers being unable to view a student's historical reports on enrollments they did not personally create.
- Fixed the report list dropping reports whose class occurrence was missing from the merged schedule instead of showing them.
- Fixed autosave permanently stalling after a single failed save; new edits now correctly re-arm the retry queue.
- Fixed a Yjs collaboration broadcast being able to bypass optimistic-concurrency checks and silently overwrite another editor's saved content.
- Fixed every connected peer re-saving a remote collaborator's edit, multiplying writes and version conflicts for a single change.
- Fixed unsaved report content and collaborative snapshots being discarded on tab close, refresh, and report/occurrence switching.
- Fixed a stale collaborative snapshot being silently overwritten with older canonical content instead of being preserved for review.
- Fixed holiday closure/release syncing bumping report versions on reports already in the target state, needlessly invalidating open editors.

### Tests
- Added regression coverage for the report list surviving a forbidden transfer-target lookup, autosave retry after a failed save, and the relaxed read-authorization migration contract.

### Deployment Notes
- Apply `1000035_relax_transfer_read_authorization.sql` after the existing transfer migrations before deploying the frontend.
- Rebuild and redeploy the frontend with package version `1.7.5`.

## [1.7.4] - 2026-08-08

### Added
- Added a complete single-lesson transfer history interface on student enrollment cards, including active and closed audit records.
- Added recovery for missing reports on currently effective transferred lesson occurrences, with a guarded “regenerate report” action.
- Added repeatable transfer support so reports can move through chained lesson changes and return to a previous class without losing content or audit history.

### Changed
- Quick attendance now shows each student’s current course and smoothly scrolls to and highlights the matching roster card on desktop and mobile.
- Clarified attendance colors across calendars and report lists: green for present, red for absent, amber for pending attendance, and gray for scheduled or neutral states.
- Improved single-lesson transfer source selection, custom-date handling, conflict merging, and report scheduling so later lessons return to the enrollment’s normal class.

### Fixed
- Fixed transfer history and effective-target RPCs that could fail with ambiguous or missing column references.
- Fixed missing transferred reports being omitted from the student report page after a report was deleted or never created.
- Added credential validation for entries containing any one of username, password, or link, plus contact-card copy, email, and phone actions.

### Tests
- Added regression coverage for transfer chains, report recovery and idempotency, transfer history display, attendance status colors, roster scrolling, and release metadata.

### Deployment Notes
- Apply `1000034_repair_effective_single_lesson_transfer_reports.sql` after the existing transfer migrations before deploying the frontend.
- Rebuild and redeploy the frontend with package version `1.7.4`.

## [1.7.3] - 2026-08-01

### Added
- Added single-lesson transfer report conflict management with per-field source/target selection, non-empty content priority, and safe cancellation when a conflict cannot be resolved.
- Added human-readable transfer conflict details for lesson, class, classroom, date, attendance, ratings, progress, rich text, and external links, with collapsible technical IDs for support diagnostics.

### Changed
- Reports now follow the effective students for each lesson occurrence, so students transferred out of a class no longer receive a report recreated in the source lesson.
- Existing reports move with a single-lesson transfer and retain their content; missing source reports are created only when entering the target lesson.

### Tests
- Added regression coverage for effective lesson rosters, report migration and rollback, idempotency, conflict resolution, readable formatting, and release metadata.

### Deployment Notes
- Apply `1000030_single_lesson_transfers.sql` and `1000031_single_lesson_transfer_conflict_resolution.sql` in order before deploying the frontend.
- No existing reports are automatically cleaned up by this release.
## [1.7.2] - 2026-08-01

### Fixed
- Made the DHI Nginx runtime execute EduLog's bootstrap script explicitly, generate the active Nginx configuration, and listen on the Docker-exposed HTTP and HTTPS ports instead of retaining the base image's port 8080 configuration.
- Assigned built frontend files to the non-root Nginx user so startup can safely regenerate runtime-config.js without elevating container privileges.

### Tests
- Added a Docker runtime contract covering the explicit entrypoint, non-root file ownership, active Nginx configuration generation, command handoff, exposed ports, and LF-only Alpine shell script.
- Verified the production image with live container requests: /healthz, /, /runtime-config.js, and the generated JavaScript asset all return HTTP 200, with runtime configuration marked no-store.

### Deployment Notes
- No database migration or Edge Function deployment is required for v1.7.2.
- Rebuild and redeploy the application Docker image so the corrected entrypoint and file ownership are included.

## [1.7.1] - 2026-08-01

### Fixed
- Enforced the scoped role policy for incomplete reports on both the dashboard and incomplete-report workspace: recipients must be linked to a teacher, assigned and explicitly present for the occurrence, and allowed by their effective class role; any explicit absence or deny takes precedence.
- Made the policy-aware report query fail closed instead of silently falling back to the broader attended-teacher scope.
- Required an effective `class_session_teachers` assignment on the occurrence date before applying the system, classroom, and class-session notification hierarchy; generic RBAC assignments no longer substitute for a class role, and classes with no eligible role or policy notify nobody.
- Prevented stale or shared authorization results by disabling client caching for `my_notifications`, returning personalized aggregate responses with `private, no-store`, and clearing incomplete-report views when the policy endpoint fails.
- Limited automatic occurrence-report creation to enrollments whose current status is `regular`.
- Added a database trigger that completes a regular enrollment only when a persisted report is present, fully completed, and references the course's highest-sequence lesson; chapter and progress-letter checks are no longer used.
- Kept enrollment completion as a one-way transition and prevented completed enrollments from producing a next-lesson report.
- Made classroom edit, visibility, and delete controls permanently visible and touch friendly.
- Fixed student profile breakpoints and overflow, historical-report calendar month synchronization, and class schedule wrapping at narrow widths.
- Changed the RBAC compatibility views to security-invoker mode, fixed the role trigger function search path, and removed duplicate legacy indexes.
- Added a release quality gate so tests, production type-checking, and the application build must pass before the container image can be published.

### Tests
- Added regression coverage for attendance plus effective-date role-policy eligibility (including yuan's 2026-07-25 assistant deny case), deny precedence, no-policy fail-closed behavior, authorization-sensitive no-store responses, regular-only report creation, final-lesson completion, responsive controls, calendar synchronization, and database linter remediations.

### Deployment Notes
- Apply `1000028_rbac_security_performance_and_enrollment_completion.sql` after `1000027`.
- Apply `1000029_strict_incomplete_report_notification_eligibility.sql` after `1000028`.
- Deploy the updated `aggregate-incomplete-reports` Edge Function after `1000029`, then deploy the frontend so `my_notifications` bypasses client caching.


## [1.7.0] - 2026-07-30

### Added
- Added extensible system roles and scoped RBAC policy foundations for system, classroom, and class-session assignments.
- Added three-level incomplete-report notification policies with inherit, allow, deny, effective-source display, and deny precedence across multiple roles.
- Added responsive room management with room details, notification policies, searchable child classes, inline class policy editing, and safe return to the full class editor.
- Added direct three-state quick attendance, visible-result batch operations, responsive student roster cards, and class-wide roster filtering.
- Added an accessible globe language menu shared by the landing, login, application sidebar, and settings pages.

### Changed
- Restricted user-facing incomplete reports and dashboard tasks to students from class occurrences where the current assigned teacher was explicitly marked present.
- Separated notification eligibility from report visibility; notification aggregation continues to use scoped role policies without granting access to other teachers' reports.
- Made class occurrence initialization select and navigate actual adjacent occurrences, ensure eligible reports idempotently, and distinguish load failures from genuinely empty schedules.
- Reworked class headers, room cards, student rosters, quick attendance, split views, and management panels for 375px through desktop layouts.
- Restored native same-tab behavior for internal links while preserving middle-click, modified-click, keyboard, and context-menu navigation; external sites remain safely opened in new tabs.
- Made room and class creation retries update already-created entities when a dependent teacher, policy, or occurrence synchronization step fails.

### Fixed
- Removed the incomplete-report scope checkbox and misleading access to all teachers' reports.
- Fixed initial class entry requiring manual previous/next navigation before occurrence and roster data appeared.
- Fixed quick-attendance content collapsing into unreadable columns at narrow widths.
- Fixed class title, room, schedule, time-zone, display-time-zone, and external-link wrapping and overflow.
- Fixed room card information hierarchy for class type, schedule rules, classroom, time zone, capacity, courses, and external links.

### Tests
- Added coverage for strict teacher-attendance report visibility, scoped policy inheritance and deny precedence, room/class policy workflows, safe partial-failure retries, language menu accessibility, responsive metadata, and native navigation contracts.

### Deployment Notes
- Apply `1000026_teacher_roles_and_incomplete_report_notifications.sql`.
- Apply `1000027_rbac_foundation_and_scoped_permissions.sql` after `1000026`.
- Deploy the updated `aggregate-incomplete-reports` Edge Function after the migrations.
- No additional v1.7.0 database migration is required.

## [1.6.0] - 2026-07-21

### Fixed
- Positioned rich-text placeholders inside the content body so formatting toolbars no longer cover them.
- Localized rich-text editor toolbars, style controls, link prompts, accessibility labels, and template editor badges in English and Traditional Chinese.
- Detected nested Yjs text changes so report notes immediately become dirty and enter the save queue.
- Serialized report auto-save requests so edits made during an in-flight save remain dirty and are persisted by the next request.
- Synchronized report editor parent state from the authoritative database row after each successful save.
- Prevented stale or unversioned Yjs snapshots from overriding newer report content.
- Filtered enrollment, trial activation, and transfer class options by course compatibility.
- Automatically synchronized enrollment classrooms from their selected class sessions.
- Made classroom selection optional during enrollment and filled it from the selected class.
- Replaced the classroom session filter with a searchable selector.

### Added
- Added weekly multi-day, monthly day-of-month, and exact-date camp schedules with per-day class times.
- Added draft camps with editable date ranges and atomic session schedule persistence.
- Added safe future-occurrence reconciliation that preserves classes containing reports, attendance, notes, or actual times.
- Added shared plain-text and collaborative editor contracts with reusable appearance presets.
- Added versioned TipTap JSON documents, Unicode-aware metrics, formatting controls, rich/plain/HTML accessors, and reusable read-only rendering.
- Persisted TipTap JSON and its canonical plain-text projection atomically for reports, templates, course descriptions, student notes, and teacher biographies.
- Added rich clipboard output, atomic template variables, report field metrics, editor settings persistence, and rich-text conflict/version previews.
- Added runtime auto-save and collaboration configuration, connection/presence status, and structured editor notification adapters.
- Added version-gated Yjs snapshot persistence and recovery for collaborative report drafts.
- Added local frontend and self-hosted Supabase environment templates.

### Tests
- Added regression coverage for queued saves, conflicts, errors, resets, and manual draining.
- Added regression coverage for recurring and camp schedules, occurrence reconciliation, enrollment session eligibility, and classroom synchronization.

### Deployment Notes
- Apply `1000022_report_collab_snapshot_versioning.sql` before deploying frontend code that uses versioned collaboration snapshots.
- Apply `1000023_rich_text_documents.sql` before deploying frontend code that reads or writes rich-text documents.
- Apply `1000024_recurring_and_camp_sessions.sql` before deploying frontend code that manages recurring or camp schedules.
- Apply `1000025_enrollment_classroom_consistency.sql` after `1000024` to backfill and synchronize enrollment classrooms and enforce course-compatible class selections.
- Legacy collaboration snapshots remain stored but are ignored until replaced from canonical report content.

## [1.5.2] - 2026-06-15

### Fixed
- Added classroom filtering to the student enrollment modal.
- Expanded student enrollment class session options to show weekday and time range.

### Deployment Notes
- No database migration required.

## [1.5.1] - 2026-06-15

### Added
- Added an external report overview URL field to the new student enrollment modal.

### Fixed
- Constrained the student enrollment modal height so its form content scrolls correctly on smaller devices.
- Corrected the PWA manifest app name to display as `EduLog`.

### Deployment Notes
- No database migration required.

## [1.5.0] - 2026-06-15

### Added
- Global incomplete report dashboard with filtering and attendance scoping.
- SessionDetailsView and supporting report services for classroom management.
- Holiday management view with tabbed closure and teacher leave tracking.
- AggregateService for API data aggregation and environment-based runtime configuration with Docker support.
- Automated report version snapshots.
- `robots.txt` file to allow web crawlers.

### Changed
- Updated docker-compose environment variables to use standard Supabase configuration keys.
- Ignored local ssl certificate directories in gitignore.

### Tests
- Added unit tests for HolidayCommandService and HolidayQueryService.

## [1.4.0] - 2026-06-14

### Added
- Student management module with student profiles, contact management, school history, and course enrollment workflows.
- Native HTTPS support for the EduLog frontend with externally mounted certificate and key files.
- External GitHub changelog link from the in-app changelog view.

### Changed
- Updated EduLog frontend proxy and security header deployment configuration for Caddy, Nginx, and HTTPS upstream scenarios.
- Expanded `.env.example` with frontend hostname, HTTPS, SSL, HSTS, and CSP deployment settings.

### Fixed
- Ensured holiday updates and deletions release class occurrence locks and student attendance states after holiday ranges change.
- Fixed `aggregate-classroom-session-manager` visible/hidden filtering errors that could return 500 responses.
- Added HSTS and CSP headers for the EduLog frontend while keeping the default CSP free of `unsafe-eval`.

### Tests
- Added coverage for aggregate classroom session manager edge function behavior, holiday sync/release logic, and Vite security helpers.

### Deployment Notes
- No database migration required.
- To enable native EduLog HTTPS, mount certificate files into `/app/ssl` and set `EDULOG_HTTPS_ENABLED=true`.

## [1.3.3] - 2026-06-14

### Fixed
- Restored missing `v1.3.1` and `v1.3.2` changelog entries.

## [1.3.2] - 2026-06-14

### Fixed
- Bumped package.json version and updated documentation rules in AGENT.md.

## [1.3.1] - 2026-06-14

### Fixed
- Resolved TypeScript build errors in unit tests affecting the deployment pipeline.
- Fixed GitHub Actions warnings regarding Node.js 20 deprecation for the Docker build pipeline.

## [1.3.0] - 2026-06-14

### Added
- Real-time collaborative report editor (Yjs + Supabase + Tiptap).
- Student enrollment and scheduling management system.
- Holiday management integration.
- Global time zone configuration and support.
- Koding code check workflow integration.
- Remote selection visuals and presence tracking for collaboration.

### Changed
- Refactored `AggregateService` to introduce caching mechanisms.
- Removed version display from the navigation bar.

## [1.2.0] - 2026-05-18

### Added
- Report version history tracking and restoration functionality.
- Global incomplete reports view with sidebar functionality.
- About page with version information and changelog display.
- Developer link to GitHub in the About view.
- Support for variable mode selectors in report templates.

### Changed
- Major UI/UX improvements including responsiveness, better SVG icons, and consistent button layouts.
- Replaced older layout patterns with `BasePageHeader` and `MainLayout` with sidebar navigation.

### Removed
- Unused old domain services directories (`Auth`, `Course`, `Classroom`, `Session`) as part of service architecture refactoring.

## [1.1.1] - 2026-05-03

### Added
- Implementation of report editor component with i18n support.
- Student report view integration for viewing historical data.
- Cross-browser clipboard utility integrated into `SessionDetailsView`.

### Changed
- Refactored `OccurrenceCalendar` and `BaseCalendar` components for improved date handling and UI consistency.
- Optimization of `OccurrenceCommandService` for more robust class occurrence management.

### Fixed
- Removal of unused `lastOccDate` variable in occurrence status calculation.

## [1.1.0] - 2026-05-02

### Added
- `ClassroomManagementView` and `SessionDetailsView` for centralized resource administration.
- English and Traditional Chinese localization for the report management system.
- Teacher management functionality including search, selection, and attendance tracking.
- Teaching schedule management and enhanced teacher assignment handling.
- User search functionality by email in `TeacherManagementView`.
- Holiday management in attendance and reporting systems.
- Support for start and end dates in class sessions and teacher assignments.

### Changed
- Upgraded Supabase and added custom Kong entrypoint for JWT handling.
- Major refactor of the service architecture, organizing services into dedicated domain directories (Auth, Classroom, Course, Holiday, Occurrence, Report, Session, Student, Suspension).
- Refactored core services to follow the Command and Query responsibility segregation (CQRS) pattern.
- Enhanced localization support across courses, reports, and teachers.

### Fixed
- Improved error handling for duplicate users in teacher management.
- Enhanced validation and error messages for attendance updates during holidays.

## [1.0.1] - 2026-04-21

### Added
- Status and classroom details to class occurrences.
- Course progress and summary features.
- Teaching day navigation to session details view.
- Customizable attendance and course copy templates.

### Changed
- Improved responsive layout in `SessionDetailsView` for better mobile usability.
- Enhanced auto-save functionality in `ReportEditor`.
- Updated `OccurrenceCalendar` component for compact view and improved navigation.
- Increased font sizes and improved readability in `SessionDetailsView`.

### Fixed
- Row Level Security (RLS) policies for visibility preferences.
- Fixed display condition for "no occurrences found" message.

## [1.0.0] - 2026-04-16

### Added
- Initial release of EduLog.
- Core learning report management and synchronization.
- Real-time student attendance tracking.
- Supabase backend integration with real-time sync capabilities.
