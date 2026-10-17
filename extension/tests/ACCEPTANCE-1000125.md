# EduLog 0.1.0 acceptance: one-time transfer report import

Date: 2026-10-05

## Automated checks

- PGlite migration/API regression executes 1000118–1000125. It covers explicit cross-session admission memory, student/course mismatch rejection, relationship revalidation, effective roster membership, valid transfer target/date/session, cancelled and superseded transfers, denied enrollment reads, unchanged enrollment relationship, report apply, idempotent replay, and transaction rollback.
- Extension unit suite covers cross-session mapping eligibility and capability compatibility. A legacy server without `transferred_occurrence_import` remains blocked.
- Chrome and Edge mapping-workbench regression passed at 360, 390, 768, 1024, 1200, 1440 and 1920px, plus 720 CSS px at DPR 2. It covered cross-class results, weekend identity, error/retry, external correction/recheck, no duplicate default, per-row skip and no transfer writes.

## Manual acceptance pending

- Real Chrome/Edge sideloading and production UI/keyboard review.
- Production RBAC and live single-lesson transfer records on an approved test class.
- Confirm the live effective roster for the selected report date. No source report was submitted by automated tests.

Deploy migration 1000125 after 1000124, restart the API, reload the extension, and recheck the connection. See `docs/deployment/extension-transferred-occurrence.md`.
