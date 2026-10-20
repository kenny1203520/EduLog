/**
 * People and places the system already knows about for a report: the
 * student, classmates in the same session, teachers and the school.
 *
 * These are matched exactly (Presidio ad-hoc `patterns`), which is the main
 * de-identification guarantee; NER only catches names missing from this list.
 */

export type KnownEntityKind = 'student' | 'teacher' | 'school'

export interface KnownEntity {
  /** Stable id (database id) so every alias maps to the same token. */
  id: string
  kind: KnownEntityKind
  /** Canonical name, used for alias derivation and as the default display text. */
  name: string
  /** Extra spellings such as nicknames. */
  aliases?: string[]
  /** Text restored in place of the token. Defaults to `name`. */
  display?: string
}

/** Shortest alias accepted; single characters would match ordinary words. */
export const MIN_ALIAS_LENGTH = 2

const CJK_NAME = /^[㐀-鿿]{2,4}$/

/**
 * Derive the spellings a teacher is likely to type for a person.
 *
 * Three-character Chinese names also match by given name (王小明 → 小明); four
 * characters are treated as a compound surname (歐陽娜娜 → 娜娜). Teachers
 * also match with the 老師 suffix so the whole phrase is replaced.
 */
export function deriveAliases(entity: KnownEntity): string[] {
  const name = entity.name.trim()
  const aliases = new Set<string>([name, ...(entity.aliases ?? []).map((alias) => alias.trim())])
  if (entity.kind !== 'school' && CJK_NAME.test(name) && name.length >= 3) {
    const surnameLength = name.length === 4 ? 2 : 1
    const given = name.slice(surnameLength)
    aliases.add(given)
    if (entity.kind === 'teacher') {
      aliases.add(`${name}老師`)
      aliases.add(`${given}老師`)
      aliases.add(`${name.slice(0, surnameLength)}老師`)
    }
  }
  return [...aliases].filter((alias) => alias.length >= MIN_ALIAS_LENGTH)
}

/** Presidio ad-hoc recognizer as accepted by `POST /analyze`. */
export interface AdHocRecognizer {
  name: string
  supported_language: string
  supported_entity: string
  patterns: Array<{ name: string, regex: string, score: number }>
}

/** Entity type Presidio reports for a known entity; parsed back by {@link parseKnownEntityType}. */
export function knownEntityType(index: number): string {
  return `EDULOG_KNOWN_${index}`
}

export function parseKnownEntityType(entityType: string): number | null {
  const match = /^EDULOG_KNOWN_(\d+)$/.exec(entityType)
  return match ? Number(match[1]) : null
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build one recognizer per entity. Patterns have no word boundaries:
 * Presidio's `deny_list` wraps terms in `\W` lookarounds, which never match a
 * name written directly next to other Chinese characters.
 */
export function buildKnownEntityRecognizers(entities: KnownEntity[], language = 'zh'): AdHocRecognizer[] {
  return entities.flatMap((entity, index) => {
    const aliases = deriveAliases(entity).sort((a, b) => b.length - a.length)
    if (aliases.length === 0) return []
    return [{
      name: `edulog_known_${index}`,
      supported_language: language,
      supported_entity: knownEntityType(index),
      patterns: [{ name: entity.kind, regex: aliases.map(escapeRegex).join('|'), score: 1 }],
    }]
  })
}
