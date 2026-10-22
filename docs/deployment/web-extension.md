# EduLog browser extension

The extension source is in `extension/` and uses Manifest V3 for Chromium browsers. Load that directory as an unpacked extension in Chrome or Edge for local development.

## EduLog server setup

Set `API_EXTENSION_ALLOWED_ORIGINS` to a comma-separated list of exact origins in the form `chrome-extension://<32-character-extension-id>`. Do not use wildcard origins. During unpacked development, use the current extension ID shown by its popup or the browser's extension management page, then restart the API so it loads the updated allowlist. Published Chrome and Edge packages may have different IDs and need separate entries.

The API uses this list for CORS and pairing-origin checks. Keep the regular `API_ALLOWED_ORIGINS` configuration for EduLog web clients. The extension connects to a self-hosted EduLog system; production instances must use HTTPS, while HTTP is accepted only for localhost development.

Set `EDULOG_WEB_BASE_URL` explicitly to the browser-facing EduLog frontend URL users can open. There is no universal local port: Vite, preview, Docker Compose, a reverse proxy, and production deployments can all use different ports or hosts. The extension popup's server URL is where the API is reachable (for example, an API port or a frontend proxying `/api`); the API uses `EDULOG_WEB_BASE_URL` to construct the separate browser authorization link. These URLs may differ or share one host and port. The API container listens internally on port `3000` and does not serve dashboard pages; do not set this variable to an internal API container address unless that address is also browser-accessible and serves the frontend. Public deployments must use HTTPS. The old `API_BASE_URL` setting is no longer used for extension authorization links.

## Report editor in the side panel

The extension shows the EduLog report editor in the browser side panel, beside the teaching-site report form. The panel frames the EduLog web app, so the web front end must allow the extension to frame it; every other page stays blocked.

- The app container builds `frame-ancestors` from `EDULOG_FRAME_ANCESTORS` (space-separated exact `chrome-extension://<id>` origins). When that is empty it uses `API_EXTENSION_ALLOWED_ORIGINS`. Anything that is not an exact extension origin is ignored, and with no valid origin the policy stays `frame-ancestors 'none'` with `X-Frame-Options: DENY`.
- The Caddy and nginx proxy variants (`supabase/docker-compose.caddy.yml`, `supabase/docker-compose.nginx.yml`) replace the app's CSP with their own, so set `EDULOG_FRAME_ANCESTORS` explicitly there.
- A custom `EDULOG_CSP_HEADER` replaces the built-in policy completely; it must list the extension origins in its own `frame-ancestors`, or leave it empty.

Inside the panel the web app keeps the teacher's normal EduLog sign-in: requests carry its cookies because the extension holds access to the EduLog origin. Page scripts in the panel cannot read cookies, so the web app takes its CSRF token from `GET /api/auth/csrf` there. Restart the front end after changing these settings.

The browser does not send the session cookie on the realtime WebSocket handshake from inside the panel, so live collaboration (report editor and class-session updates) first calls `POST /api/realtime/ticket` and opens `/api/realtime` with that one-time ticket. A ticket is encrypted with a key derived from `COOKIE_SECRET`, is bound to one report or class session, expires after 30 seconds, and is accepted once per API instance. All API instances must share the same `COOKIE_SECRET`.

## Pairing

The extension creates a ten-minute PKCE pairing request and opens EduLog's integration settings. A signed-in user must explicitly approve the displayed extension origin. The extension then exchanges its verifier for a random credential; the server stores only its SHA-256 digest. The credential is scoped to `/api/extension/v1/*`, expires after 90 days, and can be revoked in EduLog settings. Do not expose it to any site content script.

## Supported site adapter status

The shared extension UI and connection flow use teaching-system terminology. Site-specific host and route matching lives in `extension/sites/<site>/` (currently `extension/sites/orange-apple/`); the initial adapter and manifest host match currently support `corp.orangeapple.co`. Add other systems as separate adapters with narrowly scoped host matches. UI improvements are automatic and independent of EduLog pairing: the teacher overview, class workspace and report grid have scoped styling, local search and responsive controls. Both the popup and page toolbar can switch back to the original UI without discarding native form input. Unknown pages remain original. Reload the unpacked extension and refresh existing tabs after an update.

Apply migrations through **1000118**, restart the API, reload the extension and recheck its connection to enable the workspace. Current-class import supports explicit mappings, conflict review and resumable atomic batches; single-report prefill supports verified native fields with manual review. UI improvements do not automatically upload data. Native forms are never submitted by the extension, and lesson activation/completion is not report completeness or submission success.

The workspace RPC is callable only by the trusted backend and revalidates the credential before deriving its user and invoking existing teaching permissions/report lifecycle. Clients cannot supply an actor or an arbitrary database table. Checkpoints contain metadata, hashes and target versions; raw source payloads are held only in the trusted extension's IndexedDB. Existing source mappings, jobs and pending pushes remain compatible.

See [workspace setup, acceptance and remaining sample gates](extension-workspace.md). All-visible-class collection and successful-submit confirmation remain unavailable until reliable samples and real-site manual acceptance are provided. Do not enable them by changing capability flags alone.
