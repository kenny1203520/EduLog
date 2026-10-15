import crypto from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, sendError } from './http/errors.js'
import { assertUserActive, clearAccessTokenValidation, createAuthenticatedUserClient, createUserClient, refresh, safeUser, signIn, validateAccessToken, verifyCurrentPassword, type SupabaseClients } from './infra/supabase.js'
import type { ApiConfig } from './config/config.js'
import { measureRequestPhase, setAuditContext } from './http/context.js'

const accessCookie = 'edulog_access'
const refreshCookie = 'edulog_refresh'
const csrfCookie = 'edulog_csrf'
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

export function requireAuth(clients: SupabaseClients, config: ApiConfig) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.[accessCookie] ?? req.header('authorization')?.replace(/^Bearer\s+/i, '').trim()
      if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
      const user = await measureRequestPhase(req, 'auth', () => validateAccessToken(clients.adminClient, token, config))
      await measureRequestPhase(req, 'account_status', () => assertUserActive(clients.adminClient, user.id))
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

export function createAuthRouter(clients: SupabaseClients, config: ApiConfig) {
  const router = Router()
  router.post('/login', async (req, res, next) => {
    try {
      const input = credentialsSchema.parse(req.body)
      const result = await signIn(clients.publicClient, input.email, input.password)
      setSession(res, config, result.session)
      res.json({ data: await safeUserWithProfile(clients.adminClient, result.user), meta: {}, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) { next(error instanceof Error && error.message === 'AUTH_INVALID' ? new ApiError(401, 'AUTH_INVALID', 'Authentication is invalid') : error) }
  })
  router.post('/refresh', async (req, res, next) => {
    try {
      const token = req.cookies?.[refreshCookie]
      if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
      const result = await refresh(clients.publicClient, token)
      setSession(res, config, result.session)
      res.json({ data: await safeUserWithProfile(clients.adminClient, result.user), meta: {}, request_id: req.requestId, trace_id: req.traceId })
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
  router.get('/me', requireAuth(clients, config), async (req, res) => res.json({ data: await safeUserWithProfile(clients.adminClient, req.user!), meta: {}, request_id: req.requestId, trace_id: req.traceId }))
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
