import {
  buildKnownEntityRecognizers,
  deriveAliases,
  parseKnownEntityType,
  type KnownEntity,
} from './knownEntities.js'
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
  language?: string
  scoreThreshold?: number
}

export interface DeidentifyResult<K extends string> {
  /** Same keys as the input, with identifiers replaced by tokens. */
  fields: Record<K, string>
  /** In-memory only; used to restore the model output. */
  map: PlaceholderMap
  /** Count of replacements per placeholder kind, safe to log. */
  counts: Partial<Record<PlaceholderKind, number>>
}

interface Replacement {
  start: number
  end: number
  token: string
  kind: PlaceholderKind
}

/**
 * De-identify a set of text fields before they leave the server.
 *
 * Known entities win over NER detections, then longer spans over shorter.
 * Fails closed: if any known alias is still present afterwards, it throws
 * instead of returning text that would leak a name.
 */
export class Deidentifier {
  constructor(private readonly analyzer: TextAnalyzer) {}

  async deidentify<K extends string>(
    fields: Record<K, string>,
    entities: KnownEntity[],
    options: DeidentifyOptions = {},
  ): Promise<DeidentifyResult<K>> {
    const language = options.language ?? 'zh'
    const recognizers = buildKnownEntityRecognizers(entities, language)
    const map = new PlaceholderMap()
    // Assign known entities first so the report's student is always [學生A].
    entities.forEach((entity) => map.assign(knownKind(entity), `known:${entity.id}`, entity.display ?? entity.name))

    const counts: Partial<Record<PlaceholderKind, number>> = {}
    const out = {} as Record<K, string>
    for (const key of Object.keys(fields) as K[]) {
      const text = fields[key] ?? ''
      const spans = await this.analyzer.analyze({
        text,
        language,
        adHocRecognizers: recognizers,
        scoreThreshold: options.scoreThreshold ?? 0.3,
      })
      const replacements = selectReplacements(text, spans, entities, map)
      for (const replacement of replacements) counts[replacement.kind] = (counts[replacement.kind] ?? 0) + 1
      out[key] = applyReplacements(text, replacements)
    }

    const leaking = findResidualFields(out, entities)
    if (leaking.length > 0) throw new DeidentificationResidualError(leaking)
    return { fields: out, map, counts }
  }
}

function knownKind(entity: KnownEntity): PlaceholderKind {
  return entity.kind
}

function selectReplacements(
  text: string,
  spans: PresidioSpan[],
  entities: KnownEntity[],
  map: PlaceholderMap,
): Replacement[] {
  const candidates = spans.flatMap((span): Array<Replacement & { priority: number }> => {
    const knownIndex = parseKnownEntityType(span.entity_type)
    if (knownIndex !== null) {
      const entity = entities[knownIndex]
      if (!entity) return []
      const token = map.assign(knownKind(entity), `known:${entity.id}`, entity.display ?? entity.name)
      return [{ start: span.start, end: span.end, token, kind: knownKind(entity), priority: 1 }]
    }
    const kind = DETECTED_KIND[span.entity_type]
    if (!kind) return []
    const original = text.slice(span.start, span.end)
    return [{ start: span.start, end: span.end, token: map.assign(kind, original, original), kind, priority: 0 }]
  })

  candidates.sort((a, b) =>
    b.priority - a.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start)
  const chosen: Replacement[] = []
  for (const candidate of candidates) {
    if (chosen.some((other) => candidate.start < other.end && other.start < candidate.end)) continue
    chosen.push(candidate)
  }
  return chosen.sort((a, b) => a.start - b.start)
}

function applyReplacements(text: string, replacements: Replacement[]): string {
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
