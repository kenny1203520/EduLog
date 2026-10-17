# Student mapping conflict recovery

## Implemented checks

- Enrollment rows contribute their reliable `student_source_id` to the source-reference lookup, even when the snapshot has no separate student row.
- Resolve operations stage paginated responses and update cached links only after every page succeeds. A missing reference is treated as confirmed absence only after the complete lookup succeeds.
- Invalid target links retain their revision for optimistic concurrency checks.
- A `VERSION_CONFLICT` performs one focused resolve for the affected student and enrollment. It preserves the current selection, reports that the selection was not saved, and never retries confirmation automatically.
- When a saved shared student match differs from the selected student, the teacher must choose whether to update only the enrollment or the shared student match.
- Migration `1000135_extension_mapping_conflict_diagnostics.sql` returns only bounded source kind/key, conflict field, and reason. Legacy database errors remain generic.

## Automated verification

- PGlite applies migrations through `1000135` and verifies the enrollment-only student ID case, revision retrieval, stale revision diagnostics, and atomic confirmation.
- API tests verify safe item-scoped `409 VERSION_CONFLICT` fields and the fallback for older database responses.
- The synthetic browser test verifies focused recovery includes the source student reference, does not auto-resubmit after a conflict, and preserves the enrollment date input.
- Run the workspace extension tests, server API tests, and `server` `test:extension-db` script before packaging.

## Manual verification still required

- Chrome and Edge real side-load checks remain pending.
- Live-site confirmation is not performed by this automated acceptance record. No teaching report is written by the synthetic tests.
- Before rollout, apply migration `1000135`, reload the extension and workspace, reproduce a stale mapping, confirm the one-time local recheck, inspect the preserved selection, then explicitly confirm again.
