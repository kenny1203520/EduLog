# Import lifecycle effects and result counts

## Scope

Version remains 0.1.0. Migration `1000141_import_lifecycle_effect_receipts.sql` records reports created by the native occurrence lifecycle only when they are created inside an authenticated import transaction. The receipt is bound to the import job, successful batch, enrollment, occurrence, report identifier, version, and full row snapshots.

On apply, the server first validates the batch's identities, permissions, relationships, and preview versions. A report that was absent during preview is accepted only when a still-valid receipt proves that this same job created it. Missing or stale receipts and external edits continue to block the whole batch.

The workspace derives current pending, explicitly skipped, excluded, and unfilled report counts for its outcome display. Confirmed saved-history totals are based on report identifiers from successful apply responses, deduplicated across retries and rounds. Legacy totals without identifiers are shown as requiring server verification.

## Automated verification

- `npm run test:extension-db --prefix server` exercises the live lifecycle function chain, including the deployed lifecycle migration contract and migration 1000141.
- Same-batch case: an applied report creates the next occurrence report; a later row in the same batch applies using the exact transaction receipt.
- Cross-batch case: both previews are made before the first apply; the later batch applies using the same-job receipt without changing its request or key.
- External-edit case: changing a report after receipt creation invalidates the receipt and the later batch remains stale.
- `node --test extension/tests/workspace-preview.test.mjs` checks explicit skip accounting, applied-batch result persistence, and report-ID deduplication.
- `node --check extension/workspace/workspace.js` and `node --check extension/workspace/workspace-i18n.js` check the original ES modules.

## Verification limits

These checks use isolated database and synthetic extension fixtures. A live Chrome or Edge side-load session was not exercised for this change. Production-site verification remains read-only; no teaching records were submitted.
