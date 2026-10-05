# EduLog 0.1.0 acceptance: shared mappings, sync preferences, and field review

## Automated checks completed

- `npm test --prefix extension`: 203/203 tests passed, including the final batch-decision assertions and workspace state-retention checks.
- `npm run test:extension-db --prefix server`: PGlite applied migrations through 1000127 and passed shared A–Z mapping across course contexts, cross-device account scope, sync preference allowlist/revision checks, history field filtering, idempotent binding, and all-fields-excluded behavior.
- Focused Supertest: `src/extensionWorkspaceRouter.test.ts` and `src/extensionIntegrationRouter.test.ts`, 28 tests passed, including GET/PATCH validation and capability propagation.
- `npm run typecheck --prefix server`, JavaScript syntax checks for workspace, history workbench, history sync, and workspace i18n, and `git diff --check` passed.

When all report fields are excluded, a history binding now returns `skipped` and leaves the history unlinked. It does not create an empty occurrence report. Nonempty, selected fields continue through the existing version, permission, and idempotency checks.

## Manual checks pending

- Actual unpacked extension installation in Chrome and Edge, including cross-device preference reuse.
- Real Corp/EduLog teaching data comparison, native 200% zoom, keyboard-only review, and 360–1920px physical viewport checks.
- Production RBAC and database deployment. No source teaching report was submitted during automated checks.

## Deployment and package

Apply migrations through `1000127_extension_shared_mappings_and_sync_preferences.sql`, deploy the API, then reload the 0.1.0 extension and recheck pairing. The package contains the migration and acceptance guide; it does not execute server migrations.

Build with:

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File extension/scripts/package-side-load.ps1
```

Expected package: `extension/dist/EduLog-Teaching-Tools-0.1.0-shared-sync-diff.zip`.
