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

GoTrue sends invitations, password resets, email changes and signup confirmations through `SMTP_*`. The sender name defaults to `EduLog`; `SMTP_ADMIN_EMAIL` must be an address authorized by the SMTP provider. The Traditional Chinese and English templates and subjects are served/configured by EduLog. By default, GoTrue fetches them from `http://api:3000/email-templates/<name>.html` on the private Docker network; `EDULOG_MAIL_TEMPLATE_BASE_URL` can point to another internal template server. Every authentication link goes through `/api/auth/confirm`, which consumes the one-time token on the server and creates an HttpOnly session cookie. `SITE_URL` must be the EduLog web address.

The `token_hash` in these links is a single-use credential. The bundled EduLog and optional Supabase nginx proxies suppress access and error logging for `/api/auth/confirm`. The optional Caddy proxy replaces the `token_hash` value in request URIs before writing runtime logs, preserving the rest of each error record. Any CDN or other external ingress must also suppress request-target logging for this path or redact its `token_hash` query parameter. The EduLog API logs only the route path and request ID, without the query string.

GoTrue falls back to its default subject and body if the configured template URL cannot be reached or the response is not a valid Go template. The default text “Reset your password” therefore indicates that the deployed GoTrue did not use the custom recovery subject/template; it does not indicate that Supabase cannot customize them. After changing the Compose configuration or template source, recreate both `auth` and `api`, then verify a staging reset email shows the EduLog subject and content. In the auth container, confirm `GOTRUE_MAILER_TEMPLATES_RECOVERY` resolves to the internal API URL and that the URL returns the EduLog recovery template. If it still falls back, inspect Auth logs for `templatemailer_template_body_http_error` or `templatemailer_template_body_parse_error`.

The API uses the same SMTP settings to notify administrators when an account is waiting for approval (once per account). Without `SMTP_HOST` no API notice is sent; the sidebar badge remains available.

The pinned `supabase/gotrue:v2.197.0` SMTP path supports one HTML body per Auth email and does not add a separate `text/plain` MIME part ([GoTrue SMTP client](https://github.com/supabase/auth/blob/v2.197.0/internal/mailer/mailmeclient/mailmeclient.go)). These templates keep their copy readable and include a visible URL fallback; the API's pending-account notice sends both text and HTML alternatives. If Auth mail must include a true plain-text alternative, Supabase's [Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook) can hand the message to a custom sender that builds multipart mail. This deployment does not enable that hook.

## Delivery and spam filtering

Templates can make the message clear and low-noise, but copy alone cannot guarantee inbox placement. Use a production custom SMTP provider, verify the sending domain with SPF and DKIM, publish a DMARC policy, and keep the visible From address aligned with that domain. Keep authentication and marketing mail on separate sending domains or subdomains, disable open/click tracking for authentication links, and send at a steady rate. The messages intentionally use plain text-friendly wording, one primary action, no remote images, and no promotional content.

Self-hosted Supabase supports URL-served custom Auth templates and custom SMTP. See the [self-hosted custom email template guide](https://supabase.com/docs/guides/self-hosting/custom-email-templates) and [custom SMTP and deliverability guidance](https://supabase.com/docs/guides/auth/auth-smtp).

Development: `supabase/dev/docker-compose.dev.yml` runs a mail catcher at `supabase-mail:2500`.
