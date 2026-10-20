import {
  buildKnownEntityRecognizers,
  deriveAliases,
  parseKnownEntityType,
  type KnownEntity,
} from './knownEntities.js'
import { buildRuleRecognizers, exceptionWords, parseRuleEntityType, type DeidRule } from './customRules.js'
import { PlaceholderMap, type PlaceholderKind } from './placeholders.js'
import type { PresidioSpan, TextAnalyzer } from './presidioClient.js'

/** Presidio entity types replaced besides known entities; others (e.g. DATE_TIME) are kept. */
const DETECTED_KIND: Record<string, PlaceholderKind> = {
  PERSON: 'person',
  PHONE_NUMBER: 'phone',
  EMAIL_ADDRESS: 'email',
  TW_NATIONAL_ID: 'nationalId',
  LOCATION: 'location',
  ORGANIZATION: 'organization',
}

/** A known name survived de-identification; sending must be refused. */
export class DeidentificationResidualError extends Error {
  constructor(readonly fields: string[]) {
    super(`Known identifiers remain in: ${fields.join(', ')}`)
    this.name = 'DeidentificationResidualError'
  }
}

export interface DeidentifyOptions {
  /** Presidio languages to analyze with, each in its own pass. Defaults to `['zh']`. */
  languages?: string[]
  /** Administrator rules; see customRules. */
  rules?: DeidRule[]
  scoreThreshold?: number
}

/** Where a replacement came from, for the admin test bench. */
export type SpanSource = 'known' | 'rule' | 'ner'

export interface AppliedSpan {
  start: number
  end: number
  kind: PlaceholderKind
  token: string
  source: SpanSource
  /** Presidio entity type, e.g. PERSON or EDULOG_RULE_0. */
  entityType: string
  /** Index into `options.rules` for rule matches. */
  ruleIndex?: number
  /** Language pass that found it. */
  language: string
}

export interface DeidentifyResult<K extends string> {
  /** Same keys as the input, with identifiers replaced by tokens. */
  fields: Record<K, string>
  /** In-memory only; used to restore the model output. */
  map: PlaceholderMap
  /** Count of replacements per placeholder kind, safe to log. */
  counts: Partial<Record<PlaceholderKind, number>>
  /** Replacements per field, in text order. In-memory only. */
  spans: Record<K, AppliedSpan[]>
  /** Exception words dropped because they contain a known name. */
  ignoredExceptions: string[]
}

const PRIORITY: Record<SpanSource, number> = { known: 2, rule: 1, ner: 0 }

/**
 * De-identify a set of text fields before they leave the server.
 *
 * Every enabled language is analyzed separately and the spans merged. Known
 * entities win over rule matches, rule matches over NER detections, then
 * longer spans over shorter. Fails closed: if any known alias is still
 * present afterwards, it throws instead of returning text that would leak a
 * name. Exception words never reach known names (see exceptionWords).
 */
export class Deidentifier {
  constructor(private readonly analyzer: TextAnalyzer) {}

  async deidentify<K extends string>(
    fields: Record<K, string>,
    entities: KnownEntity[],
    options: DeidentifyOptions = {},
  ): Promise<DeidentifyResult<K>> {
    const languages = options.languages?.length ? [...new Set(options.languages)] : ['zh']
    const rules = options.rules ?? []
    const passes = languages.map((language) => {
      const exceptions = exceptionWords(rules, entities, language)
      return {
        language,
        recognizers: [...buildKnownEntityRecognizers(entities, language), ...buildRuleRecognizers(rules, language)],
        allowList: exceptions.words,
        ignored: exceptions.ignored,
      }
    })
    const map = new PlaceholderMap()
    // Assign known entities first so the report's student is always [學生A].
    entities.forEach((entity) => map.assign(entity.kind, `known:${entity.id}`, entity.display ?? entity.name))

    const counts: Partial<Record<PlaceholderKind, number>> = {}
    const out = {} as Record<K, string>
    const spansByField = {} as Record<K, AppliedSpan[]>
    for (const key of Object.keys(fields) as K[]) {
      const text = fields[key] ?? ''
      const found = await Promise.all(passes.map(async (pass) => (await this.analyzer.analyze({
        text,
        language: pass.language,
        adHocRecognizers: pass.recognizers,
        scoreThreshold: options.scoreThreshold ?? 0.3,
        allowList: pass.allowList,
      })).map((span) => ({ ...span, language: pass.language }))))
      const replacements = selectReplacements(text, found.flat(), entities, rules, map)
      for (const replacement of replacements) counts[replacement.kind] = (counts[replacement.kind] ?? 0) + 1
      out[key] = applyReplacements(text, replacements)
      spansByField[key] = replacements
    }

    const leaking = findResidualFields(out, entities)
    if (leaking.length > 0) throw new DeidentificationResidualError(leaking)
    return { fields: out, map, counts, spans: spansByField, ignoredExceptions: [...new Set(passes.flatMap((pass) => pass.ignored))] }
  }
}

type Candidate = Omit<AppliedSpan, 'token'> & { key: string, display: string }

function selectReplacements(
  text: string,
  spans: Array<PresidioSpan & { language: string }>,
  entities: KnownEntity[],
  rules: DeidRule[],
  map: PlaceholderMap,
): AppliedSpan[] {
  const candidates = spans.flatMap((span): Candidate[] => {
    if (span.end <= span.start) return []
    const base = { start: span.start, end: span.end, entityType: span.entity_type, language: span.language }
    const knownIndex = parseKnownEntityType(span.entity_type)
    if (knownIndex !== null) {
      const entity = entities[knownIndex]
      if (!entity) return []
      return [{ ...base, kind: entity.kind, source: 'known', key: `known:${entity.id}`, display: entity.display ?? entity.name }]
    }
    const original = text.slice(span.start, span.end)
    const ruleIndex = parseRuleEntityType(span.entity_type)
    if (ruleIndex !== null) {
      const kind = rules[ruleIndex]?.placeholderKind
      if (!kind) return []
      return [{ ...base, kind, source: 'rule', ruleIndex, key: original, display: original }]
    }
    const kind = DETECTED_KIND[span.entity_type]
    if (!kind) return []
    return [{ ...base, kind, source: 'ner', key: original, display: original }]
  })

  candidates.sort((a, b) =>
    PRIORITY[b.source] - PRIORITY[a.source] || (b.end - b.start) - (a.end - a.start) || a.start - b.start)
  const chosen: Candidate[] = []
  for (const candidate of candidates) {
    if (chosen.some((other) => candidate.start < other.end && other.start < candidate.end)) continue
    chosen.push(candidate)
  }
  // Tokens are assigned only to kept spans, in text order, so letters have no gaps.
  return chosen.sort((a, b) => a.start - b.start).map(({ key, display, ...span }) => ({
    ...span,
    token: map.assign(span.kind, key, display),
  }))
}

function applyReplacements(text: string, replacements: AppliedSpan[]): string {
  let result = ''
  let cursor = 0
  for (const replacement of replacements) {
    result += text.slice(cursor, replacement.start) + replacement.token
    cursor = replacement.end
  }
  return result + text.slice(cursor)
}

function findResidualFields<K extends string>(fields: Record<K, string>, entities: KnownEntity[]): K[] {
  const aliases = entities.flatMap(deriveAliases)
  return (Object.keys(fields) as K[]).filter((key) => aliases.some((alias) => fields[key].includes(alias)))
}
