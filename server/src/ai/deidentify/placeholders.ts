/**
 * Reversible placeholder tokens for de-identified LLM prompts.
 *
 * The map lives only in memory for one generation request. It is never
 * persisted or sent to a model; logs keep the sanitized text only.
 */

/** Token labels, in the language the prompt is written in. */
export const PLACEHOLDER_LABELS = {
  student: '學生',
  teacher: '老師',
  school: '學校',
  person: '人名',
  phone: '電話',
  email: '信箱',
  nationalId: '身分證',
  location: '地點',
  organization: '機構',
  sensitive: '敏感',
} as const

export type PlaceholderKind = keyof typeof PLACEHOLDER_LABELS

const LABEL_ALTERNATION = Object.values(PLACEHOLDER_LABELS).join('|')
// Models sometimes reformat tokens (`[學生 A]`, `［學生A］`), so restoration is
// tolerant of inner whitespace and full-width brackets.
const TOKEN_PATTERN = new RegExp(`[\\[［]\\s*(${LABEL_ALTERNATION})\\s*([A-Z]{1,2})\\s*[\\]］]`, 'g')
const UNRESOLVED_PATTERN = new RegExp(`[\\[［]\\s*(?:${LABEL_ALTERNATION})[^\\]］]{0,6}[\\]］]`, 'g')
// Longest possible token is `［身分證 ZZ ］`-ish; hold back a trailing open bracket within this window.
const MAX_TOKEN_LENGTH = 12

/** Spreadsheet-style suffix: 0 → A, 25 → Z, 26 → AA. */
export function placeholderSuffix(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index)
  return placeholderSuffix(Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26))
}

export interface RestoreResult {
  text: string
  /** Placeholder-looking fragments that matched no known token. */
  unresolved: string[]
}

export class PlaceholderMap {
  private readonly tokenByKey = new Map<string, string>()
  private readonly displayByToken = new Map<string, string>()
  private readonly keyByToken = new Map<string, string>()
  private readonly counters = new Map<PlaceholderKind, number>()

  /** Rebuild a restore-only map, e.g. from {@link knownRefs} and current names when showing a stored log. */
  static fromDisplays(displays: Record<string, string>): PlaceholderMap {
    const map = new PlaceholderMap()
    for (const [token, display] of Object.entries(displays)) map.displayByToken.set(token, display)
    return map
  }

  /**
   * Return the token for an entity, creating it on first use.
   *
   * @param key Stable identity: an entity id for known people, or the matched text otherwise.
   * @param display Text restored in place of the token.
   */
  assign(kind: PlaceholderKind, key: string, display: string): string {
    const mapKey = `${kind}\u0000${key}`
    const existing = this.tokenByKey.get(mapKey)
    if (existing) return existing
    const index = this.counters.get(kind) ?? 0
    this.counters.set(kind, index + 1)
    const token = `[${PLACEHOLDER_LABELS[kind]}${placeholderSuffix(index)}]`
    this.tokenByKey.set(mapKey, token)
    this.displayByToken.set(token, display)
    this.keyByToken.set(token, key)
    return token
  }

  /**
   * Token → key for entries whose key starts with `prefix` (known entities use
   * `known:<id>`). Ids are not personal data, so this may be logged and used
   * later to restore stored output by looking the names up again.
   */
  knownRefs(prefix = 'known:'): Record<string, string> {
    const refs: Record<string, string> = {}
    for (const [token, key] of this.keyByToken) if (key.startsWith(prefix)) refs[token] = key.slice(prefix.length)
    return refs
  }

  /**
   * A restore-only copy with some tokens shown differently: a string replaces
   * the display text, `null` leaves the token unrestored (e.g. contact details
   * that must not reach a parent-facing report).
   */
  withOverrides(overrides: Record<string, string | null>): PlaceholderMap {
    const map = PlaceholderMap.fromDisplays(Object.fromEntries(this.displayByToken))
    for (const [token, display] of Object.entries(overrides)) {
      if (display === null) map.displayByToken.delete(token)
      else map.displayByToken.set(token, display)
    }
    return map
  }

  get size(): number {
    return this.displayByToken.size
  }

  /** Tokens in creation order, for prompt instructions and tests. */
  tokens(): string[] {
    return [...this.displayByToken.keys()]
  }

  /** Replace every known token with its display text. */
  restore(text: string): RestoreResult {
    const restored = text.replace(TOKEN_PATTERN, (match, label: string, suffix: string) =>
      this.displayByToken.get(`[${label}${suffix}]`) ?? match)
    const unresolved = restored.match(UNRESOLVED_PATTERN) ?? []
    return { text: restored, unresolved: [...new Set(unresolved)] }
  }

  /**
   * Restore a cumulative streaming snapshot, holding back a trailing token
   * that may still be incomplete (e.g. `…表現很好，[學`).
   */
  restoreStreaming(text: string): string {
    return this.restore(trimIncompleteToken(text)).text
  }
}

/** Drop a trailing `[`/`［` fragment that could become a token once more text arrives. */
export function trimIncompleteToken(text: string): string {
  const open = Math.max(text.lastIndexOf('['), text.lastIndexOf('［'))
  if (open < 0) return text
  const tail = text.slice(open)
  if (/[\]］]/.test(tail) || tail.length > MAX_TOKEN_LENGTH) return text
  return text.slice(0, open)
}
