/**
 * Administrator rules (Settings → AI → De-identification) applied on top of
 * the known-name patterns: word lists and regular expressions that always
 * become a placeholder, and exception words NER must leave alone.
 */
import { deriveAliases, escapeRegex, type AdHocRecognizer, type KnownEntity } from './knownEntities.js'
import type { PlaceholderKind } from './placeholders.js'

/** Placeholder kinds a rule may produce; known-person kinds stay reserved for known entities. */
export const RULE_PLACEHOLDER_KINDS = ['person', 'location', 'organization', 'phone', 'email', 'nationalId', 'sensitive'] as const
export type RulePlaceholderKind = typeof RULE_PLACEHOLDER_KINDS[number] & PlaceholderKind

export type DeidRuleKind = 'deny_list' | 'regex' | 'allow_list'

export interface DeidRule {
  name: string
  kind: DeidRuleKind
  /** Words for deny_list and allow_list. */
  entries: string[]
  /** Regular expression (Python `regex` syntax, as Presidio runs it) for regex rules. */
  pattern: string | null
  /** Placeholder for matches; null for allow_list. */
  placeholderKind: RulePlaceholderKind | null
  /** Languages the rule runs in; empty means every enabled language. */
  languages: string[]
  score: number
}

/** Entity type Presidio reports for a rule match; parsed back by {@link parseRuleEntityType}. */
export function ruleEntityType(index: number): string {
  return `EDULOG_RULE_${index}`
}

export function parseRuleEntityType(entityType: string): number | null {
  const match = /^EDULOG_RULE_(\d+)$/.exec(entityType)
  return match ? Number(match[1]) : null
}

export function ruleAppliesTo(rule: DeidRule, language: string): boolean {
  return rule.languages.length === 0 || rule.languages.includes(language)
}

/**
 * One ad-hoc recognizer per replacing rule. Word lists become an escaped
 * alternation without word boundaries, for the same reason as known names:
 * Presidio's `deny_list` never matches words written next to Chinese text.
 */
export function buildRuleRecognizers(rules: DeidRule[], language: string): AdHocRecognizer[] {
  return rules.flatMap((rule, index): AdHocRecognizer[] => {
    if (rule.kind === 'allow_list' || !ruleAppliesTo(rule, language)) return []
    const regex = rule.kind === 'regex'
      ? rule.pattern ?? ''
      : [...new Set(rule.entries.map((entry) => entry.trim()).filter(Boolean))]
        .sort((a, b) => b.length - a.length).map(escapeRegex).join('|')
    if (!regex) return []
    return [{
      name: `edulog_rule_${index}`,
      supported_language: language,
      supported_entity: ruleEntityType(index),
      patterns: [{ name: rule.kind, regex, score: rule.score }],
    }]
  })
}

/**
 * Exception words for one language. A word that contains a known name's
 * alias is dropped: Presidio's allow list would otherwise remove the known
 * entity's own match and the request would fail the residual check.
 */
export function exceptionWords(rules: DeidRule[], entities: KnownEntity[], language: string): { words: string[], ignored: string[] } {
  const aliases = entities.flatMap(deriveAliases)
  const words = new Set<string>()
  const ignored = new Set<string>()
  for (const rule of rules) {
    if (rule.kind !== 'allow_list' || !ruleAppliesTo(rule, language)) continue
    for (const raw of rule.entries) {
      const word = raw.trim()
      if (!word) continue
      if (aliases.some((alias) => word.includes(alias))) ignored.add(word)
      else words.add(word)
    }
  }
  return { words: [...words], ignored: [...ignored] }
}

/** Columns of public.ai_deid_rules returned by the API. */
export const DEID_RULE_FIELDS = 'id,name,kind,entries,pattern,placeholder_kind,languages,enabled,score,created_by,created_at,updated_at'

export interface DeidRuleRow {
  name: string
  kind: DeidRuleKind
  entries: string[] | null
  pattern: string | null
  placeholder_kind: RulePlaceholderKind | null
  languages: string[] | null
  score: number | string
}

export function deidRuleFromRow(row: DeidRuleRow): DeidRule {
  return {
    name: row.name,
    kind: row.kind,
    entries: row.entries ?? [],
    pattern: row.pattern,
    placeholderKind: row.placeholder_kind,
    languages: row.languages ?? [],
    score: Number(row.score),
  }
}
