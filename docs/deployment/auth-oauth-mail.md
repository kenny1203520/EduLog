# Sign-in, OAuth and email

EduLog signs people in through the API (cookie sessions); the browser never holds Supabase tokens.

## Who may use the app

- **Invited accounts** (System settings → Account approval → Invite a user) are active at once and get the *default roles for new accounts*.
- **Everyone else** — OAuth sign-ins, email self sign-up (`ENABLE_EMAIL_SIGNUP`), accounts made in Studio — starts **pending**: they can sign in but only see a "waiting for approval" page. An administrator with `system.users.manage` approves them (optionally granting roles; the defaults are preselected) or rejects them, which disables the account.
- Accounts that existed before migration 1000163 keep their status.
- Set `DISABLE_SIGNUP=true` to allow only invitations and existing accounts.

## OAuth providers

1. At each provider, register `${EDULOG_WEB_BASE_URL}/api/auth/bridge/callback` as the callback URL. Provider callbacks reach EduLog; the API forwards only the fixed callback route to GoTrue.
2. In `.env`, set `<PROVIDER>_ENABLED=true`, `<PROVIDER>_CLIENT_ID` and `<PROVIDER>_SECRET` (Azure, GitLab, Keycloak and WorkOS also take `<PROVIDER>_URL`). Every provider GoTrue supports is already wired in `docker-compose.yml`.
3. Keep `${EDULOG_WEB_BASE_URL}/api/auth/oauth/callback` in `ADDITIONAL_REDIRECT_URLS`; GoTrue returns its PKCE code there after the bridge processes the provider callback. The API uses `EDULOG_GOTRUE_INTERNAL_URL` (default `http://auth:9999`) for direct, server-only `/authorize` and `/callback` requests. `SUPABASE_PUBLIC_URL` is not needed for OAuth, and `API_EXTERNAL_URL` / `GOTRUE_JWT_ISSUER` must remain unchanged.
4. Restart `auth` and `api`. The login page lists every provider GoTrue reports as enabled (`/auth/v1/settings`). EduLog's bundled nginx proxies disable access logging on the callback path; if a separate public ingress sits in front, redact query strings on `/api/auth/bridge/callback` because providers may include authorization codes there.

Accounts with the same verified email are linked by GoTrue.

## Email

GoTrue sends invitation, password-reset, email-change and confirmation mail through `SMTP_*`. Its templates (Traditional Chinese and English) are served by the API at `http://api:3000/email-templates/<name>.html`; override the base with `EDULOG_MAIL_TEMPLATE_BASE_URL`. Their links open `/api/auth/confirm`, which starts the session on the server. `SITE_URL` must be the EduLog web address.

The API uses the same `SMTP_*` settings to tell administrators when an account is waiting for approval (once per account). Without `SMTP_HOST` no mail is sent and the sidebar badge is the only notice.

Development: `supabase/dev/docker-compose.dev.yml` runs a mail catcher at `supabase-mail:2500`.
