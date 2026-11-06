import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { AI_PERMISSIONS, requireAuthorizationRpcDecision } from '../../auth/authorization.js'
import type { AiServices } from '../../ai/aiServices.js'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { setAuditContext } from '../../http/context.js'
import { Deidentifier } from '../../ai/deidentify/deidentifier.js'
import { REPORT_LENGTHS, REPORT_TONES, assessReportContext } from '../../ai/report/reportPrompt.js'
import type { ReportAssistRepository } from '../../ai/report/reportAssistRepository.js'
import { GenerationRegistry, sharedGenerationRegistry } from '../../ai/report/generationRegistry.js'
import { adoptionSnapshot, ReportGenerationService, type GenerationHistoryEntry } from '../../ai/report/reportGenerationService.js'
import { SupabaseReportAssistRepository } from '../../ai/report/supabaseReportAssistRepository.js'
import { isChatGptPlanCredential } from '../../ai/credentials/chatgptPlanTokens.js'

const uuid = z.string().uuid()

const optionsSchema = z.object({
  tone: z.enum(REPORT_TONES),
  length: z.enum(REPORT_LENGTHS),
  extra_instructions: z.string().max(2000).optional(),
  focus: z.string().max(4000).optional(),
  template_id: uuid.optional(),
}).strict()

export const generationRequestSchema = z.object({
  model_row_id: uuid,
  options: optionsSchema,
  session_seq: z.number().int().min(1).max(1000).default(1),
}).strict()

export const previewRequestSchema = z.object({ options: optionsSchema }).strict()
export const suggestionStateSchema = z.object({ state: z.enum(['kept', 'dismissed']) }).strict()
export const adoptionSchema = z.object({
  section_key: z.enum(['today', 'performance', 'home', 'all']),
  action: z.enum(['insert', 'replace', 'copy', 'adopt_all']),
}).strict()
export const preferencesSchema = z.object({
  tone: z.enum(REPORT_TONES).optional(),
  length: z.enum(REPORT_LENGTHS).optional(),
  last_model_row_id: uuid.nullable().optional(),
}).strict()

export interface AiReportAssistDeps {
  repository: (req: Request) => ReportAssistRepository
  service: (repository: ReportAssistRepository, req: Request) => ReportGenerationService
  /** Running generations in this process; the same instance must be passed to the service. */
  registry: GenerationRegistry
}

/** Production wiring: Presidio and the secret cipher come from the app's AI services; either may be absent. */
export function defaultAiReportAssistDeps({ presidio, cipher, chatgptTokens: chatgpt }: Pick<AiServices, 'presidio' | 'cipher' | 'chatgptTokens'>): AiReportAssistDeps {
  const deidentifier = presidio ? new Deidentifier(presidio) : null
  return {
    repository: (req) => new SupabaseReportAssistRepository(req.db!, req.adminDb!),
    registry: sharedGenerationRegistry,
    service: (repository, req) => new ReportGenerationService({
      repository,
      deidentifier,
      cipher,
      registry: sharedGenerationRegistry,
      // "Sign in with ChatGPT" credentials store a refresh token; generation needs a fresh access token.
      resolveToken: async (model) => (chatgpt && isChatGptPlanCredential(model) ? chatgpt.getAccessToken(req.adminDb!, model.credentialId) : undefined),
    }),
  }
}

function historyJson(entry: GenerationHistoryEntry) {
  return {
    generation_id: entry.generationId,
    status: entry.status,
    created_at: entry.createdAt,
    completed_at: entry.completedAt,
    provider: entry.provider,
    model_id: entry.modelId,
    error_code: entry.errorCode,
    quota_charged: entry.quotaCharged,
    draft: entry.draft,
    unresolved_placeholders: entry.unresolved,
    suggestion_states: entry.suggestionStates,
    adoption_count: entry.adoptionCount,
    input: { system_prompt: entry.input.systemPrompt, prompt_version: entry.input.promptVersion, prompt: entry.input.prompt },
    error_detail: entry.errorDetail,
  }
}

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

