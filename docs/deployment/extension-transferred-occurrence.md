# EduLog 0.1.0: Single-lesson transfer report reconciliation

## Deployment

Apply `1000125_extension_transferred_occurrence_import.sql` after 1000124 and restart the API. The migration adds `transferred_occurrence_import` to workspace capabilities. Older servers do not advertise this capability and the extension keeps cross-session report imports blocked with an upgrade message.

An explicitly selected existing enrollment can be remembered across base class sessions only when its student and course still match. The stored enrollment relationship is not rewritten. A report can import across sessions only when its date has a readable effective transfer target in the selected session and the enrollment is present in that occurrence's effective roster. Missing, cancelled, superseded, inaccessible, or date/session-mismatched evidence keeps that report pending.

Run `npm run test:extension-db --prefix server`, `npm test --prefix extension`, and `npm test --prefix server` before delivery. SQL and browser fixtures validate behavior with isolated data; production RBAC, live EduLog transfer records, and actual Chrome/Edge sideloading remain pending until performed. The extension does not change enrollment relationships or submit the source report.

## Side-loading

Package: `extension/dist/EduLog-Teaching-Tools-0.1.0-transferred-occurrence-import.zip`. Apply only pending migrations through 1000125, restart the API, reload the unpacked extension, save website drafts before refreshing source tabs, then recheck the connection. Existing migrations are immutable. The source report remains for a teacher to review and submit manually.
