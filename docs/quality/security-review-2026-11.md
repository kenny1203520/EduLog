# Security review — November 2026

This review covers the whole repository at `develop` 90f271fd: API (`server/`), Vue app (`app/`), browser extension, Supabase migrations and Compose files, Docker images, and CI. It combines a manual code review with these scanners:

- `npm audit` and osv-scanner: dependency advisories.
- gitleaks: secrets, across the full git history.
- trivy: HIGH and CRITICAL vulnerabilities in the release images.

SonarCloud had one open issue, `shell:S7688` in `scripts/release-image-smoke.sh:50`; it is fixed in this branch.

**Result:** no Critical or High findings in the application code. The highest code findings are Medium. The fixes are split across pull requests by severity:

- `fix/security-hardening-p1` (this branch): exploitable Medium findings and the Sonar issue.
- Separate batches: the extension pairing confirmation, session policy, CSP tightening, Low findings, CI scanning, and the UI/UX audit.

## Existing controls

These are already in place and were confirmed during the review:

- **Session auth:** httpOnly session cookies, double-submit CSRF tokens with timing-safe comparison, and local JWT verification followed by GoTrue confirmation.
- **Authorization:** checks run in the API (`authorizeResource` / `authorizeCollection`), and the database checks them again with RLS and `has_api_permission`. Every SECURITY DEFINER function sets `search_path`. `1000167` revokes privileges from `anon`.
- **HTTP hardening:**
  - helmet.
  - An exact-match CORS allowlist; production refuses to start without one.
  - A 1 MB body limit.
  - Error bodies with no stack traces or database messages.
  - Log redaction.
  - `Cache-Control: private, no-store`.
  - CSP, HSTS and frame headers in nginx.
- **Outbound requests:** provider discovery is allowlisted and refuses redirects. Personal Ollama endpoints are limited to public IPs with DNS pinning. Return URLs are restricted.
- **Extension:** tokens are stored as hashes, bound to an origin, and expire. Realtime tickets are sealed, single-use, and expire after 30 seconds. `postMessage` checks the origin on both sides.
- **CI:** actions are pinned by commit SHA, there is no `pull_request_target`, and workflow inputs pass through `env:`.

## Findings fixed in `fix/security-hardening-p1`

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| S1 | Major (Sonar) | `test -n` in a bash script (`shell:S7688`) | `[[ -n "$asset" ]]` |
| M1 | Medium | `trust proxy` was unset, so `req.ip` was the frontend nginx. Every anonymous caller shared one 120/min bucket for login, recovery and pairing, so one client could lock everyone out. The bucket key also used the raw path, so changing an id in the URL gave a fresh allowance. | `API_TRUST_PROXY_HOPS` (default 1; the TLS overlays set 2). A strict per-IP and per-email limiter (`API_AUTH_RATE_LIMIT_PER_MINUTE`, default 10) on `/api/auth/login`, `/api/auth/recover` and `/api/extension/pair-requests`. Anonymous buckets now use the route template. |
| M2 | Medium | Supavisor published 5432 and 6543 on every host interface in the base Compose file. | Bound to `${EDULOG_POOLER_BIND_ADDRESS:-127.0.0.1}`. |
| M3 | Medium | The API accepted `javascript:` and other non-http(s) values in `external_link` (`z.url()` accepts any scheme `new URL()` parses), and several views bound the value directly to `href`. The production CSP blocks inline script, which limits the impact. | The API accepts only http(s) (`server/src/routes/rest/externalLink.ts`). Migration `1000182` clears non-http(s) values and adds validated `*_external_link_http_check` constraints. Every `external_link` anchor goes through `safeExternalHref`. |
| M4 | Medium | A class-session-scoped `teaching.teachers.delete` grant could delete a teacher who also teaches in other class sessions. Deletion uses the service role. | A delete now needs the grant on every class session the teacher is assigned to. Non-destructive actions are unchanged. |

## Scanner results

| Scanner | Scope | Result |
| --- | --- | --- |
| gitleaks 8.24.2 | full history, 1,456 commits | 23 hits, all false positives (see below) |
| npm audit (`--omit=dev`) | root, `app`, `server` | `app`: 8 high, all from one advisory; root and `server`: 0 |
| osv-scanner 2.0.2 | three lockfiles | picomatch GHSA-fc5q-39xc-vjpf, glob GHSA-3g3m-2fjr-6pw4, minimatch GHSA-g3hv-75wg-m249 |
| trivy 0.65.0 | `frontend` and `api` release images (Alpine 3.24) | 0 HIGH or CRITICAL |
| trivy 0.65.0 | `presidio` release image (Debian 13.3) | before: 9 CRITICAL and about 230 HIGH findings from the upstream base, most with fixes available. After the fix: 0 HIGH or CRITICAL with a fix available (`--ignore-unfixed`), and `release-image-smoke.sh` passes |

