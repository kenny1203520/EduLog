import type { LanguageModel } from 'ai'
import { ApiError } from '../../http/errors.js'
import type { SecretCipher } from '../credentials/secretCipher.js'
import { Deidentifier, DeidentificationResidualError } from '../deidentify/deidentifier.js'
import type { KnownEntity } from '../deidentify/knownEntities.js'
import { PlaceholderMap, type PlaceholderKind } from '../deidentify/placeholders.js'
import { DeidentificationUnavailableError } from '../deidentify/presidioClient.js'
import { createLanguageModel, type ModelTarget } from '../providers/providerRegistry.js'
import { computeQuotaBalance, pickEffectivePolicy, type QuotaBalance } from '../quota/quotaBalance.js'
import { normalizeDraft, REPORT_SECTION_KEYS, streamReportDraft, type DeepPartialDraft, type ReportDraft, type ReportDraftResult } from './reportDraft.js'
import {
  assessReportContext,
  buildReportPrompt,
  REPORT_SYSTEM_PROMPT_KEY,
  type BuiltPrompt,
  type ContextWarning,
  type ReportLength,
  type ReportTone,
} from './reportPrompt.js'
import type { ReportAssistRepository, ReportFacts, ResolvedModel } from './reportAssistRepository.js'

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

export interface ReportGenerationDeps {
  repository: ReportAssistRepository
  deidentifier: Deidentifier | null
  cipher: SecretCipher | null
  createModel?: (target: ModelTarget) => LanguageModel
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
    const [entities, template, promptOverride] = await Promise.all([
      this.deps.repository.loadKnownEntities(facts, userId),
      options.templateId ? this.deps.repository.loadTemplate(options.templateId, userId) : Promise.resolve(null),
      this.deps.repository.getActivePromptOverride(REPORT_SYSTEM_PROMPT_KEY),
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
      result = await this.deps.deidentifier.deidentify(fields, entities)
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

    let apiKey: string | undefined
    if (resolved.authType !== 'none') {
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
    })
    return { request, context, resolved, model, quotaCost, quota }
  }

  /** Call the model, log the generation (any outcome) and charge quota on success only. */
  async run(
    prepared: PreparedGeneration,
    hooks: { signal?: AbortSignal, onPartial?: (draft: DeepPartialDraft) => void } = {},
  ): Promise<GenerationOutcome> {
    const { request, context, resolved } = prepared
    const startedAt = this.now().getTime()
    const signal = AbortSignal.any([
      ...(hooks.signal ? [hooks.signal] : []),
      AbortSignal.timeout(this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ])
    const base = {
      occurrence_report_id: request.reportId,
      user_id: request.userId,
      credential_id: resolved.credentialId,
      credential_scope: resolved.credentialScope,
      provider: resolved.provider,
      model_id: resolved.modelId,
      prompt_versions: { report: context.prompt.version },
      options: {
        tone: request.options.tone,
        length: request.options.length,
        template_id: request.options.templateId ?? null,
        extra_instructions: context.sanitizedFields.extraInstructions || null,
        focus: context.sanitizedFields.focus || null,
      },
      sanitized_input: {
        fields: context.sanitizedFields,
        prompt: context.prompt.prompt,
        known_refs: context.map.knownRefs(),
        replacement_counts: context.counts,
        warnings: context.warnings.map((warning) => warning.code),
      },
      session_seq: request.sessionSeq,
    }

    let result: ReportDraftResult
    try {
      result = await streamReportDraft({ model: prepared.model, prompt: context.prompt, map: context.map, signal, onPartial: hooks.onPartial })
    } catch (error) {
      const cancelled = hooks.signal?.aborted === true
      await this.deps.repository.insertGeneration({
        ...base,
        sanitized_output: null,
        status: cancelled ? 'cancelled' : 'failed',
        error_code: cancelled ? 'CANCELLED' : signal.aborted ? 'TIMEOUT' : errorCode(error),
        tokens_in: null,
        tokens_out: null,
        est_cost: null,
        quota_charged: 0,
        latency_ms: this.now().getTime() - startedAt,
      })
      if (cancelled) throw new ApiError(499, 'AI_GENERATION_CANCELLED', 'Generation was cancelled')
      if (signal.aborted) throw new ApiError(504, 'AI_GENERATION_TIMEOUT', 'The model took too long to respond')
      throw new ApiError(502, 'AI_PROVIDER_ERROR', 'The AI provider returned an error')
    }

    const tokensIn = result.usage.inputTokens ?? null
    const tokensOut = result.usage.outputTokens ?? null
    const generationId = await this.deps.repository.insertGeneration({
      ...base,
      sanitized_output: result.sanitized,
      status: 'succeeded',
      error_code: null,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      est_cost: estimateCost(resolved, tokensIn, tokensOut),
      quota_charged: prepared.quotaCost,
      latency_ms: this.now().getTime() - startedAt,
    })
    if (prepared.quotaCost > 0) await this.deps.repository.chargeQuota(request.userId, generationId, prepared.quotaCost)

    return {
      generationId,
      draft: result.restored,
      unresolved: result.unresolved,
      warnings: context.warnings,
      quotaCharged: prepared.quotaCost,
      quotaRemaining: prepared.quota ? Math.max(0, prepared.quota.remaining - prepared.quotaCost) : null,
    }
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
  if (model.priceInputPerMtok == null && model.priceOutputPerMtok == null) return null
  if (tokensIn == null && tokensOut == null) return null
  const cost = ((tokensIn ?? 0) * (model.priceInputPerMtok ?? 0) + (tokensOut ?? 0) * (model.priceOutputPerMtok ?? 0)) / 1_000_000
  return Math.round(cost * 1e6) / 1e6
}

function errorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error'
  return name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 120) || 'PROVIDER_ERROR'
}
