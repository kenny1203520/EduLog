import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import { z } from 'zod'
import type { ApiConfig } from '../config/config.js'

export const identityCallback = '/api/auth/identities/callback'
export const identityReturn = '/dashboard/settings?tab=personal'
const cookie = 'edulog_identity_flow'
const path = '/api/auth'
const ttl = 10 * 60 * 1000
const schema = z.object({ state: z.string().uuid(), userId: z.string().uuid(), provider: z.string(), verifier: z.string(), expires: z.number() })
type Flow = Omit<z.infer<typeof schema>, 'expires'>

function signature(config: ApiConfig, value: string) {
  return crypto.createHmac('sha256', config.COOKIE_SECRET).update(`identity-link:${value}`).digest('base64url')
}

export function setIdentityFlow(res: Response, config: ApiConfig, flow: Flow) {
  const value = Buffer.from(JSON.stringify({ ...flow, expires: Date.now() + ttl })).toString('base64url')
  res.cookie(cookie, `${value}.${signature(config, value)}`, {
    path, httpOnly: true, secure: config.COOKIE_SECURE, sameSite: config.COOKIE_SECURE ? 'none' : 'lax', maxAge: ttl,
  })
}

export function clearIdentityFlow(res: Response) {
  res.clearCookie(cookie, { path })
}

export function readIdentityFlow(req: Request, config: ApiConfig) {
  const raw = req.cookies?.[cookie]
  if (typeof raw !== 'string' || raw.length > 2048) return null
  const [value, mac, extra] = raw.split('.')
  if (!value || !mac || extra !== undefined) return null
  const expected = Buffer.from(signature(config, value))
  const supplied = Buffer.from(mac)
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null
  try {
    const data = schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString()))
    return data.expires > Date.now() ? data : null
  } catch { return null }
}
