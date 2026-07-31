# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.1] - 2026-07-31

### Fixed
- Required incomplete-report notification recipients to be assigned to the occurrence, explicitly marked present that day, and allowed by their effective class role notification policy; any explicit absence or deny policy takes precedence.
- Limited automatic occurrence-report creation to regular enrollments while keeping trial students visible with unavailable report-backed actions clearly disabled.
- Completed an enrollment when any fully completed report references the course's highest-sequence lesson, removing the previous chapter and progress-letter dependency.

### Tests
- Added regression coverage for attendance plus role-policy notification eligibility, deny precedence, regular-only report creation, trial-student UI safeguards, and final-lesson completion.

### Deployment Notes
- No database migration is required for v1.7.1.
- Deploy the updated `aggregate-incomplete-reports` Edge Function.


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
