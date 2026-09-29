# EduLog browser extension

The extension source is in `extension/` and uses Manifest V3 for Chromium browsers. Load that directory as an unpacked extension in Chrome or Edge for local development.

## EduLog server setup

Set `API_EXTENSION_ALLOWED_ORIGINS` to a comma-separated list of exact origins in the form `chrome-extension://<32-character-extension-id>`. Do not use wildcard origins. During unpacked development, read the generated ID from the browser's extension management page and add that exact origin. Published Chrome and Edge packages may have different IDs and need separate entries.

The API uses this list for CORS and pairing-origin checks. Keep the regular `API_ALLOWED_ORIGINS` configuration for EduLog web clients. The extension connects to a self-hosted EduLog system; production instances must use HTTPS, while HTTP is accepted only for localhost development.

## Pairing

The extension creates a ten-minute PKCE pairing request and opens EduLog's integration settings. A signed-in user must explicitly approve the displayed extension origin. The extension then exchanges its verifier for a random credential; the server stores only its SHA-256 digest. The credential is scoped to `/api/extension/v1/*`, expires after 90 days, and can be revoked in EduLog settings. Do not expose it to the Orange Apple content script.

## Orange Apple adapter status

`extension/content.js` currently displays a non-invasive placeholder on recognized English teaching-route names. Its page adapter is deliberately disabled until sanitized student, course, classroom/session, report form, and successful-submit samples are supplied. The extension must not be treated as ready to replace teaching pages, import data, or prefill reports until the sample-backed adapter and live browser checks are complete.
