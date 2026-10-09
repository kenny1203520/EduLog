import crypto from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiConfig } from './config.js'
import type { SupabaseClients } from './supabase.js'
import { requireAuth, csrfProtection } from './auth.js'
import { ApiError, mapDatabaseError } from './errors.js'
import { createExtensionWorkspaceRouter } from './extensionWorkspaceRouter.js'

const installationShape = {
  installation_id: z.string().uuid(), device_name: z.string().trim().min(1).max(80),
  browser_name: z.string().trim().min(1).max(40), platform_name: z.string().trim().min(1).max(40),
  extension_version: z.string().trim().min(1).max(40),
}
export const installationBody = z.object(installationShape).strict()
export const pairStartBody = z.object({ code_challenge: z.string().regex(/^[a-f0-9]{64}$/), ...installationBody.partial().shape }).strict().refine(
  value => Object.keys(installationShape).every(key => value[key as keyof typeof installationShape] === undefined) || Object.keys(installationShape).every(key => value[key as keyof typeof installationShape] !== undefined),
  { message: 'Installation metadata must be supplied together' },
)
export const pairClaimBody = z.object({ code_verifier: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const connectionNameBody = z.object({ device_name: installationShape.device_name }).strict()
const nameBody = z.object({ device_name: installationShape.device_name.optional() }).strict()
const tokenFields = 'id,extension_origin,installation_id,device_name,browser_name,platform_name,extension_version,created_at,last_used_at,expires_at,revoked_at'
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

function integrationError(error: { message: string; code?: string }) {
  const statuses: Record<string, number> = { PAIRING_REQUEST_EXPIRED: 404, PAIRING_ALREADY_CLAIMED: 409, PAIRING_NOT_APPROVED: 409, PAIRING_PROOF_INVALID: 401, EXTENSION_AUTH_INVALID: 401, INSTALLATION_MISMATCH: 409, INSTALLATION_ALREADY_AUTHORIZED: 409 }
  return statuses[error.message] ? new ApiError(statuses[error.message]!, error.message, error.message) : mapDatabaseError(error)
}

export function buildExtensionSettingsUrl(webBaseUrl: string) {
  const url = new URL(webBaseUrl)
  const basePath = url.pathname.replace(/\/+$/, '')
  url.pathname = `${basePath}/dashboard/settings`
  url.searchParams.set('tab', 'integrations')
  return url.toString()
}

export function buildExtensionApprovalUrl(webBaseUrl: string, pairingRequestId: string) {
  const url = new URL(buildExtensionSettingsUrl(webBaseUrl))
  url.searchParams.set('extension_pair', pairingRequestId)
  return url.toString()
}

function allowedExtensionOrigin(config: ApiConfig, origin: string | undefined) {
  if (!origin || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return false
  return config.API_EXTENSION_ALLOWED_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean).includes(origin)
}

function requireExtensionToken(adminClient: SupabaseClient, config: ApiConfig) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const origin = req.header('origin')
      // Browser extension fetches may omit Origin on credentialed GETs even
      // though the same extension sent Origin during pairing. When present,
      // still require an exact match; when absent, validate the token's bound
      // extension origin against the server allowlist below.
      if (origin && !allowedExtensionOrigin(config, origin)) throw new ApiError(403, 'EXTENSION_ORIGIN_FORBIDDEN', 'This extension origin is not enabled')
      const bearer = req.header('authorization')?.match(/^Bearer\s+([a-f0-9]{64})$/i)?.[1]
      if (!bearer) throw new ApiError(401, 'EXTENSION_AUTH_REQUIRED', 'Extension authorization is required')
      const result = await adminClient.from('web_extension_tokens')
        .select('id,user_id,extension_origin,installation_id,device_name,browser_name,platform_name,extension_version,last_used_at,expires_at,revoked_at')
        .eq('token_hash', hash(bearer)).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
      if (result.error) throw mapDatabaseError(result.error)
      if (!result.data) throw new ApiError(401, 'EXTENSION_AUTH_INVALID', 'Extension authorization is invalid or expired')
      if (!allowedExtensionOrigin(config, result.data.extension_origin) || (origin && result.data.extension_origin !== origin)) {
        throw new ApiError(403, 'EXTENSION_ORIGIN_FORBIDDEN', 'This extension origin is not enabled')
      }
      req.extensionPrincipal = { tokenId: result.data.id, userId: result.data.user_id, extensionOrigin: result.data.extension_origin, connection: {
        installation_id: result.data.installation_id ?? null, device_name: result.data.device_name ?? null,
        browser_name: result.data.browser_name ?? null, platform_name: result.data.platform_name ?? null, extension_version: result.data.extension_version ?? null,
      } }
      // Supabase builders are lazy thenables; a fire-and-forget builder never executes.
      if (!result.data.last_used_at || Date.now() - new Date(result.data.last_used_at).getTime() >= 60_000) {
        await adminClient.from('web_extension_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', result.data.id)
      }
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
    const created = await admin.from('web_extension_pairing_requests').insert({ extension_origin: origin, ...input }).select('id,expires_at').single()
    if (created.error) throw mapDatabaseError(created.error)
    return res.status(201).json(envelope(req, { id: created.data.id, authorize_url: buildExtensionApprovalUrl(config.EDULOG_WEB_BASE_URL, created.data.id), expires_at: created.data.expires_at }))
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
    const token = crypto.randomBytes(32).toString('hex')
    const claimed = await admin.rpc('claim_web_extension_pairing', { p_request_id: id, p_origin: origin, p_verifier_hash: hash(input.code_verifier), p_token_hash: hash(token) }).single()
    if (claimed.error) throw integrationError(claimed.error)
    const issued = z.object({ token_id: uuid, expires_at: z.string() }).parse(claimed.data)
    return res.json(envelope(req, { token, token_id: issued.token_id, expires_at: issued.expires_at }))
  }))

  router.post('/pair-requests/:id/approve', csrfProtection, requireAuth(clients, config), wrap(async (req, res) => {
    const id = uuid.parse(req.params.id)
    const input = nameBody.parse(req.body)
    const selected = await admin.from('web_extension_pairing_requests').select('id,status,expires_at,extension_origin').eq('id', id).maybeSingle()
    if (selected.error) throw mapDatabaseError(selected.error)
    if (!selected.data || selected.data.expires_at <= new Date().toISOString() || selected.data.status !== 'pending') throw new ApiError(404, 'PAIRING_REQUEST_EXPIRED', 'Pairing request was not found or expired')
    const result = await admin.from('web_extension_pairing_requests').update({ user_id: req.user!.id, status: 'approved', approved_at: new Date().toISOString(), ...input }).eq('id', id).eq('status', 'pending').select('id,extension_origin,expires_at').maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data) throw new ApiError(409, 'PAIRING_ALREADY_APPROVED', 'Pairing request has already been approved')
    return res.json(envelope(req, { approved: true, extension_origin: result.data.extension_origin, expires_at: result.data.expires_at }))
  }))

  router.get('/pair-requests/:id/approval', requireAuth(clients, config), wrap(async (req, res) => {
    const id = uuid.parse(req.params.id)
    const result = await admin.from('web_extension_pairing_requests').select('id,user_id,status,extension_origin,expires_at,installation_id,device_name,browser_name,platform_name,token_id').eq('id', id).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data || (result.data.user_id && result.data.user_id !== req.user!.id) || !['pending', 'approved', 'claimed'].includes(result.data.status) || (result.data.status !== 'claimed' && result.data.expires_at <= new Date().toISOString())) throw new ApiError(404, 'PAIRING_REQUEST_EXPIRED', 'Pairing request was not found or expired')
    const { user_id: _userId, ...approval } = result.data
    return res.json(envelope(req, approval))
  }))

  router.get('/tokens', requireAuth(clients, config), wrap(async (req, res) => {
    const result = await admin.from('web_extension_tokens').select(tokenFields).eq('user_id', req.user!.id).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(100)
    if (result.error) throw mapDatabaseError(result.error)
    return res.json(envelope(req, result.data ?? []))
  }))

  router.patch('/tokens/:id', csrfProtection, requireAuth(clients, config), wrap(async (req, res) => {
    const id = uuid.parse(req.params.id)
    const input = connectionNameBody.parse(req.body)
    const result = await admin.from('web_extension_tokens').update(input).eq('id', id).eq('user_id', req.user!.id).is('revoked_at', null).gt('expires_at', new Date().toISOString()).select(tokenFields).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data) throw new ApiError(404, 'EXTENSION_TOKEN_NOT_FOUND', 'Extension connection was not found')
    return res.json(envelope(req, result.data))
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
  extensionApi.get('/me', wrap(async (req, res) => {
    const tokenHash = hash(req.header('authorization')!.replace(/^Bearer\s+/i, ''))
    const [readiness, catalog, fieldMappings, syncPreferences, workRecords] = await Promise.all([
      admin.rpc('web_extension_workspace', { p_token_id: req.extensionPrincipal!.tokenId, p_token_hash: tokenHash, p_operation: 'capabilities', p_input: {} }),
      admin.rpc('web_extension_catalog', { p_token_id: req.extensionPrincipal!.tokenId, p_token_hash: tokenHash, p_operation: 'capabilities', p_input: {} }),
      admin.rpc('web_extension_field_mappings', { p_token_id: req.extensionPrincipal!.tokenId, p_token_hash: tokenHash, p_operation: 'capabilities', p_input: {} }),
      admin.rpc('web_extension_sync_preferences', { p_token_id: req.extensionPrincipal!.tokenId, p_token_hash: tokenHash, p_operation: 'capabilities', p_input: { source_origin: 'https://corp.orangeapple.co', adapter_version: 'orange-apple-v1' } }),
      admin.rpc('web_extension_work_records', { p_token_id: req.extensionPrincipal!.tokenId, p_token_hash: tokenHash, p_operation: 'capabilities', p_input: {} }),
    ])
    const ready = !readiness.error && readiness.data?.workspace_version === 1
    return res.json(envelope(req, {
      user_id: req.extensionPrincipal!.userId,
      token_id: req.extensionPrincipal!.tokenId,
      connection: req.extensionPrincipal!.connection,
      settings_url: buildExtensionSettingsUrl(config.EDULOG_WEB_BASE_URL),
      capabilities: {
        connection_management: true,
        field_mapping_memory: !fieldMappings.error && fieldMappings.data?.field_mapping_memory === true,
        global_progress_mapping: !fieldMappings.error && fieldMappings.data?.global_progress_mapping === true,
        sync_field_preferences: !syncPreferences.error && syncPreferences.data?.sync_field_preferences === true,
        work_record_metadata: !workRecords.error && workRecords.data?.work_records === true,
        history_binding_field_mask: !fieldMappings.error && fieldMappings.data?.history_binding_field_mask === true,
        teaching_data_import: ready,
        report_prefill: ready,
        catalog_v1: !catalog.error && catalog.data?.catalog_version === 1,
        multi_course_import: !catalog.error && catalog.data?.multi_course_import === true,
        mapping_memory: !catalog.error && catalog.data?.mapping_memory === true,
        student_enrollment_catalog: !catalog.error && catalog.data?.student_enrollment_catalog === true,
        enrollment_reconciliation: !catalog.error && catalog.data?.enrollment_reconciliation === true,
        transferred_occurrence_import: ready && readiness.data?.transferred_occurrence_import === true,
        enrollment_history_reports: ready && readiness.data?.enrollment_history_reports === true,
        per_occurrence_report_routing: ready && readiness.data?.per_occurrence_report_routing === true,
        nearest_report_candidates: !catalog.error && catalog.data?.nearest_report_candidates === true,
      },
      integration_limits: { batch_records: 50, batch_bytes: extensionBatchBytes(config.API_BODY_LIMIT) },
    }))
  }))
  extensionApi.patch('/installation', wrap(async (req, res) => {
    const input = installationBody.parse(req.body)
    const result = await admin.rpc('bind_web_extension_installation', { p_token_id: req.extensionPrincipal!.tokenId, ...Object.fromEntries(Object.entries(input).map(([key, value]) => [`p_${key}`, value])) })
    if (result.error) throw integrationError(result.error)
    return res.json(envelope(req, { bound: true }))
  }))
  extensionApi.use(createExtensionWorkspaceRouter(admin))
  router.use('/v1', extensionApi)
  return router
}

export function extensionBatchBytes(bodyLimit: string) {
  const match = bodyLimit.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i)
  const bytes = match ? Number(match[1]) * ({ b: 1, kb: 1024, mb: 1048576, gb: 1073741824 }[match[2]?.toLowerCase() || 'b'] || 1) : 200000
  return Math.max(0, Math.min(180000, Math.floor(bytes) - 1024))
}
