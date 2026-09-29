import crypto from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiConfig } from './config.js'
import type { SupabaseClients } from './supabase.js'
import { requireAuth, csrfProtection } from './auth.js'
import { ApiError, mapDatabaseError } from './errors.js'

const pairStartBody = z.object({ code_challenge: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const pairClaimBody = z.object({ code_verifier: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const uuid = z.string().uuid()

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

function envelope(req: Request, data: unknown) {
  return { data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
}

function hash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function allowedExtensionOrigin(config: ApiConfig, origin: string | undefined) {
  if (!origin || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return false
  return config.API_EXTENSION_ALLOWED_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean).includes(origin)
}

function requireExtensionToken(adminClient: SupabaseClient, config: ApiConfig) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const origin = req.header('origin')
      if (!allowedExtensionOrigin(config, origin)) throw new ApiError(403, 'EXTENSION_ORIGIN_FORBIDDEN', 'This extension origin is not enabled')
      const bearer = req.header('authorization')?.match(/^Bearer\s+([a-f0-9]{64})$/i)?.[1]
      if (!bearer) throw new ApiError(401, 'EXTENSION_AUTH_REQUIRED', 'Extension authorization is required')
      const result = await adminClient.from('web_extension_tokens')
        .select('id,user_id,extension_origin,expires_at,revoked_at')
        .eq('token_hash', hash(bearer)).eq('extension_origin', origin).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
      if (result.error) throw mapDatabaseError(result.error)
      if (!result.data) throw new ApiError(401, 'EXTENSION_AUTH_INVALID', 'Extension authorization is invalid or expired')
      req.extensionPrincipal = { tokenId: result.data.id, userId: result.data.user_id, extensionOrigin: result.data.extension_origin }
      void adminClient.from('web_extension_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', result.data.id)
      next()
    } catch (error) { next(error) }
  }
}

export function createExtensionIntegrationRouter(clients: SupabaseClients, config: ApiConfig) {
  const router = Router()
  const admin = clients.adminClient

  // Extension begins a PKCE-style pairing. The verifier stays in extension storage;
  // only its challenge is stored on the server.
  router.post('/pair-requests', wrap(async (req, res) => {
    const origin = req.header('origin')
    if (!allowedExtensionOrigin(config, origin)) throw new ApiError(403, 'EXTENSION_ORIGIN_FORBIDDEN', 'This extension origin is not enabled')
    const input = pairStartBody.parse(req.body)
    const created = await admin.from('web_extension_pairing_requests').insert({ extension_origin: origin, code_challenge: input.code_challenge }).select('id,expires_at').single()
    if (created.error) throw mapDatabaseError(created.error)
    return res.status(201).json(envelope(req, { id: created.data.id, authorize_url: `${config.API_BASE_URL.replace(/\/$/, '')}/dashboard/settings?tab=integrations&extension_pair=${created.data.id}`, expires_at: created.data.expires_at }))
  }))

  // Status can be polled before approval; origin and PKCE verifier are checked again at claim.
  router.get('/pair-requests/:id', wrap(async (req, res) => {
    const id = uuid.parse(req.params.id)
    const origin = req.header('origin')
    if (!allowedExtensionOrigin(config, origin)) throw new ApiError(403, 'EXTENSION_ORIGIN_FORBIDDEN', 'This extension origin is not enabled')
    const result = await admin.from('web_extension_pairing_requests').select('status,expires_at,extension_origin').eq('id', id).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data || result.data.extension_origin !== origin || result.data.expires_at <= new Date().toISOString()) throw new ApiError(404, 'PAIRING_REQUEST_EXPIRED', 'Pairing request was not found or expired')
    return res.json(envelope(req, { status: result.data.status, expires_at: result.data.expires_at }))
  }))

  router.post('/pair-requests/:id/claim', wrap(async (req, res) => {
    const id = uuid.parse(req.params.id)
    const origin = req.header('origin')
    if (!allowedExtensionOrigin(config, origin)) throw new ApiError(403, 'EXTENSION_ORIGIN_FORBIDDEN', 'This extension origin is not enabled')
    const input = pairClaimBody.parse(req.body)
    const selected = await admin.from('web_extension_pairing_requests').select('id,user_id,status,extension_origin,code_challenge,expires_at').eq('id', id).maybeSingle()
    if (selected.error) throw mapDatabaseError(selected.error)
    const request = selected.data
    if (!request || request.extension_origin !== origin || request.expires_at <= new Date().toISOString()) throw new ApiError(404, 'PAIRING_REQUEST_EXPIRED', 'Pairing request was not found or expired')
    if (request.status !== 'approved' || !request.user_id) throw new ApiError(409, 'PAIRING_NOT_APPROVED', 'Approve this pairing request in EduLog first')
    if (hash(input.code_verifier) !== request.code_challenge) throw new ApiError(401, 'PAIRING_PROOF_INVALID', 'Pairing proof is invalid')
    const token = crypto.randomBytes(32).toString('hex')
    const inserted = await admin.from('web_extension_tokens').insert({ user_id: request.user_id, extension_origin: origin, token_hash: hash(token) }).select('id,expires_at').single()
    if (inserted.error) throw mapDatabaseError(inserted.error)
    const consumed = await admin.from('web_extension_pairing_requests').update({ status: 'claimed', claimed_at: new Date().toISOString() }).eq('id', id).eq('status', 'approved').select('id').maybeSingle()
    if (consumed.error || !consumed.data) {
      await admin.from('web_extension_tokens').delete().eq('id', inserted.data.id)
      if (consumed.error) throw mapDatabaseError(consumed.error)
      throw new ApiError(409, 'PAIRING_ALREADY_CLAIMED', 'Pairing request has already been claimed')
    }
    return res.json(envelope(req, { token, token_id: inserted.data.id, expires_at: inserted.data.expires_at }))
  }))

  router.post('/pair-requests/:id/approve', csrfProtection, requireAuth(clients, config), wrap(async (req, res) => {
    const id = uuid.parse(req.params.id)
    const selected = await admin.from('web_extension_pairing_requests').select('id,status,expires_at,extension_origin').eq('id', id).maybeSingle()
    if (selected.error) throw mapDatabaseError(selected.error)
    if (!selected.data || selected.data.expires_at <= new Date().toISOString() || selected.data.status !== 'pending') throw new ApiError(404, 'PAIRING_REQUEST_EXPIRED', 'Pairing request was not found or expired')
    const result = await admin.from('web_extension_pairing_requests').update({ user_id: req.user!.id, status: 'approved', approved_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select('id,extension_origin,expires_at').maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data) throw new ApiError(409, 'PAIRING_ALREADY_APPROVED', 'Pairing request has already been approved')
    return res.json(envelope(req, { approved: true, extension_origin: result.data.extension_origin, expires_at: result.data.expires_at }))
  }))

  router.get('/pair-requests/:id/approval', requireAuth(clients, config), wrap(async (req, res) => {
    const id = uuid.parse(req.params.id)
    const result = await admin.from('web_extension_pairing_requests').select('id,status,extension_origin,expires_at').eq('id', id).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data || result.data.expires_at <= new Date().toISOString() || !['pending', 'approved'].includes(result.data.status)) throw new ApiError(404, 'PAIRING_REQUEST_EXPIRED', 'Pairing request was not found or expired')
    return res.json(envelope(req, { id: result.data.id, status: result.data.status, extension_origin: result.data.extension_origin, expires_at: result.data.expires_at }))
  }))

  router.get('/tokens', requireAuth(clients, config), wrap(async (req, res) => {
    const result = await admin.from('web_extension_tokens').select('id,extension_origin,created_at,last_used_at,expires_at,revoked_at').eq('user_id', req.user!.id).order('created_at', { ascending: false }).limit(50)
    if (result.error) throw mapDatabaseError(result.error)
    return res.json(envelope(req, result.data ?? []))
  }))

  router.delete('/tokens/:id', csrfProtection, requireAuth(clients, config), wrap(async (req, res) => {
    const id = uuid.parse(req.params.id)
    const result = await admin.from('web_extension_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', req.user!.id).is('revoked_at', null).select('id').maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data) throw new ApiError(404, 'EXTENSION_TOKEN_NOT_FOUND', 'Extension connection was not found')
    return res.json(envelope(req, { revoked: true }))
  }))

  const extensionApi = Router()
  extensionApi.use(requireExtensionToken(admin, config))
  extensionApi.get('/me', wrap(async (req, res) => res.json(envelope(req, {
    user_id: req.extensionPrincipal!.userId,
    capabilities: {
      connection_management: true,
      teaching_data_import: false,
      report_prefill: false,
    },
  }))))
  router.use('/v1', extensionApi)
  return router
}
