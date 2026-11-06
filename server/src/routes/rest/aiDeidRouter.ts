import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { AI_PERMISSIONS, requireAuthorizationRpcDecision } from '../../auth/authorization.js'
import { setAuditContext } from '../../http/context.js'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import {
  buildRuleRecognizers,
  DEID_RULE_FIELDS,
  deidRuleFromRow,
  RULE_PLACEHOLDER_KINDS,
  type DeidRule,
  type DeidRuleRow,
} from '../../ai/deidentify/customRules.js'
import { DeidentificationResidualError, Deidentifier } from '../../ai/deidentify/deidentifier.js'
import type { KnownEntity } from '../../ai/deidentify/knownEntities.js'
import {
  DeidentificationUnavailableError,
  PRESIDIO_LANGUAGES,
  PresidioRequestError,
  type TextAnalyzer,
} from '../../ai/deidentify/presidioClient.js'

/** What the routes need from Presidio; PresidioClient in production. */
export interface DeidAnalyzer extends TextAnalyzer {
  supportedLanguages(): Promise<string[]>
}

const uuid = z.string().uuid()
const language = z.enum(PRESIDIO_LANGUAGES)
const word = z.string().trim().min(1).max(100)

const ruleShape = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['deny_list', 'regex']),
  entries: z.array(word).max(500),
  pattern: z.string().min(1).max(1000).nullable(),
  placeholder_kind: z.enum(RULE_PLACEHOLDER_KINDS),
  languages: z.array(language).max(PRESIDIO_LANGUAGES.length),
  enabled: z.boolean(),
  score: z.number().gt(0).max(1),
}
const ruleFields = z.object({
  ...ruleShape,
  entries: ruleShape.entries.default([]),
  pattern: ruleShape.pattern.default(null),
  languages: ruleShape.languages.default([]),
  enabled: ruleShape.enabled.default(true),
  score: ruleShape.score.default(0.85),
}).strict()
type RuleFields = z.infer<typeof ruleFields>

/** Word lists carry entries and no pattern; regex rules the reverse. */
function checkRuleShape(rule: RuleFields, ctx: z.RefinementCtx) {
  if (rule.kind === 'deny_list' && rule.entries.length === 0) ctx.addIssue({ code: 'custom', path: ['entries'], message: 'Add at least one word' })
  if (rule.kind === 'deny_list' && rule.pattern !== null) ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'A word list has no pattern' })
  if (rule.kind === 'regex' && !rule.pattern) ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'A pattern is required' })
  if (rule.kind === 'regex' && rule.entries.length > 0) ctx.addIssue({ code: 'custom', path: ['entries'], message: 'A pattern rule has no word list' })
}
const ruleInput = ruleFields.superRefine(checkRuleShape)
const rulePatch = z.object(ruleShape).partial().strict()
const languagesInput = z.object({ languages: z.array(language).min(1).max(PRESIDIO_LANGUAGES.length) }).strict()
const allowListInput = z.object({ entries: z.array(word).max(500) }).strict()
const testInput = z.object({
  text: z.string().min(1).max(5000),
  /** Simulated known people, as the report would supply them. */
  names: z.array(z.object({ kind: z.enum(['student', 'teacher', 'school']), name: z.string().trim().min(1).max(50) }).strict()).max(20).default([]),
  /** Unsaved rules to use instead of the saved enabled ones. */
  rules: z.array(ruleInput).max(100).optional(),
  /** Unsaved exception words to use instead of the saved ones. */
  allow_list: z.array(word).max(500).optional(),
  languages: z.array(language).min(1).max(PRESIDIO_LANGUAGES.length).optional(),
}).strict()

