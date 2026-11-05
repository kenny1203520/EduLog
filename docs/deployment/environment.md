# Environment variables

This page is the one reference for EduLog's environment variables. Each layer reads its environment in exactly one module:

| Layer | Reads env in | Validated |
|---|---|---|
| API (Express, `server/`) | `server/src/config/config.ts` (`loadConfig`, once at startup) | zod schema; the API refuses to start on bad config |
| Frontend app (browser) | `app/src/lib/runtimeConfig.ts` (`window.__EDULOG_CONFIG__` first, then build-time `VITE_*`) | typed; unknown API modes fall back with a warning |
| Frontend dev server | `app/vite.config.ts` → `app/vite.security.ts` | parsed in code |
| Frontend container (nginx) | `app/nginx/docker-entrypoint.d/05-edulog-runtime.envsh` | shell, at container start |
| Edge functions (Deno) | `supabase/volumes/functions/_shared/env.ts` (once per worker) | missing values answer with a configuration error |
| Release/extension scripts | `scripts/lib/env.mjs` helpers | `requireEnv` fails with the variable name |

Rules:

- Code outside these modules does not read `process.env`, `import.meta.env` or `Deno.env`.
- An empty value (`KEY=`) means "unset" everywhere.
- Lists are **comma-separated**. The one exception is `EDULOG_FRAME_ANCESTORS`, which is a CSP source list and so **space-separated**.
- Names stay stable. Compose maps the deployment-facing `EDULOG_*` names onto the names each container reads (table below). Supabase's own variables keep Supabase's names.

## Where to set them

| Running | File | Template |
|---|---|---|
| Docker Compose (all services) | root `.env` | root `.env.example` (Supabase upstream section + EduLog sections; checked in CI by `scripts/check-env-example.mjs`) |
| API with `npm run dev` | `server/.env`, overridden by `server/.env.local` (loaded with `--env-file-if-exists`) | `server/.env.example` |
| Frontend with `npm run dev` | `app/.env*` overrides root `.env*`; the shell overrides both | `app/.env.example` |

Only `VITE_*` keys ever reach the browser bundle. Never put a Supabase key or any secret in a `VITE_*` variable; CI rejects `VITE_SUPABASE_*`.

## Compose name mapping

The root `.env` key on the left becomes the container variable on the right.

| Root `.env` | `api` container | `edulog` (nginx) container | `functions` container |
|---|---|---|---|
| `EDULOG_COOKIE_SECRET` **(required)** | `COOKIE_SECRET` | | |
| `EDULOG_WEB_BASE_URL` **(required)** | `EDULOG_WEB_BASE_URL` | | |
| `EDULOG_ALLOWED_ORIGINS` **(required in production)** | `API_ALLOWED_ORIGINS` | | `API_ALLOWED_ORIGINS` |
| `API_EXTENSION_ALLOWED_ORIGINS` | `API_EXTENSION_ALLOWED_ORIGINS` | fallback for `EDULOG_FRAME_ANCESTORS` | |
| `ANON_KEY` (Supabase) | `SUPABASE_ANON_KEY` | | `SUPABASE_ANON_KEY` |
| `SERVICE_ROLE_KEY` (Supabase) | `SUPABASE_SERVICE_ROLE_KEY` | | `SUPABASE_SERVICE_ROLE_KEY` |
| `JWT_SECRET` (Supabase) | `SUPABASE_JWT_SECRET` | | `JWT_SECRET` (main router only, not forwarded to workers) |
| `EDULOG_SUPABASE_INTERNAL_URL` (`http://kong:8000`) | `SUPABASE_URL` | | |
| `EDULOG_SUPABASE_REALTIME_URL` | `SUPABASE_REALTIME_URL` | | |
| `EDULOG_COOKIE_SECURE` (`true`) | `COOKIE_SECURE` | | |
| `NODE_ENV` (`production`) | `NODE_ENV` | | |
| `RATE_LIMIT_STORE` (`supabase`) | `RATE_LIMIT_STORE` | | |
| `EDULOG_API_BODY_LIMIT` (`1mb`) | `API_BODY_LIMIT` | `EDULOG_API_BODY_LIMIT` (converted to nginx units) | |
| `EDULOG_API_RATE_LIMIT_PER_MINUTE` (`120`) | `API_RATE_LIMIT_PER_MINUTE` | | |
| `EDULOG_AI_SECRET_KEY` | `AI_SECRET_KEY` | | |
| `EDULOG_PRESIDIO_ANALYZER_URL` | `PRESIDIO_ANALYZER_URL` | | |
| `EDULOG_OPENAI_SIWC_CLIENT_ID` / `_SECRET` | `OPENAI_SIWC_CLIENT_ID` / `_SECRET` | | |
| `EDULOG_FUNCTIONS_ENVIRONMENT` (`production`) | | | `ENVIRONMENT` |
| `VITE_API_V1_MODE` (`v1`) | | `VITE_API_V1_MODE` | |
| `EDULOG_API_UPSTREAM` (`api:3000`) | | `EDULOG_API_UPSTREAM` | |

Supabase uses more aliases for its own services. For example, `SERVICE_ROLE_KEY` reaches Studio and Kong as `SUPABASE_SERVICE_KEY` and Storage as `SERVICE_KEY`. Those are upstream and are not changed here.

## Easily confused

