# EduLog Teaching Systems extension

This directory contains the Manifest V3 Chrome and Edge extension source. Load it as an unpacked extension from `chrome://extensions` / `edge://extensions` while developing.

The extension connects to a self-hosted EduLog system. The user enters that server's origin and grants access only to that origin. Configure its `API_EXTENSION_ALLOWED_ORIGINS` with the exact `chrome-extension://<id>` origin before pairing. Production servers must use HTTPS; localhost is allowed for development.

Site-specific matching is isolated in `adapters/orange-apple.js`; the shared panel and connection flow use generic teaching-system terminology. The initial adapter is scoped to `corp.orangeapple.co` in both that adapter and the manifest's host match. Adding another teaching system means adding a separate adapter and its narrowly scoped manifest match.

UI improvements are enabled by default, independently of pairing or API availability. The sample-backed adapter improves the teacher overview (`/`), class workspace (`/courses/dt/:id`) and report grid (`/courses/dt/:id/lesson_reports`). It adds class shortcuts, local student search, mobile detail expansion and report week selection, preserving native forms, handlers and statuses. Unknown pages retain their original UI. The toolbar and popup can switch improvements off; this preference is stored per adapter and synchronized across open supported pages.

Turbo navigation, frame updates and cache preparation restore/reapply the UI without cloning source forms. Search text is held only for the current page; only the UI enabled preference is saved. Styling is scoped to an opt-in document attribute and the shared toolbar has isolated styles. No teaching data is automatically exported.

Teaching-data import and report prefill are individually marked unsupported; native report links work normally. Report editing and successful-submit samples are still needed before enabling prefill or recording successful pushes. Verification refreshes the frontend settings URL from `/api/extension/v1/me` for existing pairings. Configure `EDULOG_WEB_BASE_URL` on the API with the browser-visible frontend URL, including any port or path prefix. The API address is never used to guess the frontend address.

The popup displays setup, pending approval, connected overview, reconnect, or retry according to verification status. Temporary failures preserve credentials. Connected users can open integration settings, recheck, or change the server; cancelling server editing retains their current pairing. Diagnostic details and request IDs appear in a disclosure.

If the extension is reloaded while a teaching page is open, both synchronous and asynchronous context errors are caught. A single notice asks users to save edits before manually refreshing. Local UI switching and native forms remain usable; preference changes cannot be saved until the page is refreshed. Background failures allow retry without discarding pairing.

## Verification

Install the app development dependencies, then run `npm test --prefix extension`. The tests use the app's existing jsdom dependency and minimized, synthetic fixtures with no login tokens or saved extension overlays. They cover native DOM restoration, unsent input, event handlers, filtering, week selection, preferences, and Turbo updates.

For an optional Chrome/Edge visual and keyboard check, run `node extension/tests/browser-check.mjs <playwright/index.mjs> [screenshots-directory] [saved-site-css-directory]`. On Windows it uses the standard installed Chrome/Edge executables, isolated headless profiles, synthetic pages, and blocked external requests. This checks page layout at 390 and 1440 pixels; it does not replace live unpacked-extension verification against the real site.

After updating, reload the unpacked extension and save edits before refreshing already-open supported website tabs to load the new scripts and styles. Restart the API to enable the new `settings_url` response; existing pairings do not need to be recreated.

No extension credential is exposed to the site content script. The PKCE verifier is held in extension storage, and the API token remains restricted to the extension origin and dedicated integration routes.
