# EduLog browser extension

The extension source is in `extension/` and uses Manifest V3 for Chromium browsers. Load that directory as an unpacked extension in Chrome or Edge for local development.

## EduLog server setup

Set `API_EXTENSION_ALLOWED_ORIGINS` to a comma-separated list of exact origins in the form `chrome-extension://<32-character-extension-id>`. Do not use wildcard origins. During unpacked development, read the generated ID from the browser's extension management page and add that exact origin. Published Chrome and Edge packages may have different IDs and need separate entries.

The API uses this list for CORS and pairing-origin checks. Keep the regular `API_ALLOWED_ORIGINS` configuration for EduLog web clients. The extension connects to a self-hosted EduLog system; production instances must use HTTPS, while HTTP is accepted only for localhost development.

Set `EDULOG_WEB_BASE_URL` to the browser-facing EduLog frontend origin, such as `https://edulog.example.com`. In local Compose development it defaults to `http://localhost:4173`. The API container listens internally on port `3000` and does not serve dashboard pages; do not set this variable to the API container address. The old `API_BASE_URL` setting is no longer used for extension authorization links.

## Pairing

The extension creates a ten-minute PKCE pairing request and opens EduLog's integration settings. A signed-in user must explicitly approve the displayed extension origin. The extension then exchanges its verifier for a random credential; the server stores only its SHA-256 digest. The credential is scoped to `/api/extension/v1/*`, expires after 90 days, and can be revoked in EduLog settings. Do not expose it to any site content script.

## Supported site adapter status

The shared extension UI and connection flow use teaching-system terminology. Site-specific host and route matching lives in `extension/adapters/`; the initial adapter and manifest host match currently support `corp.orangeapple.co`. Add other systems as separate adapters with narrowly scoped host matches. The current adapter displays a non-invasive placeholder and does not scrape or write page data until sanitized student, course, classroom/session, report form, and successful-submit samples are supplied. The extension must not be treated as ready to replace teaching pages, import data, or prefill reports until the sample-backed adapter and live browser checks are complete.
