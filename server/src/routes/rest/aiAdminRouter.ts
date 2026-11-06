import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { AI_PERMISSIONS, requireAuthorizationRpcDecision } from '../../auth/authorization.js'
import type { AiServices } from '../../ai/aiServices.js'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { setAuditContext } from '../../http/context.js'
import { aggregateUsage, type UsageAdoptionRow, type UsageGenerationRow } from '../../ai/admin/usageStats.js'
import {
  createCredential,
  credentialPatchInput,
  CREDENTIAL_FIELDS,
  MODEL_FIELDS,
  modelInput,
  siteCredentialInput,
  testCredential,
  loadUsableCredential,
  updateCredential,
} from '../../ai/credentials/credentialStore.js'
import { fetchModelCatalog, sharedModelCatalogCache } from '../../ai/providers/modelCatalog.js'
import { computeQuotaBalance, pickEffectivePolicy, QUOTA_PERIODS } from '../../ai/quota/quotaBalance.js'
import { DEFAULT_REPORT_SYSTEM_RULES, REPORT_SYSTEM_PROMPT_KEY } from '../../ai/report/reportPrompt.js'
import { SupabaseReportAssistRepository } from '../../ai/report/supabaseReportAssistRepository.js'

const uuid = z.string().uuid()
const settingsInput = z.object({
  enabled: z.boolean().optional(),
  default_model_id: uuid.nullable().optional(),
  /** Require every teacher to acknowledge the notice again. */
  bump_notice_version: z.boolean().optional(),
}).strict()
const promptInput = z.object({ body: z.string().trim().min(1).max(100000) }).strict()
const policyInput = z.object({
  scope: z.enum(['default', 'role', 'user']),
  target_id: uuid.nullable().optional(),
  one_time_total: z.number().min(0).max(1_000_000).nullable().optional(),
  period: z.enum(QUOTA_PERIODS),
  period_amount: z.number().min(0).max(1_000_000).nullable().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.scope === 'default' && input.target_id) ctx.addIssue({ code: 'custom', path: ['target_id'], message: 'The default policy has no target' })
  if (input.scope !== 'default' && !input.target_id) ctx.addIssue({ code: 'custom', path: ['target_id'], message: 'A target is required' })
  if (input.period !== 'none' && input.period_amount == null) ctx.addIssue({ code: 'custom', path: ['period_amount'], message: 'A periodic amount is required' })
})
const ledgerInput = z.object({
  user_id: uuid,
  kind: z.enum(['grant', 'reset']),
  delta: z.number().min(0).max(1_000_000).optional(),
  note: z.string().trim().max(500).optional(),
}).strict()
const testInput = z.object({ model_id: z.string().trim().min(1).max(200) }).strict()
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const usageQuery = z.object({ from: dateParam, to: dateParam })
const logQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  user_id: uuid.optional(),
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled']).optional(),
})

/** Usage stats read at most this many generations per request. */
const USAGE_ROW_LIMIT = 10_000

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}
function envelope(req: Request, data: unknown, meta: Record<string, unknown> = {}) { return { data, meta, request_id: req.requestId, trace_id: req.traceId } }
function idParam(req: Request, name = 'id'): string {
  const value = req.params[name]
  if (typeof value !== 'string' || !uuid.safeParse(value).success) throw new ApiError(400, 'INVALID_ID', `${name} is invalid`)
  return value
}
function check<T extends { error: { code?: string, message?: string } | null }>(result: T): T {
  if (result.error) throw mapDatabaseError(result.error)
  return result
}

async function requireSystemPermission(req: Request, permission: string, action: string, resource: string) {
  if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  setAuditContext(req, { domain: 'system', resource, action, permission, scopeType: 'system' })
  await requireAuthorizationRpcDecision(
    req,
    req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: permission, p_classroom_id: null, p_class_session_id: null }),
    { permission, stage: 'ai_admin_permission', message: 'You do not have permission to manage AI settings', scopeType: 'system' },
  )
}
const requireManage = (req: Request, action: string, resource = 'ai_settings') => requireSystemPermission(req, AI_PERMISSIONS.manage, action, resource)

