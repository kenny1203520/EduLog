# EduLog 0.1.0 work history acceptance

## Automated checks

- `extension`: 220 tests passed, including complete published-script module syntax checks, stable local/server work identity joins, account and instance binding, source-tab recovery, local-draft removal, and responsive workbench behavior.
- `server`: 38 test files and 228 tests passed, including work-record metadata API validation, bounded pagination, field allowlists, and revision conflicts.
- PGlite: migration `1000131` applied and passed owner scoping, verified server-job linkage, metadata field validation, keyset pagination, and optimistic revision checks. Existing workspace and extension migration suites passed as well.
- Server TypeScript typecheck passed.
- `git diff --check` passed.

## Startup regression follow-up

- Fixed the duplicate top-level `workHistory` declaration in `workspace/workspace.js` and the extra closing brace in `repeatWork()`. Both prevented the complete workbench module from parsing, so none of its entry flows could initialize.
- Added a test that runs `node --check` over every published JavaScript source and adapter, rather than checking only extracted functions.
- The side-load packaging script now parses every staged JavaScript file before replacing the archive. A syntax error stops packaging and leaves the previous archive intact.
- Chrome and Edge synthetic checks passed for import, prefill, and work-history entries without a source tab. Full workbench import and prefill flows passed at 360, 390, 768, 1024, 1200, 1440, and 1920 px, with no page errors or unhandled promise rejections reported.
- Work-history resume and repeat-sync controls are covered by the responsive browser flow. Real extension side-load remains pending.

## Implemented behavior

- Work history lists local drafts and server jobs, merges only by stable work ID or verified server-job ID, groups by source class, and supports search, status, type, and class filters.
- Active work sorts before pinned, needs-attention, and resumable work; completed and archived items are collapsed by default.
- Details expose destination, actual work state, batch progress, roster checks, source-device metadata, and local draft expiry when available.
- Resume selects the saved source tab when valid, otherwise a matching saved path/class; if closed, the saved supported source path opens in the background. The selected source is never silently replaced by the page that happened to be active.
- Rename, pin, archive, unarchive, archive-completed, repeat-sync, and local-draft removal are available. Repeat-sync creates a new work item and does not reuse report overrides, skipped decisions, previews, or batch keys.
- Mobile uses an explicit list/detail transition with a return control. The source picker is not required to open work history.
- Work metadata contains source/target identifiers and summaries, title, source device, pin/archive state, and revision only; source report content and draft bodies remain local.

## Not yet verified in a real browser

- Real Chrome and Edge extension side-load, toolbar popup entry, source-tab recovery across browser restart, keyboard-only operation, short viewport, and 200% zoom remain pending. The listed responsive widths passed in synthetic browser checks, not a real side-load session.
- Cross-device synchronization against a deployed server with migration `1000131` applied remains pending.
- Source-site workflows were not submitted. No teaching report was sent.

## Operational notes

- Local source drafts retain the existing seven-day lifetime. Removing a local draft does not delete server results or drafts on another device.
- Archiving changes list visibility only; it does not mark a work complete or run it.
- Unknown or unavailable data remains identified as unavailable; read failures do not become empty work history.

## Large-history draft persistence follow-up

- Reproduced the storage boundary with 600 synthetic history reports: the complete work serialized to 4,430,734 characters, exceeding the former 4,000,000-character local draft limit. This matches the reported pause path; the exact size of the user's original work was not available, so this is a reproduced cause rather than a claim about that one work item.
- Local drafts now store the serialized payload in 512 KiB IndexedDB chunks. The compact work header, all chunks, and revision are written in one transaction. Reads still return the complete work object, and legacy inline drafts remain readable until their next successful save converts them.
- Chrome and Edge IndexedDB checks passed for a >4 MB, 600-report Chinese sample with source evidence, internal notes, half-star/zero/false values, legacy conversion, owner isolation, quota failure rollback, missing-chunk detection, repair, and deletion cleanup.
- A draft-save failure now pauses extraction without classifying it as a source-read failure or advancing its saved checkpoint. The workbench keeps the current unsaved state and exposes an explicit retry-and-continue action; both browser engines passed this recovery flow without uncaught page errors.
- Extension automated tests: 221 passed. Chrome and Edge synthetic responsive flows passed at 360, 390, 768, 1024, 1200, 1440, and 1920 CSS pixels. Real extension side-load remains pending; no source teaching report was submitted.
