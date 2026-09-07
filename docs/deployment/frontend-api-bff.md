# EduLog 前後端分離部署

Production traffic enters through the Nginx container only:

```text
Browser -> Nginx -> /api/* -> Express -> Supabase internal network
                    \-> /*    -> Vue static files
```

## Services

- `edulog` is the Vue/Nginx static frontend. Its Nginx runtime config sends `^~ /api/` to `api:3000` before the Vue history fallback.
- `api` is the Express Auth BFF. It has no published port and receives Supabase credentials only through server-side environment variables.
- `docker-compose.prod.yml` removes public Kong, analytics, and pooler ports. Use `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` with the required secret environment variables.

Required API variables include `EDULOG_COOKIE_SECRET` (at least 32 characters), `SERVICE_ROLE_KEY`, `ANON_KEY`, `EDULOG_SUPABASE_INTERNAL_URL`, `RATE_LIMIT_STORE=supabase`, and `VITE_API_V1_MODE=v1`.

The browser uses HttpOnly cookies through `/api/auth/*`; it must not receive `SUPABASE_SERVICE_ROLE_KEY`. The normal database path uses a Supabase client carrying the authenticated user JWT so PostgreSQL RLS remains active. Service role is isolated to validation, audit/idempotency/rate-limit operations, and explicit management tasks.

## Current boundaries

- Email/password authentication is implemented through the Express BFF. OAuth callback routes are intentionally not enabled until redirect allowlists and provider secrets are designed.
- No Storage calls were found in the current frontend. A future Storage proxy must issue signed URLs from Express only.
- Realtime uses the authenticated `/api/realtime` WebSocket upgrade path. The server validates the cookie before proxying to Supabase Realtime and enforces a one-megabyte frame limit.

## Verification

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml config
docker compose -f docker-compose.yml -f docker-compose.prod.yml build api edulog
```

`/healthz` and `/api/healthz` return JSON/plain health responses from their respective layers; `/api/*` never falls through to `index.html`.
