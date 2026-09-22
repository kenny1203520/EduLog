import crypto from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, sendError } from './errors.js'
import { assertUserActive, clearAccessTokenValidation, createUserClient, refresh, safeUser, signIn, validateAccessToken, type SupabaseClients } from './supabase.js'
import type { ApiConfig } from './config.js'
import { measureRequestPhase } from './context.js'

const accessCookie = 'edulog_access'
const refreshCookie = 'edulog_refresh'
const csrfCookie = 'edulog_csrf'
const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(1024) }).strict()

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
      res.json({ data: safeUser(result.user), meta: {}, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) { next(error instanceof Error && error.message === 'AUTH_INVALID' ? new ApiError(401, 'AUTH_INVALID', 'Authentication is invalid') : error) }
  })
  router.post('/refresh', async (req, res, next) => {
    try {
      const token = req.cookies?.[refreshCookie]
      if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
      const result = await refresh(clients.publicClient, token)
      setSession(res, config, result.session)
      res.json({ data: safeUser(result.user), meta: {}, request_id: req.requestId, trace_id: req.traceId })
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
  router.get('/me', requireAuth(clients, config), (req, res) => res.json({ data: safeUser(req.user as never), meta: {}, request_id: req.requestId, trace_id: req.traceId }))
  return router
}
