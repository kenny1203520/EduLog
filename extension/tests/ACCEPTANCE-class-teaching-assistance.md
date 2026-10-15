# Class page teaching assistance — acceptance record

## Scope

- The class report page defaults to the source site's selected session and provides an explicit three-week comparison mode.
- Comparison mode keeps the student identity column and header visible while scrolling; the table fills wide regions and only the comparison region scrolls horizontally when the available width is too small. Each of the three week cells presents its own scheduled progress, enabled lesson, attendance and report state in the same order. The previous-teaching action remains in the student identity cell, while detailed course/date context stays collapsed per week.
- Class navigation, class menus and native search/filter/select controls use the same light theme, focus treatment, borders and spacing. Native option popups and keyboard behavior remain browser-controlled.
- Student rows show source-derived course, scheduled progress, enabled lesson, attendance and lesson-report states separately. The selected native week is projected on first load and after Turbo/week changes. Search covers the whole student row; status filters use one consistent selected-week or any-week rule.
- Students explicitly marked outside the selected session are grouped behind a disclosure; unclassified students stay visible. On mobile, single-session mode returns vertical scrolling to the page, while comparison mode retains a labelled horizontal scroll region.
- Previous-teaching summaries are loaded only when requested, for the same verified enrollment and before an exact selected-session date. Blank, holiday-only and attendance-only rows are not treated as teaching. Unknown dates are never completed with a guessed year. The whole-class action previews the number of reliably linked enrollments, ignores the current search filter, limits concurrent reads to three, and can be stopped or retried after partial failures.
- Summaries distinguish no match, same-day ambiguity, read failure and unavailable date. The source report remains available through its native link; no source form is submitted.
- A confirmed native report-save event invalidates cached summaries for that enrollment only. Unconfirmed submissions do not claim the summary was updated.
- The summary cache is local to the current page session and is invalidated by explicit refresh. No API endpoint or database migration was added. Manifest version remains 0.1.0.

## Automated verification

- Extension tests cover lazy history reads, enrollment scoping, strict cutoff dates, resolving the selected session date through the matching native report editor, the newest substantive report, zero-valued ratings, no-year-guess behavior, visible summary expansion, non-session grouping, single-session default, comparison switching, per-week summaries, stable student action placement and reversible restoration of the original source DOM.
- The extension test suite passed after these changes: 250 tests. Focused UI/workflow tests passed 48/48. The suite uses local fixtures and does not submit source teaching records.
- Browser-check assertions now cover comparison geometry at each target width: three week summaries per report, sticky student/header cells, table fill on wide viewports, isolated horizontal scrolling on narrow viewports and no document-level horizontal overflow. The browser run could not start because Playwright is not installed in this environment.
- JavaScript syntax and package dependency checks run as part of side-load packaging.

## Browser and live-site status

- The synthetic Chrome/Edge browser check was not run because Playwright is not installed in this environment. CSS layout, native styles, responsive behavior at 360, 390, 768, 1024, 1200, 1440 and 1920 CSS pixels, 480px short viewport, 200% zoom, keyboard navigation, dropdown clipping and real extension side-loading remain pending. Automated DOM tests do not establish rendered visibility or pixel geometry.
- Live Corp pages were not used for writes. Source-site verification remains read-only and pending; no teaching record was submitted.
