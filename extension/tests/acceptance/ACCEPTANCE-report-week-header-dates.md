# Report week-header date extraction acceptance

## Result

- Static inspection of the supplied, original-site HTML found 27 report edit links. Each link's table column supplied a week header and each row's course cell supplied a complete course date range; the existing date resolver uniquely resolved all 27 dates.
- The original scan read only the report-cell text, so all 27 dates were missing from extracted records. The scanner now resolves each report date from the logical header column, explicit date attributes or date text in the report cell, and the same row's course range.
- The click-to-open form capture and full-class scan use the same header and course-range evidence. Evidence records the report and admission IDs, date header, date text, range, and resolution outcome without copying report content.
- Ambiguous years, invalid dates, and conflicting explicit dates remain unresolved and carry a review reason.

## Verification

- Added a de-identified sample with 27 report links, multiple logical header rows, merged header cells, repeated student names, and separate admissions. All 27 resolve to the expected 2026-10-10, 2026-10-17, or 2026-10-24 date, and click capture agrees with the scanned record.
- Added checks for ambiguous years, missing course ranges, invalid dates, and disagreement between an explicit date and the week header.
- Full extension suite: 315 passed, 0 failed.
- No teaching-data submission was performed. This verifies the supplied saved HTML and synthetic extension behavior; a live side-loaded browser check remains pending.
- This date extraction gap is not established as the cause of the earlier `PREVIEW_STALE` response.

## Release

- Extension version remains 0.1.0. No server API, database migration, or required draft-format change.
- Existing saved or uncertain batches are not rewritten by date extraction; updated evidence must pass the existing review and preview gates.
