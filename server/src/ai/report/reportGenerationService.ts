import type { LanguageModel } from 'ai'
import { ApiError } from '../../http/errors.js'
import type { SecretCipher } from '../credentials/secretCipher.js'
import { Deidentifier, DeidentificationResidualError } from '../deidentify/deidentifier.js'
import type { KnownEntity } from '../deidentify/knownEntities.js'
import { PlaceholderMap, type PlaceholderKind } from '../deidentify/placeholders.js'
import { DeidentificationUnavailableError } from '../deidentify/presidioClient.js'
import type { GenerationRegistry } from './generationRegistry.js'
import { classifyProviderFailure, describeProviderError, providerErrorDetail } from '../providers/providerErrors.js'
import { createLanguageModel, type ModelTarget } from '../providers/providerRegistry.js'
import { computeQuotaBalance, pickEffectivePolicy, type QuotaBalance } from '../quota/quotaBalance.js'
import { InvalidDraftOutputError, normalizeDraft, REPORT_SECTION_KEYS, restoreDraft, streamReportDraft, type DeepPartialDraft, type OutputMode, type ReportDraft, type ReportDraftResult } from './reportDraft.js'
import {
  assessReportContext,
  buildReportPrompt,
  REPORT_SYSTEM_PROMPT_KEY,
  type BuiltPrompt,
  type ContextWarning,
  type ReportLength,
  type ReportTone,
} from './reportPrompt.js'
import { STALE_RUNNING_MS } from './generationRegistry.js'
import type { HistoryGeneration, ReportAssistRepository, ReportFacts, ResolvedModel } from './reportAssistRepository.js'

export interface ReportAssistOptions {
  tone: ReportTone
  length: ReportLength
  extraInstructions?: string
  focus?: string
  templateId?: string
}

export interface GenerateRequest {
  reportId: string
  userId: string
  modelRowId: string
  options: ReportAssistOptions
  /** Which version this is within the teacher's current panel session (1, 2, …). */
  sessionSeq: number
}

/** Everything checked and de-identified, ready to call the model. */
export interface PreparedContext {
  facts: ReportFacts
  entities: KnownEntity[]
  map: PlaceholderMap
  sanitizedFields: Record<string, string>
  counts: Partial<Record<PlaceholderKind, number>>
  warnings: ContextWarning[]
  prompt: BuiltPrompt
}

export interface PreparedGeneration {
  request: GenerateRequest
  context: PreparedContext
  resolved: ResolvedModel
  model: LanguageModel
  quotaCost: number
  quota: QuotaBalance | null
}

export interface GenerationOutcome {
  generationId: string
  draft: ReportDraft
  unresolved: string[]
  warnings: ContextWarning[]
  quotaCharged: number
  quotaRemaining: number | null
}

/** One generation in the panel's history, restored for the teacher. */
export interface GenerationHistoryEntry {
  generationId: string
  status: HistoryGeneration['status']
  createdAt: string
  completedAt: string | null
  provider: string
  modelId: string
  errorCode: string | null
  quotaCharged: number
  draft: ReportDraft | null
  /** Placeholders that cannot be restored (detected by NER, never stored with a name). */
  unresolved: string[]
  suggestionStates: Record<number, 'kept' | 'dismissed'>
  adoptionCount: number
  /** What was sent, already de-identified (the system prompt is missing on rows from before 1000154). */
  input: { systemPrompt: string | null, promptVersion: string | null, prompt: string | null }
  errorDetail: { status: number | null, message: string | null } | null
}

export const HISTORY_LIMIT = 30

export interface ReportGenerationDeps {
  repository: ReportAssistRepository
  deidentifier: Deidentifier | null
  cipher: SecretCipher | null
  createModel?: (target: ModelTarget) => LanguageModel
  /**
   * Bearer token for credentials that do not store a plain API key, such as
   * "Sign in with ChatGPT" (a fresh access token). Return undefined to fall
   * back to decrypting the stored secret.
   */
  resolveToken?: (model: ResolvedModel) => Promise<string | undefined>
  /** Running generations, so a teacher can cancel one from another request. */
  registry?: GenerationRegistry
  now?: () => Date
  timeoutMs?: number
  quotaTimeZone?: string
}

