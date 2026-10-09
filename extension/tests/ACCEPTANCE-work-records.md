# EduLog 0.1.0 work history acceptance

## Automated checks

- `extension`: 219 tests passed, including stable local/server work identity joins, account and instance binding, source-tab recovery, local-draft removal, and responsive workbench behavior.
- `server`: 38 test files and 228 tests passed, including work-record metadata API validation, bounded pagination, field allowlists, and revision conflicts.
- PGlite: migration `1000131` applied and passed owner scoping, verified server-job linkage, metadata field validation, keyset pagination, and optimistic revision checks. Existing workspace and extension migration suites passed as well.
- Server TypeScript typecheck passed.
- `git diff --check` passed.

## Implemented behavior

- Work history lists local drafts and server jobs, merges only by stable work ID or verified server-job ID, groups by source class, and supports search, status, type, and class filters.
- Active work sorts before pinned, needs-attention, and resumable work; completed and archived items are collapsed by default.
- Details expose destination, actual work state, batch progress, roster checks, source-device metadata, and local draft expiry when available.
- Resume selects the saved source tab when valid, otherwise a matching saved path/class; if closed, the saved supported source path opens in the background. The selected source is never silently replaced by the page that happened to be active.
- Rename, pin, archive, unarchive, archive-completed, repeat-sync, and local-draft removal are available. Repeat-sync creates a new work item and does not reuse report overrides, skipped decisions, previews, or batch keys.
- Mobile uses an explicit list/detail transition with a return control. The source picker is not required to open work history.
- Work metadata contains source/target identifiers and summaries, title, source device, pin/archive state, and revision only; source report content and draft bodies remain local.

## Not yet verified in a real browser

- Real Chrome and Edge extension side-load, toolbar entry, source-tab recovery across browser restart, keyboard-only operation, 360/390/768/1024/1200/1440/1920 px layouts, short viewport, and 200% zoom remain pending.
- Cross-device synchronization against a deployed server with migration `1000131` applied remains pending.
- Source-site workflows were not submitted. No teaching report was sent.

## Operational notes

- Local source drafts retain the existing seven-day lifetime. Removing a local draft does not delete server results or drafts on another device.
- Archiving changes list visibility only; it does not mark a work complete or run it.
- Unknown or unavailable data remains identified as unavailable; read failures do not become empty work history.