**gitleaks false positives:**

- `.env.example`, `supabase/.env.example` and the removed `app/src/lib/supabase.ts` contain the public Supabase demo keys (`iss: supabase-demo`). The server should refuse these keys in production; that is listed as Low below.
- CI placeholder cookie secrets in `.github/workflows/api-service.yml`.
- Test fixtures.
- UI code in `extension/history-workbench.js`.

No real credential was found in history, so nothing needs rotating.

**Presidio image.** The upstream base `mcr.microsoft.com/presidio-analyzer:2.2.362` is the newest tag. It ships unpatched Debian packages and outdated Python packages. The Debian packages include openssl, gnutls, curl, krb5, util-linux, perl and brotli. The Python packages include anyio, certifi, cryptography, urllib3 and msgpack, plus Poetry and its dependencies dulwich and virtualenv. The analyzer has no published port; only the API reaches it, on the internal network. The Dockerfile now:

- applies the Debian security updates;
- upgrades the vulnerable runtime Python packages to their first fixed releases;
- removes Poetry, dulwich and virtualenv.

`start.sh` runs gunicorn directly, since Poetry only wrapped it and creates no virtualenv here. What remains is only findings Debian has not fixed yet. Bump the base digest and re-scan whenever Microsoft publishes a new tag.

**Dependency advisories.** All of them come from glob-matching libraries that only run at build time: Vite, the `vue-router` build plugin, vitest, workbox-build and vue-tsc. Patterns come from the repository, not from users, so the ReDoS conditions cannot be reached at run time. No patched picomatch has been released yet (4.0.7 is the latest). `npm audit fix` suggests downgrading to Vite 6, which is not acceptable. Revisit when picomatch publishes a fix; Dependabot will open the update.

## Remaining work

**Medium**

- **Extension pairing consent phishing** (`extensionIntegrationRouter.ts`). Anyone with an allow-listed extension can start a pairing request and send the approval link to a teacher. Fix: show a confirmation code on both the extension and the approval page, add a warning, and make requests expire and be single-use.

**Low**

- AI output goes to Tiptap as HTML. Insert it as a text node instead.
- Production starts with the demo Supabase keys, `DB_ENC_KEY=supabaserealtime`, or `COOKIE_SECURE=false`. Refuse all three.
- The CSP `connect-src https: wss:` and `img-src https:` are broader than the app needs.
- Logout does not clear local drafts when the API call fails.
- Sessions: 30-day refresh with no idle timeout. Decided policy: 8-hour idle timeout with a 30-day absolute cap.
- `only_unlinked=false` is coerced to `true`.
- The teacher create path passes the raw body instead of the validated body.
- `rbac_policy_epoch` has no RLS.
- The login page can show raw server messages.
- Extension `frontendBase()` allows `http:` on any host.
- `.gitignore` does not cover `supabase/volumes/functions/` or `supabase/volumes/storage/`.
- The API runtime image uses the `-dev` base, and base images are pinned by tag, not digest.
- `vue-toastification@2.0.0-rc.5` is an unmaintained release candidate.

**Accepted / informational**

- Token and account-status caches last up to 30 seconds after a revocation.
- `/api/openapi.json` is public.
- The CORS preflight method list omits `PUT`.

**CI**

- Add gitleaks, `npm audit` or osv-scanner, and a trivy gate before the GHCR push.
- Add the `docker` ecosystem to Dependabot.

## Before mounting any of the untracked routers

The working tree that was reviewed contains untracked, unreferenced files: `server/src/routes/rest/domainRouter.ts`, `rpcRouter.ts`, `userSearch.ts`, several unused `app/src/services/*` clients, and `supabase/volumes/functions/`. They are not shipped. If `domainRouter` is ever mounted, fix these first:

- Authorize every id in `session_ids`, not only `class_session_id`, in the occurrence list.
- Call `authorizeCopyTemplateScope` in `putCopyTemplate`.
- Authorize each teacher in bulk delete and do not use the service-role client.
