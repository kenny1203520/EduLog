import crypto from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, sendError } from '../http/errors.js'
import { rateLimitMiddleware } from '../http/rateLimit.js'
import { assertUserActive, clearAccessTokenValidation, createAuthenticatedUserClient, createUserClient, refresh, safeUser, signIn, validateAccessToken, verifyCurrentPassword, type SupabaseClients } from '../infra/supabase.js'
import type { ApiConfig } from '../config/config.js'
import { measureRequestPhase, setAuditContext } from '../http/context.js'
import { createPkcePair, enabledOAuthProviders, exchangeAuthCode, isValidProviderName, requestPasswordRecovery, startOAuthAuthorization, verifyEmailLink, type EmailLinkType, type GoTrueSession } from './gotrue.js'
import { createMailer, notifyPendingAccount, type Mailer } from '../mail/mailer.js'

const accessCookie = 'edulog_access'
const refreshCookie = 'edulog_refresh'
const csrfCookie = 'edulog_csrf'
/** PKCE verifier between the OAuth redirect and its callback. */
const oauthCookie = 'edulog_oauth'
const oauthCookiePath = '/api/auth/oauth'
/** Lets a session opened from an invite or reset link set a password without the old one. */
const setupLinkCookie = 'edulog_setup_link'
const SETUP_LINK_TTL_MS = 15 * 60 * 1000
const recoverSchema = z.object({ email: z.string().trim().email().max(320) }).strict()
const setPasswordSchema = z.object({ new_password: z.string().min(8).max(1024), confirm_password: z.string().min(8).max(1024) }).strict().superRefine((value, context) => {
  if (value.new_password !== value.confirm_password) context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirm_password'], message: 'New passwords do not match' })
})
const confirmQuery = z.object({
  token_hash: z.string().min(8).max(512),
  type: z.enum(['invite', 'recovery', 'email_change', 'signup', 'email']),
}).passthrough()

export function setupLinkToken(config: Pick<ApiConfig, 'COOKIE_SECRET'>, userId: string, expiresAt: number) {
  const signature = crypto.createHmac('sha256', config.COOKIE_SECRET).update(`setup-link:${userId}:${expiresAt}`).digest('base64url')
  return `${userId}.${expiresAt}.${signature}`
}

export function validSetupLink(config: Pick<ApiConfig, 'COOKIE_SECRET'>, token: string | undefined, userId: string, now = Date.now()) {
  if (!token) return false
  const [id, expires, signature] = token.split('.')
  const expiresAt = Number(expires)
  if (id !== userId || !Number.isFinite(expiresAt) || expiresAt < now || !signature) return false
  const expected = Buffer.from(setupLinkToken(config, userId, expiresAt))
  const received = Buffer.from(token)
  return expected.length === received.length && crypto.timingSafeEqual(expected, received)
}
const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(1024) }).strict()
const changeEmailSchema = z.object({ current_password: z.string().min(1).max(1024), email: z.string().trim().email().max(320) }).strict()
const changePasswordSchema = z.object({ current_password: z.string().min(1).max(1024), new_password: z.string().min(8).max(1024), confirm_password: z.string().min(8).max(1024) }).strict().superRefine((value, context) => {
  if (value.new_password !== value.confirm_password) context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirm_password'], message: 'New passwords do not match' })
})

async function safeUserWithProfile(adminClient: SupabaseClients['adminClient'], user: NonNullable<Request['user']>) {
  const { data, error } = await adminClient.from('profiles').select('full_name,nickname').eq('auth_user_id', user.id).maybeSingle()
  if (error || !data) return safeUser(user as never)
  const nickname = typeof data.nickname === 'string' ? data.nickname.trim() || null : null
  const fullName = typeof data.full_name === 'string' ? data.full_name : null
  return { ...safeUser(user as never), full_name: fullName, nickname, display_name: nickname || fullName }
}

function cookieOptions(config: ApiConfig) {
  return { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 1000 }
}

function setSession(res: Response, config: ApiConfig, session: { access_token: string; refresh_token: string; expires_in?: number }) {
  const options = { ...cookieOptions(config), maxAge: Math.max(60, session.expires_in ?? 3600) * 1000 }
  res.cookie(accessCookie, session.access_token, options)
  res.cookie(refreshCookie, session.refresh_token, { ...options, httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 })
  res.cookie(csrfCookie, crypto.randomBytes(24).toString('hex'), { ...options, httpOnly: false, maxAge: 30 * 24 * 60 * 60 * 1000 })
}