/** Text a new rule is run against before it is saved, so Presidio compiles it. */
const RULE_SAMPLE_TEXT = '王小明今天在仁愛國小完成作品，家長電話 0912-345-678，信箱 parent@example.com。Kevin met Ms. Chen at Taipei.'
const ALLOW_LIST_RULE_NAME = 'Exceptions'

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}
function envelope(req: Request, data: unknown, meta: Record<string, unknown> = {}) { return { data, meta, request_id: req.requestId, trace_id: req.traceId } }
function idParam(req: Request): string {
  const value = req.params.id
  if (typeof value !== 'string' || !uuid.safeParse(value).success) throw new ApiError(400, 'INVALID_ID', 'id is invalid')
  return value
}
function check<T extends { error: { code?: string, message?: string } | null }>(result: T): T {
  if (result.error) throw mapDatabaseError(result.error)
  return result
}

async function requireManage(req: Request, action: string, resource = 'ai_deid_rules') {
  if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const permission = AI_PERMISSIONS.manage
  setAuditContext(req, { domain: 'system', resource, action, permission, scopeType: 'system' })
  await requireAuthorizationRpcDecision(
    req,
    req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: permission, p_classroom_id: null, p_class_session_id: null }),
    { permission, stage: 'ai_admin_permission', message: 'You do not have permission to manage AI settings', scopeType: 'system' },
  )
}

function ruleFromInput(input: RuleFields): DeidRule {
  return {
    name: input.name,
    kind: input.kind,
    entries: input.kind === 'deny_list' ? input.entries : [],
    pattern: input.kind === 'regex' ? input.pattern : null,
    placeholderKind: input.placeholder_kind,
    languages: input.languages,
    score: input.score,
  }
}

function unavailable(error: unknown): never {
  if (error instanceof DeidentificationUnavailableError) {
    throw new ApiError(503, 'AI_DEIDENTIFICATION_UNAVAILABLE', 'De-identification service is unavailable')
  }
  throw error
}

/**
 * De-identification administration (Settings → AI → De-identification),
 * under /api/ai/admin/deid: Presidio status and languages, custom rules,
 * exception words and a test bench. Rules apply to the next request; the
 * test bench never writes anything.
 */