function param(req: Request, name: string): string {
  const value = req.params[name]
  if (typeof value !== 'string' || !uuid.safeParse(value).success) throw new ApiError(400, 'INVALID_ID', `${name} is invalid`)
  return value
}

function envelope(req: Request, data: unknown) {
  return { data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
}

function requireUser(req: Request): string {
  if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  return req.user.id
}

/** The caller holds teaching.ai.generate in this report's teaching scope. */
async function authorizeReport(req: Request, reportId: string, action: string) {
  setAuditContext(req, { domain: 'teaching', resource: 'ai_generations', resourceId: reportId, action, permission: AI_PERMISSIONS.generate, scopeType: 'occurrence_report' })
  await requireAuthorizationRpcDecision(
    req,
    req.db!.rpc('can_access_report', { p_report_id: reportId, p_permission_key: AI_PERMISSIONS.generate }),
    { permission: AI_PERMISSIONS.generate, stage: 'ai_report_scope_permission', message: 'You do not have permission to use AI on this report', scopeId: reportId, scopeType: 'report' },
  )
}

function toOptions(input: z.infer<typeof optionsSchema>) {
  return { tone: input.tone, length: input.length, extraInstructions: input.extra_instructions, focus: input.focus, templateId: input.template_id }
}

/** Write an SSE event; a closed connection is ignored because the generation carries on regardless. */
function writeEvent(res: Response, event: string, data: unknown) {
  if (res.writableEnded || res.destroyed) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * AI report assistant endpoints (mounted under /api):
 *
 * - GET  /ai/report-assist/reports/:reportId             panel bootstrap
 * - POST /ai/report-assist/reports/:reportId/preview     de-identified preview, no model call
 * - GET  /ai/report-assist/reports/:reportId/generations the user's history on this report
 * - POST /ai/report-assist/reports/:reportId/generations Server-Sent Events: `start`, `partial`, then `done` or `error`
 * - POST /ai/report-assist/generations/:id/cancel        stop a running generation (closing the stream does not)
 * - POST /ai/report-assist/notice/acknowledge
 * - PUT  /ai/report-assist/preferences
 * - PUT  /ai/report-assist/generations/:id/suggestions/:index
 * - POST /ai/report-assist/generations/:id/adoptions
 */
export function createAiReportAssistRouter(deps: AiReportAssistDeps) {
  const router = Router()

  router.get('/ai/report-assist/reports/:reportId', wrap(async (req, res) => {
    const userId = requireUser(req)
    const reportId = param(req, 'reportId')
    await authorizeReport(req, reportId, 'read')
    const repository = deps.repository(req)
    const service = deps.service(repository, req)
    const [settings, sources, quota, facts, preferences] = await Promise.all([
      repository.getSettings(),
      repository.listModelSources(userId),
      service.quotaBalance(userId),
      repository.loadReportFacts(reportId),
      req.adminDb!.from('user_preferences').select('ai_settings').eq('user_id', userId).maybeSingle(),
    ])
    if (!facts) throw new ApiError(404, 'NOT_FOUND', 'Report was not found')
    if (preferences.error) throw mapDatabaseError(preferences.error)
    const entities = await repository.loadKnownEntities(facts, userId)
    const [keptSuggestions, history] = await Promise.all([
      service.keptSuggestions(facts, entities, userId),
      service.history(facts, entities, userId),
    ])
    // The panel reopens on the newest result, or follows a generation still running.
    const latest = history.find((entry) => entry.status === 'succeeded' || entry.status === 'running')
    const acknowledged = await repository.hasAcknowledgedNotice(userId, settings.noticeVersion)
    return res.json(envelope(req, {
      enabled: settings.enabled,
      notice: { version: settings.noticeVersion, acknowledged },
      default_model_row_id: settings.defaultModelId,
      sources: sources.map((source) => ({
        model_row_id: source.modelRowId,
        model_id: source.modelId,
        display_name: source.displayName,
        provider: source.provider,
        credential_scope: source.credentialScope,
        credential_label: source.credentialLabel,
        quota_weight: source.credentialScope === 'site' ? source.quotaWeight : 0,
        is_default: source.isDefault,
        compat_mode: source.supportsStructuredOutput === false,
      })),
      quota: { remaining: quota.remaining, periodic: quota.periodic, one_time: quota.oneTime },
      warnings: assessReportContext({ lessonTitle: facts.lessonTitle, classNotes: facts.classNotes, draft: facts.content, attendance: facts.attendance }).map((warning) => warning.code),
      kept_suggestions: keptSuggestions,
      latest: latest ? historyJson(latest) : null,
      has_draft: facts.content.trim().length > 0,
      preferences: preferences.data?.ai_settings ?? {},
    }))
  }))

  router.get('/ai/report-assist/reports/:reportId/generations', wrap(async (req, res) => {
    const userId = requireUser(req)
    const reportId = param(req, 'reportId')
    await authorizeReport(req, reportId, 'read_history')
    const repository = deps.repository(req)
    const facts = await repository.loadReportFacts(reportId)
    if (!facts) throw new ApiError(404, 'NOT_FOUND', 'Report was not found')
    const entities = await repository.loadKnownEntities(facts, userId)
    const history = await deps.service(repository, req).history(facts, entities, userId)
    return res.json(envelope(req, history.map(historyJson)))
  }))

  router.post('/ai/report-assist/reports/:reportId/preview', wrap(async (req, res) => {
    const userId = requireUser(req)
    const reportId = param(req, 'reportId')
    const input = previewRequestSchema.parse(req.body)
    await authorizeReport(req, reportId, 'preview')
    const service = deps.service(deps.repository(req), req)
    await service.assertAvailable(userId)
    const context = await service.prepareContext(reportId, userId, toOptions(input.options))
    return res.json(envelope(req, {
      fields: context.sanitizedFields,
      prompt: context.prompt.prompt,
      replacement_counts: context.counts,
      warnings: context.warnings.map((warning) => warning.code),
    }))
  }))

  router.post('/ai/report-assist/reports/:reportId/generations', wrap(async (req, res) => {
    const userId = requireUser(req)
    const reportId = param(req, 'reportId')
    const input = generationRequestSchema.parse(req.body)
    await authorizeReport(req, reportId, 'generate')
    const service = deps.service(deps.repository(req), req)
    // Every refusal (switch, notice, credential, quota, de-identification) is a normal JSON error before streaming.
    const prepared = await service.prepare({ reportId, userId, modelRowId: input.model_row_id, options: toOptions(input.options), sessionSeq: input.session_seq })

    // A dropped connection does not stop the model call: the result is saved
    // and the teacher finds it in the history. Only the cancel route stops it.
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    try {
      const outcome = await service.run(prepared, {
        onStarted: (generationId) => writeEvent(res, 'start', { generation_id: generationId, warnings: prepared.context.warnings.map((warning) => warning.code) }),
        onPartial: (draft) => writeEvent(res, 'partial', draft),
      })
      setAuditContext(req, { domain: 'teaching', resource: 'ai_generations', resourceId: outcome.generationId, action: 'generate', permission: AI_PERMISSIONS.generate })
      writeEvent(res, 'done', {
        generation_id: outcome.generationId,
        draft: outcome.draft,
        unresolved_placeholders: outcome.unresolved,
        quota_charged: outcome.quotaCharged,
        quota_remaining: outcome.quotaRemaining,
      })
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred')
      if (!(error instanceof ApiError)) req.log?.error({ err: error, event: 'ai_generation_failed' }, 'ai_generation_failed')
      else if (apiError.code !== 'AI_GENERATION_CANCELLED') {
        req.log?.warn({
          event: 'ai_generation_failed',
          code: apiError.code,
          provider: prepared.resolved.provider,
          model_id: prepared.resolved.modelId,
          reason: apiError.details?.reason,
        }, 'ai_generation_failed')
      }
      writeEvent(res, 'error', { code: apiError.code, message: apiError.message, reason: apiError.details?.reason ?? null, request_id: req.requestId })
    }
    if (!res.writableEnded && !res.destroyed) res.end()
  }))

  router.post('/ai/report-assist/generations/:id/cancel', wrap(async (req, res) => {
    const { userId, generation } = await ownGeneration(req, 'cancel')
    const cancelled = deps.registry.cancel(generation.id, userId)
    return res.json(envelope(req, { generation_id: generation.id, cancelled }))
  }))

  router.post('/ai/report-assist/notice/acknowledge', wrap(async (req, res) => {
    const userId = requireUser(req)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_notice_acknowledgements', action: 'acknowledge' })
    const repository = deps.repository(req)
    const settings = await repository.getSettings()
    await repository.acknowledgeNotice(userId, settings.noticeVersion)
    return res.json(envelope(req, { version: settings.noticeVersion, acknowledged: true }))
  }))

  router.put('/ai/report-assist/preferences', wrap(async (req, res) => {
    const userId = requireUser(req)
    const input = preferencesSchema.parse(req.body)
    setAuditContext(req, { domain: 'teaching', resource: 'user_preferences', action: 'update' })
    const current = await req.adminDb!.from('user_preferences').select('ai_settings').eq('user_id', userId).maybeSingle()
    if (current.error) throw mapDatabaseError(current.error)
    const merged = { ...(current.data?.ai_settings ?? {}), ...input }
    const saved = await req.adminDb!.from('user_preferences').upsert({ user_id: userId, ai_settings: merged }, { onConflict: 'user_id' })
    if (saved.error) throw mapDatabaseError(saved.error)
    return res.json(envelope(req, merged))
  }))

  /** Own generation only; also re-checks AI access to its report. */
  async function ownGeneration(req: Request, action: string) {
    const userId = requireUser(req)
    const generationId = param(req, 'id')
    const repository = deps.repository(req)
    const generation = await repository.getGeneration(generationId)
    if (!generation || generation.userId !== userId || !generation.occurrenceReportId) {
      throw new ApiError(404, 'NOT_FOUND', 'Generation was not found')
    }
    await authorizeReport(req, generation.occurrenceReportId, action)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_generations', resourceId: generationId, action })
    return { userId, generation, repository }
  }

  router.put('/ai/report-assist/generations/:id/suggestions/:index', wrap(async (req, res) => {
    const index = Number(req.params.index)
    const input = suggestionStateSchema.parse(req.body)
    const { userId, generation, repository } = await ownGeneration(req, 'update_suggestion')
    const suggestions = (generation.sanitizedOutput?.teachingSuggestions as unknown[] | undefined) ?? []
    if (!Number.isInteger(index) || index < 0 || index >= suggestions.length) throw new ApiError(400, 'INVALID_INDEX', 'Suggestion index is invalid')
    await repository.setSuggestionState(generation.id, index, input.state, userId)
    return res.json(envelope(req, { generation_id: generation.id, index, state: input.state }))
  }))

  router.post('/ai/report-assist/generations/:id/adoptions', wrap(async (req, res) => {
    const input = adoptionSchema.parse(req.body)
    const { userId, generation, repository } = await ownGeneration(req, 'adopt')
    const snapshot = adoptionSnapshot(generation.sanitizedOutput, input.section_key)
    if (snapshot === null) throw new ApiError(400, 'INVALID_SECTION', 'The generation has no such section')
    const id = await repository.insertAdoption({ generation_id: generation.id, section_key: input.section_key, action: input.action, sanitized_snapshot: snapshot, adopted_by: userId })
    return res.status(201).json(envelope(req, { id, generation_id: generation.id, section_key: input.section_key, action: input.action }))
  }))

  return router
}