export function requireAuth(clients: SupabaseClients, config: ApiConfig, options: { allowPending?: boolean } = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.[accessCookie] ?? req.header('authorization')?.replace(/^Bearer\s+/i, '').trim()
      if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
      const user = await measureRequestPhase(req, 'auth', () => validateAccessToken(clients.adminClient, token, config))
      req.accountStatus = await measureRequestPhase(req, 'account_status', () => assertUserActive(clients.adminClient, user.id, options))
      req.user = user
      req.log = req.log.child({ actor_user_id: user.id })
      req.accessToken = token
      req.db = createUserClient(config, token)
      req.adminDb = clients.adminClient
      next()
    } catch (error) {
      const mapped = error instanceof ApiError ? error
        : error instanceof Error && error.message === 'AUTH_DISABLED'
          ? new ApiError(403, 'ACCOUNT_DISABLED', 'This account is disabled')
          : error instanceof Error && error.message === 'AUTH_PENDING'
            ? new ApiError(403, 'ACCOUNT_PENDING', 'This account is waiting for administrator approval')
            : new ApiError(401, 'AUTH_INVALID', 'Authentication is invalid')
      sendError(req, _res, mapped)
    }
  }
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  const method = req.method.toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !req.cookies?.[accessCookie]) return next()
  const expected = req.cookies?.[csrfCookie]
  const received = req.header('x-csrf-token')
  const expectedBuffer = expected ? Buffer.from(expected) : Buffer.alloc(0)
  const receivedBuffer = received ? Buffer.from(received) : Buffer.alloc(0)
  if (!expected || !received || expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return sendError(req, _res, new ApiError(403, 'CSRF_INVALID', 'CSRF validation failed'))
  }
  next()
}