- `EDULOG_ALLOWED_HOSTS` is the frontend's **Host header** allowlist (it defends against DNS rebinding). `EDULOG_ALLOWED_ORIGINS` is the **CORS** allowlist for the API and edge functions. They are separate settings.
- "Which environment" is spelled per runtime: `NODE_ENV` (API), `ENVIRONMENT` via `EDULOG_FUNCTIONS_ENVIRONMENT` (edge functions), and Vite's `MODE`/`PROD` (frontend build). Edge functions treat anything other than an explicit `development` as production.
- Without an origin allowlist, the API allows only the local Vite dev server (`localhost:5173`) outside production and **refuses to start** in production. Edge functions reflect any origin only when `ENVIRONMENT=development`.

## API (`server/src/config/config.ts`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | | `development` | `production` enforces HTTPS `EDULOG_WEB_BASE_URL`, `RATE_LIMIT_STORE=supabase`, and non-empty `API_ALLOWED_ORIGINS` |
| `API_PORT` | | `3000` | |
| `EDULOG_WEB_BASE_URL` | yes | | HTTPS except localhost; no credentials, query or fragment |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | yes | | |
| `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_ISSUER` | | | Local token checks for self-hosted Supabase |
| `SUPABASE_REALTIME_URL` | | `SUPABASE_URL` | |
| `COOKIE_SECRET` | yes | | at least 32 characters |
| `COOKIE_SECURE` | | `false` | Compose sets `true` |
| `RATE_LIMIT_STORE` | | `supabase` | `memory` is refused in production |
| `API_BODY_LIMIT` | | `1mb` | Express/`bytes` syntax |
| `API_ALLOWED_ORIGINS` | in production | | exact origins, no wildcards or paths |
| `API_EXTENSION_ALLOWED_ORIGINS` | | | exact `chrome-extension://<32 a-p chars>` origins |
| `API_RATE_LIMIT_PER_MINUTE` | | `120` | |
| `AI_SECRET_KEY` | | | 32 bytes as base64; AI credential storage is off without it |
| `PRESIDIO_ANALYZER_URL` | | | de-identification is off without it |
| `OPENAI_SIWC_CLIENT_ID`, `OPENAI_SIWC_CLIENT_SECRET` | | | Sign in with ChatGPT is hidden without them. OpenAI's endpoints are constants in code, not env |
| `SYSTEM_OWNER_USER_ID` | for `npm run bootstrap:system-owner` | | uuid; read by that script only |

Test-only variables (suites skip when they are unset): `PRESIDIO_ANALYZER_URL`, `AI_TEST_OLLAMA_MODEL`, `AI_TEST_OLLAMA_URL`.

## Frontend

| Variable | Where | Default | Notes |
|---|---|---|---|
| `VITE_API_V1_MODE` | runtime config / build | `v1` in production builds and the nginx image, `mock` in dev | `mock` \| `legacy` \| `v1` |
| `VITE_LEGACY_API_BASE_URL` | runtime config / build | `/api` | used by `legacy` mode |
| `EDULOG_API_DEV_TARGET` | Vite dev server | `http://localhost:3000` | `/api` proxy target |
| `EDULOG_ALLOWED_HOSTS` | dev server + nginx | | comma-separated Host allowlist |
| `EDULOG_CSP_HEADER`, `EDULOG_HSTS_HEADER` | dev server + nginx | built-in policies (kept identical by `DockerRuntimeContract.spec.ts`) | |
| `EDULOG_FRAME_ANCESTORS` | dev server + nginx | `API_EXTENSION_ALLOWED_ORIGINS` | **space**-separated |
| `EDULOG_HTTP_ENABLED`, `EDULOG_HTTPS_ENABLED`, `EDULOG_HTTPS_REDIRECT`, `EDULOG_HTTPS_PORT` | nginx (HTTPS flag also in dev) | `true`, `false`, `false`, `4174` | |
| `EDULOG_SSL_CERT_PATH`, `EDULOG_SSL_KEY_PATH`, `EDULOG_SSL_CA_PATH` | dev server + nginx | `/app/ssl/fullchain.pem`, `/app/ssl/privkey.pem` | |
| `EDULOG_API_UPSTREAM`, `EDULOG_API_BODY_LIMIT` | nginx | `api:3000`, `1mb` | |

## Edge functions (`_shared/env.ts`)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (fallback `SERVICE_ROLE_KEY`), `SUPABASE_ANON_KEY` (fallback `SUPABASE_PUBLISHABLE_KEY`), `API_ALLOWED_ORIGINS`, `ENVIRONMENT` (default `production`), `API_RATE_LIMIT_PER_MINUTE` (`120`), `LEGACY_API_SUNSET` (`Wed, 31 Dec 2026 23:59:59 GMT`), and `OTEL_EXPORTER_OTLP_{LOGS,TRACES,METRICS}_ENDPOINT`.

The `main` router forwards **only these keys** to user workers (`WORKER_ENV_KEYS`). A new variable that a worker needs must be added there. The router itself also reads `JWT_SECRET` and `VERIFY_JWT`.

## CI and release scripts

These run in GitHub Actions, and their names are set in the workflow files: `RELEASE_TAG`, `RELEASE_SHA`, `FRONTEND_DIGEST`, `API_DIGEST`, `GH_TOKEN`/`GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_OUTPUT`, `CWS_*`, `BETA_*`/`STABLE_*`, `EXTENSION_*`. See `docs/deployment/release.md` and `docs/deployment/extension-release.md`.
