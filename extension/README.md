# EduLog Teaching Systems extension

## Clear theme and connection management (0.1.0)

The interface style is **EduLog 清晰主題** (EduLog Clear theme). Use **套用清晰主題** to apply it and **使用原站主題** to return to the supported website's style. It remains available without pairing.

The popup and site integration panel include expandable **教學資料匯入** and **報告預填** flow cards. They describe the planned selection, review, conflict and manual-submit steps. Both are explicitly marked unavailable; these cards do not extract data, write records, prefill forms or enable API capabilities.

Before running this API version, apply migration **1000117** after **1000116**, restart the API/web services and reload the unpacked extension. The manifest remains **0.1.0**. Existing paired tokens can be adopted when that browser rechecks its connection; other unidentified legacy rows remain intact.

Each browser profile generates a random UUID in extension-local storage. This is an installation identifier, not a hardware identifier or fingerprint. Browser/OS labels are coarse descriptive metadata; users can name the connection during pairing or rename it in EduLog. Same-installation pairing atomically replaces earlier tokens for that user and extension origin. Other installations and unidentified legacy tokens are preserved. Clearing extension storage or reinstalling creates a new installation identity.

Legacy adoption cannot supersede an already active known-installation authorization. It fails safely if another pairing has won; stale background verification does not overwrite newly saved pairing data. Reconnect from the current popup if a legacy credential cannot be adopted.

The web settings list refreshes every two seconds while a pairing request is pending/approved, every ten seconds otherwise, and immediately when the tab regains focus/visibility. Polling pauses in hidden tabs. Approval keeps the request visible until claim completes. Background refreshes retain rows and typed names; failures offer a manual refresh. Revocation requires confirmation showing the name and short connection ID.

Verification uses synthetic fixtures only. Run the isolated database test with `node supabase/tests/web_extension_installations.mjs <pglite/dist/index.js>`, or run `web_extension_installations.sql` against a disposable PostgreSQL database after applying the migrations. The web fixture is available at `/tests/fixtures/extension-connections.html` on a temporary Vite server at port 5199; `app/tests/extension-connections-browser.mjs <playwright/index.mjs> <screenshots-directory>` tests its layout and native dialog keyboard behavior in isolated Chrome/Edge profiles.

This directory contains the Manifest V3 Chrome and Edge extension source. Load it as an unpacked extension from `chrome://extensions` / `edge://extensions` while developing.

The extension connects to a self-hosted EduLog system. The user enters that server's origin and grants access only to that origin. Configure its `API_EXTENSION_ALLOWED_ORIGINS` with the exact `chrome-extension://<id>` origin before pairing. Production servers must use HTTPS; localhost is allowed for development.

Site-specific matching is isolated in `adapters/orange-apple.js`; the shared panel and connection flow use generic teaching-system terminology. The initial adapter is scoped to `corp.orangeapple.co` in both that adapter and the manifest's host match. Adding another teaching system means adding a separate adapter and its narrowly scoped manifest match.

UI improvements are enabled by default, independently of pairing or API availability. The adapter improves the teacher overview (`/`), class list (`/courses/dt`), class workspace (`/courses/dt/:id`), report grid (`/courses/dt/:id/lesson_reports`, including the dynamically loaded workspace tab), student learning history (`/dt_admissions/:id`), calendar (`/calendar`), and monthly unfilled list (`/admissions/month_unfilled_report`). The report edit modal has its own lifecycle, grouped fields, accessible labels and a keyboard-operable rating selector that updates the original radio inputs. Native forms, handlers, validation and submission remain in control. Unknown and access-denied pages retain their original UI. The toolbar and popup can switch improvements off; this preference is stored per adapter and synchronized across open supported pages.

Turbo navigation, frame updates and cache preparation restore/reapply the UI without cloning source forms. Search text is held only for the current page; only the UI enabled preference is saved. Styling is scoped to an opt-in document attribute and the shared toolbar has isolated styles. No teaching data is automatically exported.

Teaching-data import and report prefill are individually marked unsupported; native report links work normally. A successful-submit sample and live manual acceptance are still required before enabling prefill or recording successful pushes. Student detail pages (`/students/:id`) remain unsupported until an accessible sample is available. Verification refreshes the frontend settings URL from `/api/extension/v1/me` for existing pairings. Configure `EDULOG_WEB_BASE_URL` on the API with the browser-visible frontend URL, including any port or path prefix. The API address is never used to guess the frontend address.

Class cards and calendar status describe only the data currently loaded by the website. Source slot numbers are not converted into guessed clock times. The list/matrix choice, local filters, week selection and student expansion stay in page memory and are not uploaded or persisted in extension storage.