export function createAuthRouter(clients: SupabaseClients, config: ApiConfig, mailer: Mailer = createMailer(config)) {
  const router = Router()
  const oauthCallbackUrl = new URL('/api/auth/oauth/callback', config.EDULOG_WEB_BASE_URL).toString()
  const clearOAuthCookie = (res: Response) => res.clearCookie(oauthCookie, { path: oauthCookiePath })
  const providers = () => enabledOAuthProviders(config)
  const oauthStartRateLimit = rateLimitMiddleware(config, clients.adminClient)

  /** Start a browser session from tokens GoTrue issued (OAuth or an email link). */
  async function startSession(req: Request, res: Response, session: GoTrueSession) {
    const userId = session.user?.id
    if (!userId) throw new Error('AUTH_INVALID')
    const status = await assertUserActive(clients.adminClient, userId, { allowPending: true })
    setSession(res, config, session)
    if (status === 'pending') void notifyPendingAccount(clients.adminClient, mailer, config.EDULOG_WEB_BASE_URL, userId, req.log)
    return status
  }

  function failureTarget(error: unknown, fallback: string) {
    return error instanceof Error && error.message === 'AUTH_DISABLED' ? '/account-disabled' : fallback
  }

  /** OAuth providers enabled in GoTrue; none unless the browser can reach GoTrue. */
  router.get('/providers', async (req, res) => {
    res.json({ data: { providers: await providers() }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
  })
  router.get('/oauth/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const verifier = req.cookies?.[oauthCookie]
    clearOAuthCookie(res)
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    if (!code || typeof verifier !== 'string' || !verifier) return res.redirect(303, '/login?error=oauth')
    try {
      const status = await startSession(req, res, await exchangeAuthCode(config, code, verifier))
      return res.redirect(303, status === 'pending' ? '/account-pending' : '/dashboard')
    } catch (error) {
      req.log.warn({ event: 'oauth_callback_failed', reason: error instanceof Error ? error.message : 'unknown' }, 'oauth_callback_failed')
      return res.redirect(303, failureTarget(error, '/login?error=oauth'))
    }
  })
  router.get('/oauth/:provider', oauthStartRateLimit, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const provider = typeof req.params.provider === 'string' ? req.params.provider : ''
    if (!isValidProviderName(provider) || !(await providers()).includes(provider)) return res.redirect(303, '/login?error=oauth')
    const { verifier, challenge } = createPkcePair()
    res.cookie(oauthCookie, verifier, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax', path: oauthCookiePath, maxAge: 10 * 60 * 1000 })
    try {
      const authorizeLocation = await startOAuthAuthorization(config, provider, oauthCallbackUrl, challenge)
      return res.redirect(303, authorizeLocation)
    } catch {
      clearOAuthCookie(res)
      req.log.warn({ event: 'oauth_authorize_failed' }, 'oauth_authorize_failed')
      return res.redirect(303, '/login?error=oauth')
    }
  })
  /** Links in GoTrue emails land here (see mail/emailTemplates.ts). */
  router.get('/confirm', async (req, res) => {
    const parsed = confirmQuery.safeParse(req.query)
    if (!parsed.success) return res.redirect(303, '/login?error=link')
    const type = parsed.data.type as EmailLinkType
    try {
      const session = await verifyEmailLink(config, parsed.data.token_hash, type)
      const status = await startSession(req, res, session)
      if (type === 'invite' || type === 'recovery') {
        const expiresAt = Date.now() + SETUP_LINK_TTL_MS
        res.cookie(setupLinkCookie, setupLinkToken(config, session.user!.id, expiresAt), { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax', path: '/api/auth', maxAge: SETUP_LINK_TTL_MS })
        return res.redirect(303, '/auth/set-password')
      }
      if (type === 'email_change') return res.redirect(303, '/dashboard/settings?tab=personal&email_changed=1')
      return res.redirect(303, status === 'pending' ? '/account-pending' : '/dashboard')
    } catch (error) {
      req.log.warn({ event: 'email_link_failed', link_type: type, reason: error instanceof Error ? error.message : 'unknown' }, 'email_link_failed')
      return res.redirect(303, failureTarget(error, '/login?error=link'))
    }
  })
  /** Always 204, so the answer never tells whether an account exists. */
  router.post('/recover', async (req, res, next) => {
    try {
      const input = recoverSchema.parse(req.body)
      await requestPasswordRecovery(config, input.email, config.EDULOG_WEB_BASE_URL).catch((error: unknown) => {
        req.log.warn({ event: 'password_recovery_failed', status: (error as { status?: number }).status ?? null }, 'password_recovery_failed')
      })
      res.status(204).end()
    } catch (error) { next(error) }
  })
  /** Set a password after following an invite or reset link; no current password needed. */
  router.post('/set-password', requireAuth(clients, config, { allowPending: true }), async (req, res, next) => {
    try {
      const input = setPasswordSchema.parse(req.body)
      const user = req.user!
      if (!validSetupLink(config, req.cookies?.[setupLinkCookie], user.id)) throw new ApiError(403, 'PASSWORD_SETUP_EXPIRED', 'The password link has expired; request a new one')
      setAuditContext(req, { domain: 'system', resource: 'account-security', resourceId: user.id, action: 'password-set' })
      const { error } = await clients.adminClient.auth.admin.updateUserById(user.id, { password: input.new_password })
      if (error) {
        req.log.warn({ auth_error_code: error.code ?? 'UNKNOWN' }, 'auth_password_set_failed')
        throw new ApiError(422, 'AUTH_PASSWORD_CHANGE_FAILED', 'The password could not be changed')
      }
      res.clearCookie(setupLinkCookie, { path: '/api/auth' })
      return res.json({ data: { changed: true }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) { next(error) }
  })
  router.post('/login', async (req, res, next) => {
    try {
      const input = credentialsSchema.parse(req.body)
      const result = await signIn(config, input.email, input.password)
      const status = await assertUserActive(clients.adminClient, result.user.id, { allowPending: true })
      setSession(res, config, result.session)
      if (status === 'pending') void notifyPendingAccount(clients.adminClient, mailer, config.EDULOG_WEB_BASE_URL, result.user.id, req.log)
      res.json({ data: { ...await safeUserWithProfile(clients.adminClient, result.user), account_status: status }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_DISABLED') return next(new ApiError(403, 'ACCOUNT_DISABLED', 'This account is disabled'))
      next(error instanceof Error && error.message === 'AUTH_INVALID' ? new ApiError(401, 'AUTH_INVALID', 'Authentication is invalid') : error)
    }
  })
  router.post('/refresh', async (req, res, next) => {
    try {
      const token = req.cookies?.[refreshCookie]
      if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
      const result = await refresh(config, token)
      const status = await assertUserActive(clients.adminClient, result.user.id, { allowPending: true })
      setSession(res, config, result.session)
      res.json({ data: { ...await safeUserWithProfile(clients.adminClient, result.user), account_status: status }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) { next(error instanceof ApiError ? error : new ApiError(401, 'AUTH_INVALID', 'Authentication is invalid')) }
  })
  router.post('/logout', async (req, res, next) => {
    try {
      const token = req.cookies?.[accessCookie]
      if (token) await clients.adminClient.auth.admin.signOut(token).catch(() => undefined)
      clearAccessTokenValidation(token)
      res.clearCookie(accessCookie, { path: '/' }); res.clearCookie(refreshCookie, { path: '/' }); res.clearCookie(csrfCookie, { path: '/' })
      res.status(204).end()
    } catch (error) { next(error) }
  })
  router.get('/csrf', (req, res) => {
    const token = req.cookies?.[csrfCookie] ?? crypto.randomBytes(24).toString('hex')
    res.cookie(csrfCookie, token, { ...cookieOptions(config), httpOnly: false, maxAge: 30 * 24 * 60 * 60 * 1000 })
    res.json({ data: { csrf_token: token }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
  })
  // Pending accounts may read who they are, so the app can show the waiting page.
  router.get('/me', requireAuth(clients, config, { allowPending: true }), async (req, res) => {
    const status = req.accountStatus ?? 'active'
    if (status === 'pending') void notifyPendingAccount(clients.adminClient, mailer, config.EDULOG_WEB_BASE_URL, req.user!.id, req.log)
    res.json({ data: { ...await safeUserWithProfile(clients.adminClient, req.user!), account_status: status }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
  })
  router.post('/me/email', requireAuth(clients, config), async (req, res, next) => {
    try {
      const input = changeEmailSchema.parse(req.body)
      const user = req.user
      if (!user?.email) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
      setAuditContext(req, { domain: 'system', resource: 'account-security', resourceId: user.id, action: 'email-change-request' })
      const verifiedSession = await verifyCurrentPassword(config, user.email, input.current_password)
      if (!verifiedSession) {
        throw new ApiError(403, 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect')
      }
      const authClient = await createAuthenticatedUserClient(config, verifiedSession.access_token, verifiedSession.refresh_token)
      const { error } = await authClient.auth.updateUser({ email: input.email })
      if (error) {
        req.log.warn({ auth_error_code: error.code ?? 'UNKNOWN' }, 'auth_email_change_failed')
        throw new ApiError(422, 'AUTH_EMAIL_CHANGE_FAILED', 'The email address could not be changed')
      }
      const { data: sessionData } = await authClient.auth.getSession()
      if (sessionData.session) setSession(res, config, sessionData.session)
      return res.json({ data: { confirmation_required: true }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) { next(error) }
  })
  router.post('/me/password', requireAuth(clients, config), async (req, res, next) => {
    try {
      const input = changePasswordSchema.parse(req.body)
      const user = req.user
      if (!user?.email) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
      setAuditContext(req, { domain: 'system', resource: 'account-security', resourceId: user.id, action: 'password-change' })
      const verifiedSession = await verifyCurrentPassword(config, user.email, input.current_password)
      if (!verifiedSession) throw new ApiError(403, 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect')
      const authClient = await createAuthenticatedUserClient(config, verifiedSession.access_token, verifiedSession.refresh_token)
      const { error } = await authClient.auth.updateUser({ password: input.new_password, current_password: input.current_password })
      if (error) {
        if (error.code?.includes('reauthentication') || /current password|reauthentication/i.test(error.message)) throw new ApiError(403, 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect')
        req.log.warn({ auth_error_code: error.code ?? 'UNKNOWN' }, 'auth_password_change_failed')
        throw new ApiError(422, 'AUTH_PASSWORD_CHANGE_FAILED', 'The password could not be changed')
      }
      const { data: sessionData } = await authClient.auth.getSession()
      if (sessionData.session) setSession(res, config, sessionData.session)
      return res.json({ data: { changed: true }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) { next(error) }
  })
  return router
}