export function createAiDeidRouter(analyzer: DeidAnalyzer | null) {
  const router = Router()

  function requireAnalyzer(): DeidAnalyzer {
    if (!analyzer) throw new ApiError(503, 'AI_DEIDENTIFICATION_UNAVAILABLE', 'De-identification is not configured')
    return analyzer
  }

  async function installedLanguages(): Promise<string[]> {
    return requireAnalyzer().supportedLanguages().catch(unavailable)
  }

  /** Run the rule through Presidio once so a pattern Presidio cannot compile is refused (422). */
  async function validateRule(rule: DeidRule) {
    const installed = await installedLanguages()
    const runIn = installed.find((code) => rule.languages.length === 0 || rule.languages.includes(code)) ?? installed[0]
    if (!runIn) throw new ApiError(503, 'AI_DEIDENTIFICATION_UNAVAILABLE', 'The analyzer has no language installed')
    try {
      await requireAnalyzer().analyze({
        text: [RULE_SAMPLE_TEXT, ...rule.entries].join('\n'),
        language: runIn,
        adHocRecognizers: buildRuleRecognizers([{ ...rule, languages: [] }], runIn),
        scoreThreshold: 0,
      })
    } catch (error) {
      if (error instanceof PresidioRequestError) {
        throw new ApiError(422, 'AI_DEID_RULE_INVALID', 'Presidio could not run this rule', { [rule.kind === 'regex' ? 'pattern' : 'entries']: [error.detail || error.message] })
      }
      unavailable(error)
    }
  }

  async function loadRules(req: Request) {
    return (check(await req.adminDb!.from('ai_deid_rules').select(DEID_RULE_FIELDS).order('created_at')).data ?? []) as Array<DeidRuleRow & { id: string, enabled: boolean }>
  }

  router.get('/ai/admin/deid', wrap(async (req, res) => {
    await requireManage(req, 'read')
    const [settings, rules] = await Promise.all([
      req.adminDb!.from('ai_settings').select('deid_languages').eq('id', true).maybeSingle().then(check),
      loadRules(req),
    ])
    let connection: 'not_configured' | 'ok' | 'unreachable' = 'not_configured'
    let installed: string[] = []
    if (analyzer) {
      try {
        installed = await analyzer.supportedLanguages()
        connection = 'ok'
      } catch (error) {
        if (!(error instanceof DeidentificationUnavailableError)) throw error
        connection = 'unreachable'
      }
    }
    return res.json(envelope(req, {
      connection,
      installed_languages: installed,
      available_languages: PRESIDIO_LANGUAGES,
      enabled_languages: settings.data?.deid_languages ?? ['zh'],
      rules: rules.filter((rule) => rule.kind !== 'allow_list'),
      allow_list: [...new Set(rules.filter((rule) => rule.kind === 'allow_list').flatMap((rule) => rule.entries ?? []))],
    }))
  }))

  router.put('/ai/admin/deid/languages', wrap(async (req, res) => {
    const input = languagesInput.parse(req.body)
    await requireManage(req, 'update', 'ai_settings')
    const installed = await installedLanguages()
    const missing = input.languages.filter((code) => !installed.includes(code))
    if (missing.length) {
      throw new ApiError(422, 'AI_DEID_LANGUAGE_NOT_INSTALLED', 'Some languages are not installed in the analyzer', { languages: missing.map((code) => `${code} is not installed`) })
    }
    const saved = check(await req.adminDb!.from('ai_settings')
      .update({ deid_languages: [...new Set(input.languages)], updated_by: req.user!.id })
      .eq('id', true).select('deid_languages').single())
    return res.json(envelope(req, { enabled_languages: saved.data?.deid_languages ?? [] }))
  }))

  router.post('/ai/admin/deid/rules', wrap(async (req, res) => {
    const input = ruleInput.parse(req.body)
    await requireManage(req, 'create')
    const rule = ruleFromInput(input)
    await validateRule(rule)
    const created = check(await req.adminDb!.from('ai_deid_rules').insert({
      name: rule.name, kind: rule.kind, entries: rule.entries, pattern: rule.pattern, placeholder_kind: rule.placeholderKind,
      languages: rule.languages, enabled: input.enabled, score: rule.score, created_by: req.user!.id,
    }).select(DEID_RULE_FIELDS).single())
    return res.status(201).json(envelope(req, created.data))
  }))

  router.patch('/ai/admin/deid/rules/:id', wrap(async (req, res) => {
    const id = idParam(req)
    const patch = rulePatch.parse(req.body)
    await requireManage(req, 'update')
    const current = check(await req.adminDb!.from('ai_deid_rules').select(DEID_RULE_FIELDS).eq('id', id).maybeSingle()).data as (DeidRuleRow & { enabled: boolean }) | null
    if (!current || current.kind === 'allow_list') throw new ApiError(404, 'NOT_FOUND', 'Rule was not found')
    const merged = ruleInput.parse({
      name: current.name, kind: current.kind, entries: current.entries ?? [], pattern: current.pattern,
      placeholder_kind: current.placeholder_kind, languages: current.languages ?? [], enabled: current.enabled, score: Number(current.score),
      // Switching kind drops the other kind's fields.
      ...(patch.kind && patch.kind !== current.kind ? { entries: [], pattern: null } : {}),
      ...patch,
    })
    const rule = ruleFromInput(merged)
    // Toggling or renaming must work even while Presidio is down.
    if (patch.kind !== undefined || patch.entries !== undefined || patch.pattern !== undefined) await validateRule(rule)
    const saved = check(await req.adminDb!.from('ai_deid_rules').update({
      name: rule.name, kind: rule.kind, entries: rule.entries, pattern: rule.pattern, placeholder_kind: rule.placeholderKind,
      languages: rule.languages, enabled: merged.enabled, score: rule.score,
    }).eq('id', id).select(DEID_RULE_FIELDS).single())
    return res.json(envelope(req, saved.data))
  }))

  router.delete('/ai/admin/deid/rules/:id', wrap(async (req, res) => {
    const id = idParam(req)
    await requireManage(req, 'delete')
    check(await req.adminDb!.from('ai_deid_rules').delete().eq('id', id).neq('kind', 'allow_list'))
    return res.json(envelope(req, { id, deleted: true }))
  }))

  /** Replace every exception word; they are kept as one allow_list rule. */
  router.put('/ai/admin/deid/allow-list', wrap(async (req, res) => {
    const input = allowListInput.parse(req.body)
    await requireManage(req, 'update')
    const entries = [...new Set(input.entries)]
    check(await req.adminDb!.from('ai_deid_rules').delete().eq('kind', 'allow_list'))
    if (entries.length) {
      check(await req.adminDb!.from('ai_deid_rules').insert({
        name: ALLOW_LIST_RULE_NAME, kind: 'allow_list', entries, pattern: null, placeholder_kind: null, languages: [], enabled: true, created_by: req.user!.id,
      }))
    }
    return res.json(envelope(req, { allow_list: entries }))
  }))

  /**
   * Show what de-identification does to a sample text with the saved (or
   * draft) rules. Reads settings only; nothing is logged or stored.
   */
  router.post('/ai/admin/deid/test', wrap(async (req, res) => {
    const input = testInput.parse(req.body)
    await requireManage(req, 'test')
    const deidentifier = new Deidentifier(requireAnalyzer())
    const [settings, savedRows] = await Promise.all([
      input.languages ? Promise.resolve(null) : req.adminDb!.from('ai_settings').select('deid_languages').eq('id', true).maybeSingle().then(check),
      input.rules && input.allow_list ? Promise.resolve([]) : loadRules(req),
    ])
    const enabledRows = savedRows.filter((row) => row.enabled)
    const rules: DeidRule[] = [
      ...(input.rules ? input.rules.filter((rule) => rule.enabled).map(ruleFromInput) : enabledRows.filter((row) => row.kind !== 'allow_list').map(deidRuleFromRow)),
      ...(input.allow_list
        ? (input.allow_list.length ? [{ name: ALLOW_LIST_RULE_NAME, kind: 'allow_list' as const, entries: input.allow_list, pattern: null, placeholderKind: null, languages: [], score: 1 }] : [])
        : enabledRows.filter((row) => row.kind === 'allow_list').map(deidRuleFromRow)),
    ]
    const languages: string[] = input.languages ?? settings?.data?.deid_languages ?? ['zh']
    const entities: KnownEntity[] = input.names.map((name, index) => ({ id: `test-${index}`, kind: name.kind, name: name.name }))

    let result
    try {
      result = await deidentifier.deidentify({ text: input.text }, entities, { languages, rules })
    } catch (error) {
      if (error instanceof DeidentificationResidualError) {
        throw new ApiError(422, 'AI_DEIDENTIFICATION_INCOMPLETE', 'A known name would remain after de-identification')
      }
      if (error instanceof PresidioRequestError) {
        throw new ApiError(422, 'AI_DEID_RULE_INVALID', 'Presidio could not run these rules', { rules: [error.detail || error.message] })
      }
      unavailable(error)
    }
    return res.json(envelope(req, {
      languages,
      sanitized: result.fields.text,
      spans: result.spans.text.map((span) => ({
        start: span.start,
        end: span.end,
        text: input.text.slice(span.start, span.end),
        kind: span.kind,
        token: span.token,
        source: span.source,
        entity_type: span.entityType,
        rule_name: span.ruleIndex !== undefined ? rules[span.ruleIndex]?.name ?? null : null,
        language: span.language,
      })),
      ignored_exceptions: result.ignoredExceptions,
    }))
  }))

  return router
}
