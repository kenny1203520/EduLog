import express, { Router, type Request, type Response } from 'express'
import type { ApiConfig } from '../config/config.js'
import { ApiError } from '../http/errors.js'
import { forwardOAuthCallback } from './gotrue.js'

const CALLBACK_STATE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CALLBACK_KEY = /^[A-Za-z0-9_.-]{1,80}$/
const MAX_CALLBACK_BYTES = 16 * 1024
const MAX_CALLBACK_PARAMETERS = 32
const FINAL_QUERY_KEYS = new Set(['code', 'error', 'error_code', 'error_description', 'error_uri'])
const FINAL_ERROR_FRAGMENT_KEYS = new Set(['error', 'error_description', 'error_code', 'sb'])

function invalidCallback(): ApiError {
  return new ApiError(400, 'OAUTH_CALLBACK_INVALID', 'OAuth callback is invalid')
}

function callbackParameters(req: Request, config: ApiConfig): URLSearchParams {
  const parameters = new URLSearchParams()
  let entries: Array<[string, unknown]>

  if (req.method === 'GET') {
    if (Buffer.byteLength(req.originalUrl) > MAX_CALLBACK_BYTES) throw invalidCallback()
    const requestUrl = new URL(req.originalUrl, config.EDULOG_WEB_BASE_URL)
    entries = [...requestUrl.searchParams.entries()]
  } else {
    if (!req.is('application/x-www-form-urlencoded') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw invalidCallback()
    }
    const requestUrl = new URL(req.originalUrl, config.EDULOG_WEB_BASE_URL)
    if (requestUrl.search) throw invalidCallback()
    entries = Object.entries(req.body as Record<string, unknown>)
  }

  if (entries.length === 0 || entries.length > MAX_CALLBACK_PARAMETERS) throw invalidCallback()
  const seen = new Set<string>()
  let byteLength = 0
  for (const [key, rawValue] of entries) {
    if (!CALLBACK_KEY.test(key) || seen.has(key) || typeof rawValue !== 'string' || /[\u0000-\u001f\u007f]/.test(rawValue)) {
      throw invalidCallback()
    }
    seen.add(key)
    byteLength += Buffer.byteLength(key) + Buffer.byteLength(rawValue)
    if (byteLength > MAX_CALLBACK_BYTES) throw invalidCallback()
    parameters.append(key, rawValue)
  }

  const state = parameters.get('state')
  const code = parameters.get('code')
  const error = parameters.get('error')
  const oauthToken = parameters.get('oauth_token')
  const oauthVerifier = parameters.get('oauth_verifier')
  const denied = parameters.get('denied')
  const oauth1Callback = Boolean((oauthToken && oauthVerifier) || denied)
  if (!state || !CALLBACK_STATE.test(state) || (!code && !error && !oauth1Callback) || (error !== null && !error) || Boolean(oauthToken) !== Boolean(oauthVerifier) || (code && error)) throw invalidCallback()
  return parameters
}

function finalCallbackLocation(config: ApiConfig, location: string): string | null {
  try {
    if (Buffer.byteLength(location) > MAX_CALLBACK_BYTES) return null
    const expected = new URL('/api/auth/oauth/callback', config.EDULOG_WEB_BASE_URL)
    const target = new URL(location, expected)
    if (target.origin !== expected.origin || target.pathname !== expected.pathname || target.username || target.password) return null
    if (target.hash) {
      const fragment = new URLSearchParams(target.hash.slice(1))
      const seen = new Set<string>()
      for (const [key] of fragment) {
        if (!FINAL_ERROR_FRAGMENT_KEYS.has(key) || seen.has(key)) return null
        seen.add(key)
      }
      if (fragment.get('error') !== target.searchParams.get('error') || !fragment.has('sb') || fragment.get('sb') !== '') return null
      for (const key of ['error_description', 'error_code']) {
        if (fragment.has(key) !== target.searchParams.has(key) || fragment.get(key) !== target.searchParams.get(key)) return null
      }
      target.hash = ''
    }
    if ([...target.searchParams.keys()].length > 5) return null
    const seen = new Set<string>()
    for (const [key, value] of target.searchParams) {
      if (!FINAL_QUERY_KEYS.has(key) || seen.has(key) || (['code', 'error'].includes(key) && !value) || Buffer.byteLength(value) > 8192) return null
      seen.add(key)
    }
    if (!target.searchParams.has('code') && !target.searchParams.has('error')) return null
    return target.toString()
  } catch {
    return null
  }
}

function markSensitiveRedirect(res: Response) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
}

/** Fixed callback bridge for external OAuth providers; GoTrue validates state and consumes its PKCE flow. */
export function createOAuthBridgeRouter(config: ApiConfig) {
  const router = Router()

  const handle = async (req: Request, res: Response) => {
    markSensitiveRedirect(res)
    const parameters = callbackParameters(req, config)
    let response: globalThis.Response
    try {
      response = await forwardOAuthCallback(config, req.method as 'GET' | 'POST', parameters)
    } catch {
      throw new ApiError(502, 'OAUTH_CALLBACK_FAILED', 'OAuth sign-in could not be completed')
    }
    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => undefined)
    const safeLocation = [302, 303, 307, 308].includes(response.status) && location
      ? finalCallbackLocation(config, location)
      : null
    if (!safeLocation) throw new ApiError(502, 'OAUTH_CALLBACK_FAILED', 'OAuth sign-in could not be completed')
    return res.redirect(303, safeLocation)
  }

  router.head('/', (_req, _res, next) => next(new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed')))
  router.get('/', (req, res, next) => { void handle(req, res).catch(next) })
  router.post('/', express.urlencoded({ extended: false, limit: MAX_CALLBACK_BYTES, parameterLimit: MAX_CALLBACK_PARAMETERS }), (req, res, next) => {
    void handle(req, res).catch(next)
  })
  return router
}