const DEFAULT_TIMEOUT_MS = 180_000

/** Associated data binding a ciphertext to its credential row (see secretCipher). */
export function credentialAssociatedData(credentialId: string): string {
  return `ai_credentials:${credentialId}`
}

/**
 * Orchestrates one AI report generation: permission-independent checks (the
 * router authorizes the report first), credential and quota checks,
 * de-identification, the model call, logging and quota charging.
 */
export class ReportGenerationService {
  private readonly createModel: (target: ModelTarget) => LanguageModel
  private readonly now: () => Date

  constructor(private readonly deps: ReportGenerationDeps) {
    this.createModel = deps.createModel ?? createLanguageModel
    this.now = deps.now ?? (() => new Date())
  }

  /** Fails unless the switch is on and the user acknowledged the current notice. */
  async assertAvailable(userId: string): Promise<void> {
    const settings = await this.deps.repository.getSettings()
    if (!settings.enabled) throw new ApiError(403, 'AI_DISABLED', 'The AI report assistant is turned off')
    if (!await this.deps.repository.hasAcknowledgedNotice(userId, settings.noticeVersion)) {
      throw new ApiError(428, 'AI_NOTICE_REQUIRED', 'Acknowledge the AI usage notice first')
    }
  }

  async quotaBalance(userId: string): Promise<QuotaBalance> {
    const { policies, roleIds, ledger } = await this.deps.repository.loadQuotaInputs(userId)
    return computeQuotaBalance(pickEffectivePolicy(policies, userId, roleIds), ledger, this.now(), this.deps.quotaTimeZone)
  }

  /** Load and de-identify the report context; used by both preview and generation. */
  async prepareContext(reportId: string, userId: string, options: ReportAssistOptions): Promise<PreparedContext> {
    if (!this.deps.deidentifier) throw new ApiError(503, 'AI_DEIDENTIFICATION_UNAVAILABLE', 'De-identification is not configured')
    const facts = await this.deps.repository.loadReportFacts(reportId)
    if (!facts) throw new ApiError(404, 'NOT_FOUND', 'Report was not found')
    const [entities, template, promptOverride, deidConfig] = await Promise.all([
      this.deps.repository.loadKnownEntities(facts, userId),
      options.templateId ? this.deps.repository.loadTemplate(options.templateId, userId) : Promise.resolve(null),
      this.deps.repository.getActivePromptOverride(REPORT_SYSTEM_PROMPT_KEY),
      this.deps.repository.loadDeidentificationConfig(),
    ])

    const fields: Record<string, string> = {
      classNotes: facts.classNotes,
      draft: facts.content,
      focus: options.focus ?? '',
      template: template ?? '',
      extraInstructions: options.extraInstructions ?? '',
      absenceReason: facts.absenceReason ?? '',
      courseName: facts.courseName,
      lessonTitle: facts.lessonTitle ?? '',
    }
    facts.previousReports.forEach((report, index) => { fields[`previous${index}`] = report.content })

    let result
    try {
      result = await this.deps.deidentifier.deidentify(fields, entities, deidConfig)
    } catch (error) {
      if (error instanceof DeidentificationUnavailableError) {
        throw new ApiError(503, 'AI_DEIDENTIFICATION_UNAVAILABLE', 'De-identification service is unavailable')
      }
      if (error instanceof DeidentificationResidualError) {
        throw new ApiError(422, 'AI_DEIDENTIFICATION_INCOMPLETE', 'Personal data could not be fully removed')
      }
      throw error
    }

    const sanitized = result.fields
    const [progressStart, progressEnd] = (facts.progressLetter ?? '').split('-')
    const promptContext = {
      studentToken: result.map.assign('student', `known:${facts.studentId}`, facts.studentName),
      courseName: sanitized.courseName,
      subject: facts.subject,
      stage: facts.stage,
      lessonTitle: sanitized.lessonTitle || null,
      progressStart: progressStart || null,
      progressEnd: progressEnd || progressStart || null,
      isCompleted: facts.isCompleted,
      attendance: facts.attendance,
      absenceReason: sanitized.absenceReason || null,
      participation: facts.participation,
      behavior: facts.behavior,
      classNotes: sanitized.classNotes,
      focus: sanitized.focus,
      draft: sanitized.draft,
      template: sanitized.template,
      previousReports: facts.previousReports.map((report, index) => ({
        date: report.date,
        content: sanitized[`previous${index}`] ?? '',
        participation: report.participation,
        behavior: report.behavior,
      })),
    }
    const prompt = buildReportPrompt(promptContext, {
      tone: options.tone,
      length: options.length,
      extraInstructions: sanitized.extraInstructions,
    }, promptOverride)
    const warnings = assessReportContext({ ...promptContext, lessonTitle: facts.lessonTitle })
    return { facts, entities, map: result.map, sanitizedFields: sanitized, counts: result.counts, warnings, prompt }
  }

