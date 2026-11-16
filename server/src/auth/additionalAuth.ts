import { urlencoded, type Request, type RequestHandler, type Response, type Router } from 'express'
import { decodeJwt } from 'jose'
import { z } from 'zod'
import type { ApiConfig } from '../config/config.js'
import { ApiError } from '../http/errors.js'
import { outboundConsentReturn } from './authReturn.js'
import { createPkcePair, exchangeAuthCode, validProviderAuthorizeLocation, type GoTrueSession } from './gotrue.js'

const factorType = z.enum(['totp', 'phone', 'webauthn'])
const factorSchema = z.object({
  id: z.uuid(), factor_type: z.union([factorType, z.literal('recovery_code')]), status: z.enum(['verified', 'unverified']), friendly_name: z.string().nullable().optional(),
})
const factorsSchema = z.object({ factors: z.array(factorSchema).nullable().optional() })
const emailInput = z.email().trim().max(320)
const phoneInput = z.string().regex(/^\+[1-9]\d{7,14}$/)
const destination = z.discriminatedUnion('method', [
  z.object({ method: z.literal('email'), email: emailInput }).strict(),
  z.object({ method: z.literal('magicLink'), email: emailInput, return_to: z.string().max(256).optional() }).strict(),
  z.object({ method: z.literal('sms'), phone: phoneInput }).strict(),
])
const otpVerification = z.discriminatedUnion('method', [
  z.object({ method: z.literal('email'), email: emailInput, code: z.string().regex(/^\d{4,10}$/) }).strict(),
  z.object({ method: z.literal('sms'), phone: phoneInput, code: z.string().regex(/^\d{4,10}$/) }).strict(),
])
const webauthnCredential = z.record(z.string(), z.unknown())
const passkeyVerification = z.object({ challenge_id: z.uuid(), credential: webauthnCredential }).strict()
const verifierCookie = 'edulog_passwordless'
const returnCookie = 'edulog_passwordless_return'
const callbackPath = '/api/auth/session/callback'

function authEndpoint(config: ApiConfig, path: string) {
  const base = config.GOTRUE_INTERNAL_URL || `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`
  return `${base.replace(/\/$/, '')}${path}`
}

