# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
