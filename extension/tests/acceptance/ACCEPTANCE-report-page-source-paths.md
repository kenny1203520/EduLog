# Report page source path contract acceptance

## Result

- The report-page route `/courses/dt/4773/lesson_reports` was rejected by the import API and the database history validator even though the extension captures it as the location of class report evidence.
- The API and database now share a narrow allowlist for class roots, `/lesson_reports`, `/lesson-reports`, admission pages, and report editor pages. Captured source paths remain unchanged in history evidence and work metadata.
- Arbitrary nested paths, query strings, external URLs, and unrelated routes remain invalid.
- A legacy server that still rejects a recognized report evidence path is reported as requiring the matching server migration. The draft, job, batch key, and existing checkpoints remain intact; retry does not apply teaching data.

## Verification

- API contract: 27 tests passed, including valid report collection and admission editor paths and invalid path rejection.
- PGlite/database migration chain through 1000140 passed. Tests verify exact route persistence in work metadata and history evidence, plus rejection of unsupported routes.
- Extension suite: 316 passed, 0 failed. Tests cover localized server-upgrade guidance for path-specific validation errors and ensure unrelated validation errors keep their normal handling.
- Server TypeScript typecheck passed.
- Side-load packaging and package contents are verified by the package script; a live Chrome/Edge side-load against a deployed API/database pair remains pending.
- No live site data was written. Preview and recovery remain separate from the explicit apply action.

## Release

- Extension version remains 0.1.0.
- Existing drafts can be resumed with their original job ID, batch keys, evidence, and checkpoints after the API and migration are deployed together.
- Deploy migration `1000140_report_page_source_paths.sql` with the API update. Older servers should not be retried repeatedly; keep the draft and update the server first.
