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

### Authentik and other custom OIDC providers

Use GoTrue's custom OIDC provider for Authentik. The built-in Keycloak adapter expects a Keycloak realm and constructs Keycloak-specific endpoint paths.

1. In Authentik, create a confidential OAuth2/OpenID Provider. Copy the discovery URL and issuer exactly, including any trailing slash. Keep standard scopes `openid`, `profile`, and `email`, and make sure Authentik reports email verification accurately.
2. Enable database encryption in GoTrue before storing client secrets. Set `EDULOG_AUTH_PROVIDER_ADMIN_ENABLED=true` and list the exact HTTPS origins needed by the providers in `EDULOG_AUTH_PROVIDER_ALLOWED_ORIGINS`. Restrict both EduLog's provider-validation traffic and GoTrue's provider egress to these destinations at the network layer. Include the discovery, authorization, token, userinfo, and JWKS origins when they differ. GoTrue v2.197.0 rejects custom-provider URLs that resolve to private, loopback, or link-local addresses. Use a publicly resolvable HTTPS endpoint for the IdP.
3. In **System settings → Login providers** as a system owner with a recent sign-in, enter the issuer, discovery URL, client ID and client secret. Copy the displayed bridge callback and register it as a strict redirect URI in Authentik. Save the disabled draft, then activate it when the callback is configured. The first real sign-in verifies the IdP credentials and the full PKCE round trip. Use staging to test this before going live.
4. Verify `custom:authentik` appears in `/api/auth/capabilities` and sign in with a test account. To support an existing account, enable manual linking below, link Authentik, sign out, then sign in via Authentik and verify the same EduLog account, roles and classes.