async function requestAuth<T>(config: ApiConfig, path: string, options: { body?: unknown; token?: string; method?: 'POST' | 'DELETE' | 'PATCH' } = {}): Promise<T> {
  try {
    const response = await fetch(authEndpoint(config, path), {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: { apikey: config.SUPABASE_ANON_KEY, 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 429) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests')
    if (response.status === 404 && path === '/factors/recovery-codes' && !options.body && !options.method) return null as T
    if (response.status >= 500) throw new Error('GoTrue unavailable')
    if (!response.ok) throw new ApiError(422, 'AUTH_METHOD_FAILED', 'The authentication request could not be completed')
    if (response.status === 204 || response.headers.get('content-length') === '0') return null as T
    const data = await response.text()
    return data ? JSON.parse(data) as T : null as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(503, 'AUTH_METHOD_UNAVAILABLE', 'The authentication service is temporarily unavailable')
  }
}

async function getFactors(config: ApiConfig, token: string) {
  const result = factorsSchema.safeParse(await requestAuth<unknown>(config, '/user', { token }))
  if (!result.success) throw new ApiError(503, 'AUTH_METHOD_UNAVAILABLE', 'Factor information is temporarily unavailable')
  return result.data.factors ?? []
}

export async function ensureSessionAssurance(config: ApiConfig, token: string, user?: { factors?: Array<{ status: string }> }) {
  // The caller must authenticate the JWT (or receive it directly from GoTrue) before inspecting its claims.
  let aal: unknown
  try { aal = decodeJwt(token).aal } catch { /* Get factor state for legacy or opaque sessions. */ }
  if (aal === 'aal2') return
  const factors = user ? user.factors ?? [] : await getFactors(config, token)
  if (factors.some(factor => factor.status === 'verified')) throw new ApiError(403, 'MFA_REQUIRED', 'Complete multi-factor authentication to continue')
}

type AuthRouteOptions = {
  config: ApiConfig
  activeAccount: RequestHandler
  challengeAccount: RequestHandler
  rateLimiter: RequestHandler
  sendSession(req: Request, res: Response, session: GoTrueSession): Promise<'active' | 'pending'>
}

export function registerAdditionalAuthRoutes(router: Router, { config, activeAccount, challengeAccount, rateLimiter, sendSession }: AuthRouteOptions) {
  const callback = new URL(callbackPath, config.EDULOG_WEB_BASE_URL)
  const cookie = { httpOnly: true, sameSite: 'lax' as const, secure: config.COOKIE_SECURE, path: callbackPath }
  const result = (req: Request, res: Response, data: unknown) => res.set('Cache-Control', 'no-store')
    .json({ data, meta: {}, request_id: req.requestId, trace_id: req.traceId })
  const startFlow = (res: Response, rawReturnTo: unknown) => {
    const { verifier, challenge } = createPkcePair()
    res.cookie(verifierCookie, verifier, { ...cookie, maxAge: 10 * 60 * 1000 })
    const returnTo = outboundConsentReturn(rawReturnTo)
    if (returnTo) res.cookie(returnCookie, returnTo, { ...cookie, maxAge: 10 * 60 * 1000 })
    else res.clearCookie(returnCookie, cookie)
    return { code_challenge: challenge, code_challenge_method: 's256' }
  }
  async function activateSession(req: Request, res: Response, session: GoTrueSession) {
    const status = await sendSession(req, res, session)
    try { await ensureSessionAssurance(config, session.access_token) }
    catch (error) {
      if (error instanceof ApiError && error.code === 'MFA_REQUIRED') return '/login?mfa=1'
      throw error
    }
    return status === 'pending' ? '/account-pending' : '/dashboard'
  }
  function requireEnabled(enabled: boolean | undefined) {
    if (!enabled) throw new ApiError(403, 'AUTH_METHOD_DISABLED', 'This authentication method is disabled')
  }
  function browserToken(req: Request) {
    if (!req.accessToken || req.cookies?.edulog_access !== req.accessToken) throw new ApiError(401, 'AUTH_REQUIRED', 'A browser session is required')
    return req.accessToken
  }
  const verifyEnabled = {
    totp: config.AUTH_MFA_TOTP_VERIFY_ENABLED,
    phone: config.AUTH_MFA_PHONE_VERIFY_ENABLED,
    webauthn: config.AUTH_MFA_WEBAUTHN_VERIFY_ENABLED,
  }
  const enrollEnabled = {
    totp: config.AUTH_MFA_TOTP_ENROLL_ENABLED,
    phone: config.AUTH_MFA_PHONE_ENROLL_ENABLED,
    webauthn: config.AUTH_MFA_WEBAUTHN_ENROLL_ENABLED,
  }
  const settings = () => requestAuth<{ external?: { email?: boolean; phone?: boolean }; sms_provider?: string; saml_enabled?: boolean; passkeys_enabled?: boolean }>(config, '/settings')
  async function checkOtpMethod(method: 'email' | 'magicLink' | 'sms') {
    const state = await settings()
    requireEnabled(method === 'sms' ? Boolean(state.external?.phone && state.sms_provider)
      : Boolean(state.external?.email && config.AUTH_MAIL_DELIVERY_ENABLED && (method === 'email' ? config.AUTH_EMAIL_OTP_ENABLED : config.AUTH_MAGIC_LINK_ENABLED)))
  }

  router.post('/session/otp', rateLimiter, async (req, res) => {
    const input = destination.parse(req.body)
    await checkOtpMethod(input.method)
    const isLink = input.method === 'magicLink'
    const flow = isLink ? startFlow(res, input.return_to) : {}
    const target = 'email' in input ? { email: input.email } : { phone: input.phone, channel: 'sms' }
    try {
      await requestAuth(config, isLink ? `/otp?redirect_to=${encodeURIComponent(callback.href)}` : '/otp', {
        body: { ...target, create_user: false, ...flow },
      })
    } catch (error) {
      // Existing-account sign-in must not disclose whether the destination has an account.
      if (!(error instanceof ApiError) || error.code !== 'AUTH_METHOD_FAILED') throw error
    }
    return result(req, res, { sent: true })
  })

  router.post('/session/otp/verify', rateLimiter, async (req, res) => {
    const input = otpVerification.parse(req.body)
    await checkOtpMethod(input.method)
    const body = input.method === 'email' ? { email: input.email, type: 'email', token: input.code } : { phone: input.phone, type: 'sms', token: input.code }
    const session = await requestAuth<GoTrueSession>(config, '/verify', { body })
    return result(req, res, { redirect: await activateSession(req, res, session) })
  })

  router.post('/session/sso', rateLimiter, async (req, res) => {
    const { domain, return_to } = z.object({
      domain: z.string().trim().max(253).regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i),
      return_to: z.string().max(256).optional(),
    }).strict().parse(req.body)
    requireEnabled((await settings()).saml_enabled)
    const { url } = await requestAuth<{ url?: string }>(config, '/sso', {
      body: { domain: domain.toLowerCase(), redirect_to: callback.href, skip_http_redirect: true, ...startFlow(res, return_to) },
    })
    if (!url || !validProviderAuthorizeLocation(url, config)) throw new ApiError(503, 'AUTH_METHOD_UNAVAILABLE', 'The authentication service is temporarily unavailable')
    return result(req, res, { url })
  })

  router.get('/sso/saml/metadata', rateLimiter, async (_req, res) => {
    requireEnabled((await settings()).saml_enabled)
    const upstream = await fetch(authEndpoint(config, '/sso/saml/metadata'), {
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    })
    if (!upstream.ok) throw new ApiError(503, 'AUTH_METHOD_UNAVAILABLE', 'SAML metadata is temporarily unavailable')
    return res.type('application/samlmetadata+xml').send(await upstream.text())
  })

  router.post('/sso/saml/acs', rateLimiter, urlencoded({ extended: false, limit: '256kb' }), async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    requireEnabled((await settings()).saml_enabled)
    const { SAMLResponse, RelayState } = z.object({ SAMLResponse: z.string().min(1).max(256 * 1024), RelayState: z.string().min(1).max(512) }).parse(req.body)
    const upstream = await fetch(authEndpoint(config, '/sso/saml/acs'), {
      method: 'POST', body: new URLSearchParams({ SAMLResponse, RelayState }),
      redirect: 'manual', signal: AbortSignal.timeout(10_000),
    })
    const location = upstream.headers.get('location')
    await upstream.body?.cancel().catch(() => undefined)
    if (![302, 303].includes(upstream.status) || !location) return res.redirect(303, '/login?error=link')
    const destination = new URL(location, callback)
    if (destination.origin !== callback.origin || destination.pathname !== callback.pathname || destination.hash) {
      return res.redirect(303, '/login?error=link')
    }
    return res.redirect(303, destination.href)
  })

  router.get('/session/callback', rateLimiter, async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    const verifier = req.cookies?.[verifierCookie]
    const returnTo = outboundConsentReturn(req.cookies?.[returnCookie])
    res.clearCookie(verifierCookie, cookie)
    res.clearCookie(returnCookie, cookie)
    const parsed = z.string().min(1).max(512).safeParse(req.query.code)
    if (!parsed.success || typeof verifier !== 'string') return res.redirect(303, '/login?error=link')
    try {
      const session = await exchangeAuthCode(config, parsed.data, verifier)
      const target = await activateSession(req, res, session)
      if (!returnTo) return res.redirect(303, target)
      if (target === '/login?mfa=1') return res.redirect(303, `${target}&redirect=${encodeURIComponent(returnTo)}`)
      return res.redirect(303, target === '/dashboard' ? returnTo : target)
    } catch (error) {
      return res.redirect(303, error instanceof Error && error.message === 'AUTH_DISABLED' ? '/account-disabled' : '/login?error=link')
    }
  })

  router.post('/session/passkey/options', rateLimiter, async (req, res) => {
    requireEnabled((await settings()).passkeys_enabled)
    return result(req, res, await requestAuth(config, '/passkeys/authentication/options', { body: {} }))
  })
  router.post('/session/passkey/verify', rateLimiter, async (req, res) => {
    requireEnabled((await settings()).passkeys_enabled)
    const session = await requestAuth<GoTrueSession>(config, '/passkeys/authentication/verify', { body: passkeyVerification.parse(req.body) })
    return result(req, res, { redirect: await activateSession(req, res, session) })
  })

  router.get('/me/factors', rateLimiter, challengeAccount, async (req, res) => {
    const token = browserToken(req)
    const factors = await getFactors(config, token)
    return result(req, res, factors.map(factor => ({
      ...factor,
      can_verify: factor.factor_type === 'recovery_code' ? config.AUTH_MFA_RECOVERY_CODES_ENABLED : verifyEnabled[factor.factor_type],
    })))
  })
  router.post('/me/factors', rateLimiter, activeAccount, async (req, res) => {
    const body = z.object({ factor_type: factorType, friendly_name: z.string().trim().min(1).max(120).optional(), phone: phoneInput.optional() }).strict().parse(req.body)
    requireEnabled(enrollEnabled[body.factor_type] && verifyEnabled[body.factor_type])
    return result(req, res, await requestAuth(config, '/factors', { body, token: browserToken(req) }))
  })
  router.delete('/me/factors/:id', rateLimiter, activeAccount, async (req, res) => {
    const id = z.uuid().parse(req.params.id)
    return result(req, res, await requestAuth(config, `/factors/${id}`, { method: 'DELETE', token: browserToken(req) }))
  })
  const factorActions = ['/challenge', '/verify'] as const
  for (const action of factorActions) {
    const bodySchema = action === '/challenge' ? z.object({}).strict()
      : z.object({ challenge_id: z.uuid(), code: z.string().regex(/^\d{4,10}$/).optional(),
        webauthn: z.object({ type: z.enum(['create', 'request']), credential_response: webauthnCredential }).strict().optional() }).strict()
    router.post(`/me/factors/:id${action}`, rateLimiter, challengeAccount, async (req, res) => {
      const id = z.uuid().parse(req.params.id)
      const token = browserToken(req)
      const factors = await getFactors(config, token)
      const factor = factors.find(candidate => candidate.id === id)
      if (!factor || factor.factor_type === 'recovery_code') throw new ApiError(404, 'NOT_FOUND', 'The authenticator was not found')
      requireEnabled(verifyEnabled[factor.factor_type])
      if (factor.status !== 'verified' && factors.some(candidate => candidate.status === 'verified')) {
        await ensureSessionAssurance(config, token)
      }
      const data = await requestAuth<unknown>(config, `/factors/${id}${action}`, { body: bodySchema.parse(req.body), token })
      if (action === '/challenge') return result(req, res, data)
      return result(req, res, { redirect: await activateSession(req, res, data as GoTrueSession) })
    })
  }

  const recoveryPath = '/factors/recovery-codes'
  for (const [method, route, path] of [
    ['get', '/me/recovery-codes', recoveryPath],
    ['post', '/me/recovery-codes', recoveryPath],
    ['post', '/me/recovery-codes/regenerate', `${recoveryPath}/regenerate`],
    ['delete', '/me/recovery-codes', recoveryPath],
  ] as const) {
    router[method](route, rateLimiter, activeAccount, async (req, res) => {
      requireEnabled(config.AUTH_MFA_RECOVERY_CODES_ENABLED)
      const token = browserToken(req)
      return result(req, res, await requestAuth(config, path, method === 'get' ? { token }
        : method === 'delete' ? { token, method: 'DELETE' } : { token, body: {} }))
    })
  }
  router.post('/me/recovery-codes/verify', rateLimiter, challengeAccount, async (req, res) => {
    requireEnabled(config.AUTH_MFA_RECOVERY_CODES_ENABLED)
    const body = z.object({ code: z.string().trim().min(1).max(128) }).strict().parse(req.body)
    const session = await requestAuth<GoTrueSession>(config, `${recoveryPath}/verify`, { token: browserToken(req), body })
    return result(req, res, { redirect: await activateSession(req, res, session) })
  })

  router.get('/me/passkeys', rateLimiter, activeAccount, async (req, res) => {
    requireEnabled((await settings()).passkeys_enabled)
    return result(req, res, await requestAuth(config, '/passkeys', { token: browserToken(req) }))
  })
  for (const action of ['options', 'verify'] as const) {
    router.post(`/me/passkeys/registration/${action}`, rateLimiter, activeAccount, async (req, res) => {
      requireEnabled((await settings()).passkeys_enabled)
      const body = action === 'options' ? {} : passkeyVerification.parse(req.body)
      return result(req, res, await requestAuth(config, `/passkeys/registration/${action}`, { token: browserToken(req), body }))
    })
  }
  router.delete('/me/passkeys/:id', rateLimiter, activeAccount, async (req, res) => {
    requireEnabled((await settings()).passkeys_enabled)
    const id = z.uuid().parse(req.params.id)
    return result(req, res, await requestAuth(config, `/passkeys/${id}`, { token: browserToken(req), method: 'DELETE' }))
  })
}