  /** Resolve the model and credential, check quota and de-identify. Throws ApiError before anything streams. */
  async prepare(request: GenerateRequest): Promise<PreparedGeneration> {
    await this.assertAvailable(request.userId)
    const resolved = await this.deps.repository.resolveModel(request.modelRowId, request.userId)
    if (!resolved) throw new ApiError(404, 'AI_MODEL_NOT_FOUND', 'The selected model is not available')

    let apiKey = this.deps.resolveToken ? await this.deps.resolveToken(resolved) : undefined
    if (apiKey === undefined && resolved.authType !== 'none') {
      if (!this.deps.cipher) throw new ApiError(503, 'AI_SECRET_KEY_MISSING', 'AI credentials cannot be decrypted on this server')
      if (!resolved.secretCiphertext) throw new ApiError(409, 'AI_CREDENTIAL_INVALID', 'The selected credential has no secret')
      try {
        apiKey = this.deps.cipher.decrypt(resolved.secretCiphertext, credentialAssociatedData(resolved.credentialId))
      } catch {
        throw new ApiError(409, 'AI_CREDENTIAL_INVALID', 'The selected credential could not be decrypted')
      }
    }

    let quota: QuotaBalance | null = null
    const quotaCost = resolved.credentialScope === 'site' ? resolved.quotaWeight : 0
    if (resolved.credentialScope === 'site') {
      quota = await this.quotaBalance(request.userId)
      if (quota.remaining < quotaCost) {
        throw new ApiError(429, 'AI_QUOTA_EXHAUSTED', 'Your site AI quota is used up')
      }
    }

    const context = await this.prepareContext(request.reportId, request.userId, request.options)
    const model = this.createModel({
      provider: resolved.provider,
      modelId: resolved.modelId,
      apiKey,
      baseUrl: resolved.baseUrl ?? undefined,
      credentialScope: resolved.credentialScope,
    })
    return { request, context, resolved, model, quotaCost, quota }
  }