/** Logs and usage: system.ai.logs.view_all, or system.ai.manage. */
async function requireLogsView(req: Request) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const viewAll = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: AI_PERMISSIONS.logsViewAll, p_classroom_id: null, p_class_session_id: null })
  if (viewAll.data === true) {
    setAuditContext(req, { domain: 'system', resource: 'ai_generations', action: 'read', permission: AI_PERMISSIONS.logsViewAll, scopeType: 'system' })
    return
  }
  await requireSystemPermission(req, AI_PERMISSIONS.manage, 'read', 'ai_generations')
}

async function teacherNames(req: Request, userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return {}
  const rows = check(await req.adminDb!.from('teachers').select('user_id,name').in('user_id', ids)).data ?? []
  return Object.fromEntries(rows.map((row) => [row.user_id as string, row.name as string]))
}

/**
 * AI administration (Settings → System → AI), all under /api/ai/admin:
 * overview, settings, site credentials and models, prompt overrides, quota
 * policies and grants, usage statistics and the generation log.
 */
export function createAiAdminRouter({ cipher, presidio }: Pick<AiServices, 'cipher' | 'presidio'>) {
  const router = Router()

  router.get('/ai/admin/overview', wrap(async (req, res) => {
    await requireManage(req, 'read')
    const db = req.adminDb!
    const [settings, credentials, prompts, policies] = await Promise.all([
      db.from('ai_settings').select('enabled,notice_version,default_model_id,updated_at').eq('id', true).maybeSingle().then(check),
      db.from('ai_credentials').select(CREDENTIAL_FIELDS).eq('scope', 'site').order('created_at').then(check),
      db.from('ai_prompt_versions').select('id,prompt_key,version,body,source,is_active,created_by,created_at').eq('prompt_key', REPORT_SYSTEM_PROMPT_KEY).order('version', { ascending: false }).then(check),
      db.from('ai_quota_policies').select('id,scope,target_id,one_time_total,period,period_amount,updated_at').order('scope').then(check),
    ])
    const ids = (credentials.data ?? []).map((row) => row.id)
    const models = ids.length ? check(await db.from('ai_models').select(MODEL_FIELDS).in('credential_id', ids).order('display_name')).data ?? [] : []
    const userTargets = (policies.data ?? []).filter((policy) => policy.scope === 'user').map((policy) => policy.target_id as string)
    return res.json(envelope(req, {
      settings: settings.data,
      secret_storage_available: cipher !== null,
      deidentification_available: Boolean(presidio),
      credentials: (credentials.data ?? []).map((credential) => ({ ...credential, models: models.filter((model) => model.credential_id === credential.id) })),
      prompt: { key: REPORT_SYSTEM_PROMPT_KEY, default_body: DEFAULT_REPORT_SYSTEM_RULES, versions: prompts.data ?? [] },
      quota_policies: policies.data ?? [],
      user_names: await teacherNames(req, userTargets),
    }))
  }))

  router.put('/ai/admin/settings', wrap(async (req, res) => {
    const input = settingsInput.parse(req.body)
    await requireManage(req, 'update')
    const current = check(await req.adminDb!.from('ai_settings').select('notice_version').eq('id', true).maybeSingle()).data
    const update: Record<string, unknown> = { updated_by: req.user!.id }
    if (input.enabled !== undefined) update.enabled = input.enabled
    if (input.default_model_id !== undefined) update.default_model_id = input.default_model_id
    if (input.bump_notice_version) update.notice_version = (current?.notice_version ?? 1) + 1
    const saved = check(await req.adminDb!.from('ai_settings').update(update).eq('id', true).select('enabled,notice_version,default_model_id,updated_at').single())
    return res.json(envelope(req, saved.data))
  }))

  router.post('/ai/admin/credentials', wrap(async (req, res) => {
    const input = siteCredentialInput.parse(req.body)
    await requireManage(req, 'create', 'ai_credentials')
    const created = await createCredential(req.adminDb!, cipher, {
      scope: 'site', ownerUserId: null, provider: input.provider, authType: input.provider === 'ollama' && !input.secret ? 'none' : 'api_key',
      secret: input.secret, baseUrl: input.base_url ?? null, label: input.label, createdBy: req.user!.id,
    })
    return res.status(201).json(envelope(req, { ...created, models: [] }))
  }))

  async function siteCredential(req: Request, id: string) {
    const row = check(await req.adminDb!.from('ai_credentials').select('id,scope').eq('id', id).maybeSingle()).data
    if (!row || row.scope !== 'site') throw new ApiError(404, 'NOT_FOUND', 'Credential was not found')
  }

  router.patch('/ai/admin/credentials/:id', wrap(async (req, res) => {
    const id = idParam(req)
    const input = credentialPatchInput.parse(req.body)
    await requireManage(req, 'update', 'ai_credentials')
    await siteCredential(req, id)
    sharedModelCatalogCache.forget(id)
    return res.json(envelope(req, await updateCredential(req.adminDb!, cipher, id, input)))
  }))

  router.delete('/ai/admin/credentials/:id', wrap(async (req, res) => {
    const id = idParam(req)
    await requireManage(req, 'delete', 'ai_credentials')
    await siteCredential(req, id)
    check(await req.adminDb!.from('ai_credentials').delete().eq('id', id))
    sharedModelCatalogCache.forget(id)
    return res.json(envelope(req, { id, deleted: true }))
  }))

  /** Models this credential can use, from the provider's own list (cached an hour; ?refresh=1 to reload). */
  router.get('/ai/admin/credentials/:id/catalog', wrap(async (req, res) => {
    const id = idParam(req)
    await requireManage(req, 'read', 'ai_credentials')
    await siteCredential(req, id)
    const catalog = await sharedModelCatalogCache.get(id, req.query.refresh === '1', async () => {
      const credential = await loadUsableCredential(req.adminDb!, cipher, id)
      return fetchModelCatalog({ provider: credential.provider, authType: credential.authType, apiKey: credential.apiKey, baseUrl: credential.baseUrl })
    })
    return res.json(envelope(req, catalog))
  }))

  router.post('/ai/admin/credentials/:id/test', wrap(async (req, res) => {
    const id = idParam(req)
    const input = testInput.parse(req.body)
    await requireManage(req, 'test', 'ai_credentials')
    await siteCredential(req, id)
    return res.json(envelope(req, await testCredential(req.adminDb!, cipher, id, input.model_id)))
  }))

  router.post('/ai/admin/credentials/:id/models', wrap(async (req, res) => {
    const id = idParam(req)
    const input = modelInput.parse(req.body)
    await requireManage(req, 'create', 'ai_models')
    await siteCredential(req, id)
    const created = check(await req.adminDb!.from('ai_models').insert({ credential_id: id, ...input, supports_structured_output: sharedModelCatalogCache.structuredOutputSupport(id, input.model_id) }).select(MODEL_FIELDS).single())
    return res.status(201).json(envelope(req, created.data))
  }))

  router.patch('/ai/admin/models/:id', wrap(async (req, res) => {
    const id = idParam(req)
    const input = modelInput.partial().strict().parse(req.body)
    await requireManage(req, 'update', 'ai_models')
    const saved = check(await req.adminDb!.from('ai_models').update(input).eq('id', id).select(MODEL_FIELDS).maybeSingle())
    if (!saved.data) throw new ApiError(404, 'NOT_FOUND', 'Model was not found')
    return res.json(envelope(req, saved.data))
  }))

  router.delete('/ai/admin/models/:id', wrap(async (req, res) => {
    const id = idParam(req)
    await requireManage(req, 'delete', 'ai_models')
    check(await req.adminDb!.from('ai_models').delete().eq('id', id))
    return res.json(envelope(req, { id, deleted: true }))
  }))

  /** Save a new override version and make it the active one. */
  router.post('/ai/admin/prompts', wrap(async (req, res) => {
    const input = promptInput.parse(req.body)
    await requireManage(req, 'create', 'ai_prompt_versions')
    const db = req.adminDb!
    const latest = check(await db.from('ai_prompt_versions').select('version').eq('prompt_key', REPORT_SYSTEM_PROMPT_KEY).order('version', { ascending: false }).limit(1).maybeSingle()).data
    check(await db.from('ai_prompt_versions').update({ is_active: false }).eq('prompt_key', REPORT_SYSTEM_PROMPT_KEY).eq('is_active', true))
    const created = check(await db.from('ai_prompt_versions').insert({
      prompt_key: REPORT_SYSTEM_PROMPT_KEY, version: (latest?.version ?? 0) + 1, body: input.body, source: 'override', is_active: true, created_by: req.user!.id,
    }).select('id,prompt_key,version,body,source,is_active,created_by,created_at').single())
    return res.status(201).json(envelope(req, created.data))
  }))

  router.post('/ai/admin/prompts/:id/activate', wrap(async (req, res) => {
    const id = idParam(req)
    await requireManage(req, 'update', 'ai_prompt_versions')
    const db = req.adminDb!
    check(await db.from('ai_prompt_versions').update({ is_active: false }).eq('prompt_key', REPORT_SYSTEM_PROMPT_KEY).eq('is_active', true))
    const saved = check(await db.from('ai_prompt_versions').update({ is_active: true }).eq('id', id).eq('prompt_key', REPORT_SYSTEM_PROMPT_KEY).select('id,version,is_active').maybeSingle())
    if (!saved.data) throw new ApiError(404, 'NOT_FOUND', 'Prompt version was not found')
    return res.json(envelope(req, saved.data))
  }))

  /** Go back to the built-in rules (every override stays in history). */
  router.post('/ai/admin/prompts/reset', wrap(async (req, res) => {
    await requireManage(req, 'update', 'ai_prompt_versions')
    check(await req.adminDb!.from('ai_prompt_versions').update({ is_active: false }).eq('prompt_key', REPORT_SYSTEM_PROMPT_KEY).eq('is_active', true))
    return res.json(envelope(req, { active: 'code' }))
  }))

  router.put('/ai/admin/quota/policies', wrap(async (req, res) => {
    const input = policyInput.parse(req.body)
    await requireManage(req, 'update', 'ai_quota_policies')
    const db = req.adminDb!
    const row = {
      scope: input.scope,
      target_id: input.scope === 'default' ? null : input.target_id,
      one_time_total: input.one_time_total ?? null,
      period: input.period,
      period_amount: input.period === 'none' ? null : input.period_amount,
      created_by: req.user!.id,
    }
    const existingQuery = db.from('ai_quota_policies').select('id').eq('scope', row.scope)
    const existing = check(await (row.target_id ? existingQuery.eq('target_id', row.target_id) : existingQuery.is('target_id', null)).maybeSingle()).data
    const saved = existing
      ? check(await db.from('ai_quota_policies').update(row).eq('id', existing.id).select('id,scope,target_id,one_time_total,period,period_amount,updated_at').single())
      : check(await db.from('ai_quota_policies').insert(row).select('id,scope,target_id,one_time_total,period,period_amount,updated_at').single())
    return res.json(envelope(req, saved.data))
  }))

  router.delete('/ai/admin/quota/policies/:id', wrap(async (req, res) => {
    const id = idParam(req)
    await requireManage(req, 'delete', 'ai_quota_policies')
    check(await req.adminDb!.from('ai_quota_policies').delete().eq('id', id))
    return res.json(envelope(req, { id, deleted: true }))
  }))

  router.post('/ai/admin/quota/ledger', wrap(async (req, res) => {
    const input = ledgerInput.parse(req.body)
    await requireManage(req, 'create', 'ai_quota_ledger')
    if (input.kind === 'grant' && !input.delta) throw new ApiError(400, 'INVALID_GRANT', 'A grant needs a positive amount')
    check(await req.adminDb!.from('ai_quota_ledger').insert({
      user_id: input.user_id, kind: input.kind, delta: input.kind === 'grant' ? input.delta : 0, note: input.note ?? null, created_by: req.user!.id,
    }))
    return res.status(201).json(envelope(req, { user_id: input.user_id, kind: input.kind }))
  }))

  router.get('/ai/admin/quota/users/:userId', wrap(async (req, res) => {
    const userId = idParam(req, 'userId')
    await requireManage(req, 'read', 'ai_quota_ledger')
    const { policies, roleIds, ledger } = await new SupabaseReportAssistRepository(req.db!, req.adminDb!).loadQuotaInputs(userId)
    return res.json(envelope(req, computeQuotaBalance(pickEffectivePolicy(policies, userId, roleIds), ledger, new Date())))
  }))

  router.get('/ai/admin/usage', wrap(async (req, res) => {
    const query = usageQuery.parse(req.query)
    await requireLogsView(req)
    const db = req.adminDb!
    const generations = check(await db.from('ai_generations')
      .select('id,user_id,provider,model_id,credential_scope,status,tokens_in,tokens_out,est_cost,quota_charged')
      .gte('created_at', `${query.from}T00:00:00Z`).lt('created_at', `${query.to}T23:59:59.999Z`)
      .limit(USAGE_ROW_LIMIT)).data as UsageGenerationRow[] | null ?? []
    const ids = generations.map((row) => row.id)
    const adoptions: UsageAdoptionRow[] = []
    for (let i = 0; i < ids.length; i += 500) {
      adoptions.push(...((check(await db.from('ai_adoptions').select('generation_id,final_similarity').in('generation_id', ids.slice(i, i + 500))).data ?? []) as UsageAdoptionRow[]))
    }
    const report = aggregateUsage(generations, adoptions)
    return res.json(envelope(req, { ...report, user_names: await teacherNames(req, report.byUser.map((bucket) => bucket.key)) }, { truncated: generations.length >= USAGE_ROW_LIMIT }))
  }))

  router.get('/ai/admin/generations', wrap(async (req, res) => {
    const query = logQuery.parse(req.query)
    await requireLogsView(req)
    let select = req.adminDb!.from('ai_generations')
      .select('id,created_at,user_id,occurrence_report_id,credential_scope,provider,model_id,prompt_versions,options,status,error_code,tokens_in,tokens_out,est_cost,quota_charged,latency_ms,sanitized_input,sanitized_output,system_prompt,error_detail', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(query.offset, query.offset + query.limit - 1)
    if (query.user_id) select = select.eq('user_id', query.user_id)
    if (query.status) select = select.eq('status', query.status)
    const result = check(await select)
    const rows = result.data ?? []
    const ids = rows.map((row) => row.id)
    const adoptionRows = ids.length ? check(await req.adminDb!.from('ai_adoptions').select('generation_id').in('generation_id', ids)).data ?? [] : []
    const adoptionCounts = new Map<string, number>()
    for (const row of adoptionRows) adoptionCounts.set(row.generation_id, (adoptionCounts.get(row.generation_id) ?? 0) + 1)
    return res.json(envelope(req, {
      // De-identified output only: logs never show restored names.
      rows: rows.map((row) => ({ ...row, adoption_count: adoptionCounts.get(row.id) ?? 0 })),
      user_names: await teacherNames(req, rows.map((row) => row.user_id as string)),
    }, { total: result.count ?? null, limit: query.limit, offset: query.offset }))
  }))

  return router
}