The popup displays setup, pending approval, connected overview, reconnect, or retry according to verification status. Temporary failures preserve credentials. Connected users can open integration settings, recheck, or change the server; cancelling server editing retains their current pairing. Diagnostic details and request IDs appear in a disclosure.

If the extension is reloaded while a teaching page is open, both synchronous and asynchronous context errors are caught. A single notice asks users to save edits before manually refreshing. Local UI switching and native forms remain usable; preference changes cannot be saved until the page is refreshed. Background failures allow retry without discarding pairing.

## Verification

Install the app development dependencies, then run `npm test --prefix extension`. The tests use the app's existing jsdom dependency and minimized, synthetic fixtures with no login tokens or saved extension overlays. They cover native DOM restoration, unsent input, event handlers, filtering, week selection, preferences, and Turbo updates.

For an optional Chrome/Edge visual and keyboard check, run `node extension/tests/browser-check.mjs <playwright/index.mjs> [screenshots-directory] [saved-site-css-directory]`. On Windows it uses the standard installed Chrome/Edge executables, isolated headless profiles, synthetic pages, and blocked external requests. This checks 360, 390, 768, 1024 and 1440 CSS pixels, plus 720 CSS pixels at DPR 2 to represent 1440-pixel desktop layout at 200% zoom. Native browser zoom and live unpacked-extension verification remain separate manual checks. Geometry assertions cover avatar proportions, modal width, textarea height, caption placement, rating containers, normal-flow submission controls, and empty table visibility.

The UI repair preserves provider classification backgrounds, excludes hash menus from current-page navigation, keeps search/week controls outside report scrolling, and scopes calendar status to the selected region. Native cell-only updates refresh existing controls; structural changes preserve focus, caret and table scrolling, and do not regroup an unchanged open report form.

Account pages are now included: monthly teaching hours (`/my/hour`), personal profile (`/my`), and profile editing (`/my/:id/edit`). The hours filter stays a native GET form; empty loaded months have an explicit message and financial amounts are never recalculated. Profile editing retains native fields, uploads and validation, with a collapsed password section that reveals native validation failures. No profile values are copied to extension storage or EduLog.

On narrow screens the report grid places the selected week beside a compact student column; course, attendance and student actions expand in place using the original nodes. Week controls stay together. The independently managed report, teaching-note and student-assessment modals preserve native close and save behavior; teaching notes never display an inferred saved status. Unrecognized dialogs, including student account settings and sign-in dialogs without reliable samples, remain native. See [the acceptance record](tests/ACCEPTANCE.md) for automated results and pending real-site checks.

After updating, reload the unpacked extension and save edits before refreshing already-open supported website tabs to load the new scripts and styles. Restart the API to enable the new `settings_url` response; existing pairings do not need to be recreated.

No extension credential is exposed to the site content script. The PKCE verifier is held in extension storage, and the API token remains restricted to the extension origin and dedicated integration routes.

## 0.1.0 sideload acceptance

Startup now runs at `document_start`; page enhancement runs at `document_end`. A neutral loading state hides the main page for at most a 300ms timer while preferences/DOM readiness are unresolved. Failure or timeout shows the native page and a local enable control. A late preference response is remembered for a later visit and does not switch the already displayed page. Unknown routes are shown natively; preferences are requested when Turbo first enters a supported route.

The document mode survives native DOM cleanup for Turbo snapshots. Public page/frame render hooks retain Turbo's renderer and apply enhancements before releasing the loading state. Ordinary updates are coalesced once per animation frame; unchanged forms/dialogs and the shared toolbar retain their native nodes. There are no new permissions, website storage reads, backend APIs or credential access.

Startup recordings: `node extension/tests/startup-browser-check.mjs <playwright/index.mjs> <recordings-directory>`. This runs parser-time scripts on isolated synthetic pages in Chrome/Edge at 390/1440px, samples animation frames, and saves WebM recordings. These are deterministic render-hook simulations, not proof of real-site Turbo behavior or actual unpacked-extension injection. Live sideload checks remain separate in the acceptance record.

The manifest stays at `0.1.0` until release; Git commits identify development progress. Extract the runtime ZIP into a folder, enable Developer mode in Chrome/Edge extensions, and choose Load unpacked. For an existing installation, update its folder and choose Reload. Save edits before refreshing old website tabs.

Verify the ten supported pages at desktop and narrow widths without pairing. Include the hours filter, profile view, profile editing, native region/date selection, list/matrix switching, student filters, week selection, history disclosure, and empty monthly lists. Open a report, change attendance and rating with keyboard controls, and toggle UI improvements through the popup: native draft fields, checkbox values and focus must remain intact. Check teaching-note and assessment dialogs; close/reopen each modal, navigate with Turbo, and return to confirm there are no duplicate controls. Any real report submission is performed manually by the user; automated synthetic checks do not establish production submission success.