  /**
   * Call the model and log the generation: a `running` row first (so a
   * teacher who lost the connection can find it), then its outcome. Quota is
   * charged on success only. Only an explicit cancel (`hooks.signal` or the
   * registry) or the timeout stops the model call.
   */
  async run(
    prepared: PreparedGeneration,
    hooks: { signal?: AbortSignal, onStarted?: (generationId: string) => void, onPartial?: (draft: DeepPartialDraft) => void } = {},
  ): Promise<GenerationOutcome> {
    const { request, context, resolved } = prepared
    const startedAt = this.now().getTime()
    const options = {
      tone: request.options.tone,
      length: request.options.length,
      template_id: request.options.templateId ?? null,
      extra_instructions: context.sanitizedFields.extraInstructions || null,
      focus: context.sanitizedFields.focus || null,
    }
    const generationId = await this.deps.repository.startGeneration({
      occurrence_report_id: request.reportId,
      user_id: request.userId,
      credential_id: resolved.credentialId,
      credential_scope: resolved.credentialScope,
      provider: resolved.provider,
      model_id: resolved.modelId,
      prompt_versions: { report: context.prompt.version },
      system_prompt: context.prompt.system,
      options,
      sanitized_input: {
        fields: context.sanitizedFields,
        prompt: context.prompt.prompt,
        known_refs: context.map.knownRefs(),
        replacement_counts: context.counts,
        warnings: context.warnings.map((warning) => warning.code),
      },
      sanitized_output: null,
      status: 'running',
      error_code: null,
      tokens_in: null,
      tokens_out: null,
      est_cost: null,
      quota_charged: 0,
      latency_ms: null,
      session_seq: request.sessionSeq,
    })
    const cancel = this.deps.registry?.register(generationId, request.userId) ?? new AbortController()
    const cancelSignal = hooks.signal ? AbortSignal.any([hooks.signal, cancel.signal]) : cancel.signal
    const signal = AbortSignal.any([cancelSignal, AbortSignal.timeout(this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)])
    const latency = () => this.now().getTime() - startedAt

    try {
      hooks.onStarted?.(generationId)
      let result: ReportDraftResult
      let mode: OutputMode = resolved.supportsStructuredOutput === false ? 'json_text' : 'structured'
      let streamed = false
      const call = () => streamReportDraft({
        model: prepared.model,
        prompt: context.prompt,
        map: context.map,
        sectionMap: parentSectionMap(context),
        signal,
        mode,
        onPartial: (draft) => { streamed = true; hooks.onPartial?.(draft) },
      })
      try {
        try {
          result = await call()
        } catch (error) {
          // The model rejected JSON schema output before writing anything, or its
          // answer could not be read as a draft: ask for JSON in the prompt instead.
          const rejected = !streamed && classifyProviderFailure(providerErrorDetail(error)) === 'MODEL_UNSUPPORTED'
          if (mode === 'structured' && !signal.aborted && (rejected || error instanceof InvalidDraftOutputError)) {
            mode = 'json_text'
            await this.deps.repository.markStructuredOutputUnsupported(resolved.modelRowId).catch(() => {})
            result = await call()
          } else {
            throw error
          }
        }
      } catch (error) {
        const cancelled = cancelSignal.aborted
        const detail = cancelled || signal.aborted ? null : providerErrorDetail(error)
        const invalid = error instanceof InvalidDraftOutputError
        const failure = detail && !invalid ? classifyProviderFailure(detail) : null
        // A ChatGPT plan answers 429 once the plan allowance or this app's weekly cap is used up.
        const planLimit = failure === 'RATE_LIMITED' && resolved.provider === 'openai' && resolved.authType === 'oauth'
        await this.deps.repository.finishGeneration(generationId, {
          status: cancelled ? 'cancelled' : 'failed',
          error_code: cancelled ? 'CANCELLED' : signal.aborted ? 'TIMEOUT' : planLimit ? 'PLAN_LIMIT' : invalid ? 'INVALID_OUTPUT' : failure ?? errorCode(error),
          error_detail: detail,
          options: { ...options, output_mode: mode },
          latency_ms: latency(),
        })
        if (cancelled) throw new ApiError(499, 'AI_GENERATION_CANCELLED', 'Generation was cancelled')
        if (signal.aborted) throw new ApiError(504, 'AI_GENERATION_TIMEOUT', 'The model took too long to respond')
        const reason = detail ? { reason: describeProviderError(detail) } : undefined
        if (planLimit) throw new ApiError(429, 'AI_PLAN_LIMIT_REACHED', 'Your ChatGPT plan allowance for this app is used up', undefined, undefined, undefined, reason)
        if (invalid) throw new ApiError(502, 'AI_INVALID_OUTPUT', 'The model did not return a usable draft', undefined, undefined, undefined, { reason: (error as Error).message })
        if (failure === 'RATE_LIMITED') throw new ApiError(429, 'AI_RATE_LIMITED', 'The AI provider is rate limiting this model', undefined, undefined, undefined, reason)
        if (failure === 'MODEL_UNSUPPORTED') throw new ApiError(502, 'AI_MODEL_UNSUPPORTED', 'The model does not support this kind of request', undefined, undefined, undefined, reason)
        if (failure === 'DATA_POLICY') throw new ApiError(502, 'AI_DATA_POLICY', 'The provider account settings do not allow this model', undefined, undefined, undefined, reason)
        if (failure === 'AUTH_FAILED') throw new ApiError(409, 'AI_CREDENTIAL_INVALID', 'The provider rejected the credential', undefined, undefined, undefined, reason)
        throw new ApiError(502, 'AI_PROVIDER_ERROR', 'The AI provider returned an error', undefined, undefined, undefined, reason)
      }

      const tokensIn = result.usage.inputTokens ?? null
      const tokensOut = result.usage.outputTokens ?? null
      const usage = {
        options: { ...options, output_mode: mode },
        sanitized_output: result.sanitized,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        est_cost: estimateCost(resolved, tokensIn, tokensOut),
        latency_ms: latency(),
      }

      // A draft without any report section is not usable: log it as failed and charge nothing.
      if (result.sanitized.sections.length === 0) {
        await this.deps.repository.finishGeneration(generationId, { ...usage, status: 'failed', error_code: 'EMPTY_OUTPUT' })
        throw new ApiError(502, 'AI_EMPTY_OUTPUT', 'The model returned an empty draft')
      }

      await this.deps.repository.finishGeneration(generationId, { ...usage, status: 'succeeded', quota_charged: prepared.quotaCost })
      if (prepared.quotaCost > 0) await this.deps.repository.chargeQuota(request.userId, generationId, prepared.quotaCost)

      return {
        generationId,
        draft: result.restored,
        unresolved: result.unresolved,
        warnings: context.warnings,
        quotaCharged: prepared.quotaCost,
        quotaRemaining: prepared.quota ? Math.max(0, prepared.quota.remaining - prepared.quotaCost) : null,
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        // Logging or charging failed after the model call; never leave the row running.
        await this.deps.repository.finishGeneration(generationId, { status: 'failed', error_code: 'INTERNAL', latency_ms: latency() }).catch(() => {})
      }
      throw error
    } finally {
      this.deps.registry?.unregister(generationId)
    }
  }

