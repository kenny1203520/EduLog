# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
