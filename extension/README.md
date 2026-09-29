# EduLog Orange Apple extension

This directory contains the Manifest V3 Chrome and Edge extension source. Load it as an unpacked extension from `chrome://extensions` / `edge://extensions` while developing.

The extension connects to a self-hosted EduLog system. The user enters that server's origin and grants access only to that origin. Configure its `API_EXTENSION_ALLOWED_ORIGINS` with the exact `chrome-extension://<id>` origin before pairing. Production servers must use HTTPS; localhost is allowed for development.

The Orange Apple content adapter is intentionally fail-closed. Its first panel is a non-invasive placeholder; it does not scrape or write page data until sanitized page and successful-submit samples are available. The `/api/extension/v1/me` response reports import and report-prefill capabilities as unavailable until their routes and page adapters are implemented.

No extension credential is exposed to the site content script. The PKCE verifier is held in extension storage, and the API token remains restricted to the extension origin and dedicated integration routes.