  /**
   * The user's generations on this report, newest first, restored with
   * current names: classmates as 同學 in the parent-facing sections, full
   * names in the teaching suggestions. A row still running past the model
   * timeout was orphaned by a restart and is shown as interrupted.
   */
  async history(facts: ReportFacts, entities: KnownEntity[], userId: string): Promise<GenerationHistoryEntry[]> {
    const rows = await this.deps.repository.listReportHistory(facts.reportId, userId, HISTORY_LIMIT)
    const names = new Map(entities.map((entity) => [entity.id, entity.display ?? entity.name]))
    const staleBefore = this.now().getTime() - STALE_RUNNING_MS
    return rows.map((row) => {
      const interrupted = row.status === 'running' && Date.parse(row.createdAt) < staleBefore
      let draft: ReportDraft | null = null
      let unresolved: string[] = []
      if (row.sanitizedOutput && row.status === 'succeeded') {
        const map = restoreMapFor(row, names)
        const restored = restoreDraft(normalizeDraft(row.sanitizedOutput as ReportDraft), storedSectionMap(row, map, facts.studentId), map)
        draft = restored.restored
        unresolved = restored.unresolved
      }
      return {
        generationId: row.id,
        status: interrupted ? 'failed' : row.status,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        provider: row.provider,
        modelId: row.modelId,
        errorCode: interrupted ? 'INTERRUPTED' : row.errorCode,
        quotaCharged: row.quotaCharged,
        draft,
        unresolved,
        suggestionStates: row.suggestionStates,
        adoptionCount: row.adoptionCount,
        input: {
          systemPrompt: row.systemPrompt ?? null,
          promptVersion: row.promptVersion ?? null,
          prompt: typeof row.sanitizedInput.prompt === 'string' ? row.sanitizedInput.prompt : null,
        },
        errorDetail: row.errorDetail ?? null,
      }
    })
  }