The wizard can also configure an OAuth 2.0 provider with explicit authorization, token and userinfo URLs. The [GoTrue admin API](https://supabase.com/docs/guides/self-hosting/self-hosted-custom-oauth-providers) remains available through a trusted private host. The bundled Compose stack automatically discovers enabled custom providers. An existing explicit `EDULOG_AUTH_CUSTOM_OAUTH_DISCOVERY_ENABLED=false` still disables discovery. Administrators who control an IdP can influence which verified email addresses GoTrue trusts. Only register trusted IdPs, and use GoTrue's provider linking domains where identities must be kept separate.

For manual linking in Personal settings → Account security, apply migrations through
`1000173` after GoTrue has migrated its Auth schema. Set
`EDULOG_AUTH_MANUAL_LINKING_ENABLED=true` for both containers, add
`${EDULOG_WEB_BASE_URL}/api/auth/identities/callback` to
`ADDITIONAL_REDIRECT_URLS`, and recreate the containers. Redact query strings on
both API OAuth callbacks as well as the bridge. Keep HTTPS and secure cookies
enabled (providers that return a cross-site form POST need the secure flow cookie).
Use `/api/auth/capabilities` to distinguish an empty provider list from partial discovery failure; its `unavailable` list identifies which source to retry. Verify the effective enabled
provider names and whether credentials are present without printing their values.
Before rollout, sign in and link with every configured provider on staging, unlink
with a verified password account, and sign back in with that password. Confirm
that cancellation preserves the original session and no callback credentials
appear in access logs.

Accounts with the same verified email are linked by GoTrue.

## SAML, phone and multi-factor authentication

- For SAML set `SAML_ENABLED=true` and provide the SAML signing key as `SAML_PRIVATE_KEY`. Register domains and metadata through the private GoTrue SSO provider API. The bundled stack serves metadata and assertion consumption at `/api/auth/sso/saml/metadata` and `/api/auth/sso/saml/acs`. Use the EduLog metadata URL when configuring the IdP. [Self-hosted SAML SSO](https://supabase.com/docs/guides/self-hosting/self-hosted-saml-sso)
- For phone sign-in configure `ENABLE_PHONE_SIGNUP`, `SMS_PROVIDER` and the corresponding GoTrue delivery credentials. Phone MFA uses the same delivery configuration and separate `MFA_PHONE_ENROLL_ENABLED` and `MFA_PHONE_VERIFY_ENABLED` flags. TOTP is available by default. Configure an MFA recovery process before disabling factor verification for a deployment with enrolled users. [Phone sign-in and MFA](https://supabase.com/docs/guides/self-hosting/self-hosted-phone-mfa)
- Passkeys and security-key MFA use the same WebAuthn RP ID and allowed origins. Use the EduLog HTTPS origin. Set `PASSKEY_ENABLED` for passkey sign-in and the `MFA_WEBAUTHN_*_ENABLED` flags for security-key MFA. Set `MFA_RECOVERY_CODES_ENABLED` to enable enrollment and verification of recovery codes. [Self-hosted passkeys](https://supabase.com/docs/guides/self-hosting/self-hosted-passkeys)

## Sign in to external apps with EduLog

Keep `EDULOG_AUTH_OUTBOUND_OAUTH_ENABLED=false` until the candidate has passed the external-token boundary checks with the actual gateway, PostgREST, Storage and Realtime. Use the bundled Envoy gateway and apply all migrations before enabling it. The legacy Kong overlay keeps the OAuth server disabled. Set `SITE_URL` to the EduLog HTTPS origin and configure asymmetric GoTrue JWT signing for OIDC. Use the GoTrue public issuer already configured by the deployment. Keep dynamic client registration disabled. Register each app and its exact HTTPS redirect URI with an authorized system account. Verify consent, rejection, grant revocation and identity-only access with the relying app. SCIM user provisioning awaits a supported GoTrue release. [OAuth 2.1 Server](https://supabase.com/docs/guides/auth/oauth-server)

## Email

GoTrue sends invitations, password resets, email changes and signup confirmations through `SMTP_*`. The sender name defaults to `EduLog`; `SMTP_ADMIN_EMAIL` must be an address authorized by the SMTP provider. The Traditional Chinese and English templates and subjects are served/configured by EduLog. By default, GoTrue fetches them from `http://api:3000/email-templates/<name>.html` on the private Docker network; `EDULOG_MAIL_TEMPLATE_BASE_URL` can point to another internal template server. Every authentication link goes through `/api/auth/confirm`, which consumes the one-time token on the server and creates an HttpOnly session cookie. `SITE_URL` must be the EduLog web address.

The `token_hash` in these links is a single-use credential. The bundled EduLog and optional Supabase nginx proxies suppress access and error logging for `/api/auth/confirm`. The optional Caddy proxy's default structured runtime logger redacts `token_hash`, `code` and `state` from the `request.uri` field before writing to stderr, while preserving other structured error fields. If you add a separate Caddy access log or custom logger, apply the same redaction there. Any CDN or other external ingress must also suppress request-target logging for this path or redact its `token_hash` query parameter. The EduLog API logs only the route path and request ID, without the query string.

GoTrue falls back to its default subject and body if the configured template URL cannot be reached or the response is not a valid Go template. The default text “Reset your password” therefore indicates that the deployed GoTrue did not use the custom recovery subject/template; it does not indicate that Supabase cannot customize them. After changing the Compose configuration or template source, recreate both `auth` and `api`, then verify a staging reset email shows the EduLog subject and content. In the auth container, confirm `GOTRUE_MAILER_TEMPLATES_RECOVERY` resolves to the internal API URL and that the URL returns the EduLog recovery template. If it still falls back, inspect Auth logs for `templatemailer_template_body_http_error` or `templatemailer_template_body_parse_error`.

The API uses the same SMTP settings to notify administrators when an account is waiting for approval (once per account). Without `SMTP_HOST` no API notice is sent; the sidebar badge remains available.

The pinned `supabase/gotrue:v2.197.0` SMTP path supports one HTML body per Auth email and does not add a separate `text/plain` MIME part ([GoTrue SMTP client](https://github.com/supabase/auth/blob/v2.197.0/internal/mailer/mailmeclient/mailmeclient.go)). These templates keep their copy readable and include a visible URL fallback; the API's pending-account notice sends both text and HTML alternatives. If Auth mail must include a true plain-text alternative, Supabase's [Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook) can hand the message to a custom sender that builds multipart mail. This deployment does not enable that hook.

## Delivery and spam filtering

Templates can make the message clear and low-noise, but copy alone cannot guarantee inbox placement. Use a production custom SMTP provider, verify the sending domain with SPF and DKIM, publish a DMARC policy, and keep the visible From address aligned with that domain. Keep authentication and marketing mail on separate sending domains or subdomains, disable open/click tracking for authentication links, and send at a steady rate. The messages intentionally use plain text-friendly wording, one primary action, no remote images, and no promotional content.

Self-hosted Supabase supports URL-served custom Auth templates and custom SMTP. See the [self-hosted custom email template guide](https://supabase.com/docs/guides/self-hosting/custom-email-templates) and [custom SMTP and deliverability guidance](https://supabase.com/docs/guides/auth/auth-smtp).

Development: `supabase/dev/docker-compose.dev.yml` runs a mail catcher at `supabase-mail:2500`.