  /**
   * Teaching suggestions the user kept on this student's earlier reports,
   * restored with current names (unknown placeholders stay as tokens).
   */
  async keptSuggestions(facts: ReportFacts, entities: KnownEntity[], userId: string, limit = 3) {
    const reportIds = facts.previousReports.map((report) => report.reportId)
    if (reportIds.length === 0) return []
    const generations = await this.deps.repository.listGenerationsForReports(reportIds, userId)
    const kept = await this.deps.repository.keptSuggestionIndexes(generations.map((generation) => generation.id))
    const names = new Map(entities.map((entity) => [entity.id, entity.display ?? entity.name]))
    const dateByReport = new Map(facts.previousReports.map((report) => [report.reportId, report.date]))
    return generations.flatMap((generation) => {
      const indexes = kept.get(generation.id) ?? []
      const suggestions = (generation.sanitizedOutput?.teachingSuggestions as unknown[] | undefined) ?? []
      if (indexes.length === 0) return []
      const map = restoreMapFor(generation, names)
      return [{
        generationId: generation.id,
        date: generation.occurrenceReportId ? dateByReport.get(generation.occurrenceReportId) ?? null : null,
        suggestions: indexes.map((index) => suggestions[index]).filter((text): text is string => typeof text === 'string').map((text) => map.restore(text).text),
      }]
    }).slice(0, limit)
  }
}

/** Tokens never restored into parent-facing text: contact details and ID numbers. */
const CONTACT_TOKEN = /^\[(電話|信箱|身分證)[A-Z]+\]$/

/**
 * Parents read the report sections, so other students appear as 同學 and
 * contact details stay as tokens for the teacher to edit; the internal
 * teaching suggestions keep the full restore map.
 */
export function parentSectionMap(context: Pick<PreparedContext, 'map' | 'facts'>): PlaceholderMap {
  const overrides: Record<string, string | null> = {}
  for (const [token, id] of Object.entries(context.map.knownRefs())) {
    if (token.startsWith('[學生') && id !== context.facts.studentId) overrides[token] = '同學'
  }
  for (const token of context.map.tokens()) if (CONTACT_TOKEN.test(token)) overrides[token] = null
  return context.map.withOverrides(overrides)
}

/** {@link parentSectionMap} for a stored generation: classmates' tokens become 同學. */
function storedSectionMap(generation: { sanitizedInput: Record<string, unknown> }, map: PlaceholderMap, studentId: string): PlaceholderMap {
  const refs = (generation.sanitizedInput.known_refs ?? {}) as Record<string, string>
  const overrides: Record<string, string> = {}
  for (const [token, id] of Object.entries(refs)) if (token.startsWith('[學生') && id !== studentId) overrides[token] = '同學'
  return map.withOverrides(overrides)
}

/** Rebuild a restore map for a stored generation from its known entity refs. */
export function restoreMapFor(generation: { sanitizedInput: Record<string, unknown> }, names: Map<string, string>): PlaceholderMap {
  const refs = (generation.sanitizedInput.known_refs ?? {}) as Record<string, string>
  const displays: Record<string, string> = {}
  for (const [token, id] of Object.entries(refs)) {
    const name = names.get(id)
    if (name) displays[token] = name
  }
  return PlaceholderMap.fromDisplays(displays)
}

/** Sanitized text the teacher adopted, taken from the stored output (never from the client). */
export function adoptionSnapshot(output: Record<string, unknown> | null, sectionKey: string): string | null {
  if (!output) return null
  const draft = normalizeDraft(output as ReportDraft)
  if (sectionKey === 'all') return draft.sections.map((section) => `${section.title}\n${section.body}`).join('\n\n') || null
  if (!(REPORT_SECTION_KEYS as readonly string[]).includes(sectionKey)) return null
  return draft.sections.find((section) => section.key === sectionKey)?.body ?? null
}

function estimateCost(model: ResolvedModel, tokensIn: number | null, tokensOut: number | null): number | null {
  // Both prices are needed; a missing one means the cost is unknown, never zero.
  if (model.priceInputPerMtok == null || model.priceOutputPerMtok == null) return null
  if (tokensIn == null && tokensOut == null) return null
  const cost = ((tokensIn ?? 0) * (model.priceInputPerMtok ?? 0) + (tokensOut ?? 0) * (model.priceOutputPerMtok ?? 0)) / 1_000_000
  return Math.round(cost * 1e6) / 1e6
}

function errorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error'
  return name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 120) || 'PROVIDER_ERROR'
}

export { providerStatus } from '../providers/providerErrors.js'
