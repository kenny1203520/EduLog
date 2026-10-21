import { Output, parsePartialJson, streamText, type LanguageModel, type LanguageModelUsage } from 'ai'
import { z } from 'zod'
import type { PlaceholderMap } from '../deidentify/placeholders.js'
import type { BuiltPrompt } from './reportPrompt.js'

/** Parent-facing section keys; an enum so internal suggestions cannot slip in as a section. */
export const REPORT_SECTION_KEYS = ['today', 'performance', 'home'] as const
export type ReportSectionKey = typeof REPORT_SECTION_KEYS[number]

export const ReportDraftSchema = z.object({
  sections: z.array(z.object({
    key: z.enum(REPORT_SECTION_KEYS),
    title: z.string(),
    body: z.string(),
  })),
  teachingSuggestions: z.array(z.string()),
})
export type ReportDraft = z.infer<typeof ReportDraftSchema>

export interface ReportDraftResult {
  /** Model output as returned, still de-identified; this is what gets logged. */
  sanitized: ReportDraft
  /** Output with placeholders restored, shown to the teacher. */
  restored: ReportDraft
  /** Placeholder-like fragments the model invented; shown as a warning. */
  unresolved: string[]
  usage: LanguageModelUsage
}

export interface StreamReportDraftOptions {
  model: LanguageModel
  prompt: BuiltPrompt
  map: PlaceholderMap
  /**
   * Restore map for the parent-facing sections, when they must differ from
   * the internal suggestions (classmates as 同學, contact details unrestored).
   * Defaults to `map`.
   */
  sectionMap?: PlaceholderMap
  signal?: AbortSignal
  /** Called with restored partial drafts while the model streams. */
  onPartial?: (draft: DeepPartialDraft) => void
  /**
   * `structured` sends a JSON schema (response_format). `json_text` asks for
   * JSON in the prompt instead, for models that reject structured output.
   */
  mode?: OutputMode
}

export type OutputMode = 'structured' | 'json_text'

/** The model's text in json_text mode was not a usable draft. */
export class InvalidDraftOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDraftOutputError'
  }
}

const SECTION_TITLES: Record<ReportSectionKey, string> = { today: '今日學習', performance: '課堂表現', home: '居家建議' }

/** Appended to the system prompt in json_text mode; administrators cannot override it. */
export const JSON_TEXT_RULE = [
  '輸出格式：只輸出一個 JSON 物件，不要任何說明文字，也不要 ``` 標記。格式如下：',
  '{"sections":[{"key":"today","title":"今日學習","body":"…"},{"key":"performance","title":"課堂表現","body":"…"},{"key":"home","title":"居家建議","body":"…"}],"teachingSuggestions":["…"]}',
  'key 只能是 today、performance、home；沒有內容的段落可以省略。',
].join('\n')

type LooseSection = { key?: string, title?: string, body?: string }

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join('\n')
  return undefined
}

function looseSection(value: unknown, key?: string): LooseSection | undefined {
  const plain = text(value)
  if (plain !== undefined) return { key, body: plain }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return { key: text(record.key) ?? key, title: text(record.title), body: text(record.body) ?? text(record.content) ?? text(record.text) }
}

/**
 * Bring model output into the draft's shape, whatever the model actually
 * returned. Models without structured output (and partial JSON mid-stream)
 * sometimes give `sections` as an object keyed by section ({"today": "…"}),
 * a string, or suggestions as a single string; anything unusable is dropped.
 */
export function coerceDraftShape(value: unknown): { sections: Array<LooseSection | undefined>, teachingSuggestions: Array<string | undefined> } {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const rawSections = record.sections
  const sections = Array.isArray(rawSections)
    ? rawSections.map((section) => looseSection(section))
    : rawSections && typeof rawSections === 'object'
      ? Object.entries(rawSections as Record<string, unknown>).map(([key, section]) => looseSection(section, key))
      : []
  const rawSuggestions = record.teachingSuggestions
  const teachingSuggestions = Array.isArray(rawSuggestions)
    ? rawSuggestions.map((item) => (typeof item === 'string' ? item : undefined))
    : typeof rawSuggestions === 'string' ? [rawSuggestions] : []
  return { sections, teachingSuggestions }
}

/** Text around the JSON (code fences, a sentence before it) is ignored. */
function jsonCandidate(text: string): string {
  const unfenced = text.replace(/```(?:json)?/gi, '')
  const start = unfenced.indexOf('{')
  if (start < 0) return ''
  const end = unfenced.lastIndexOf('}')
  return end > start ? unfenced.slice(start, end + 1) : unfenced.slice(start)
}

/** Parse the complete json_text answer into a draft, or throw InvalidDraftOutputError. */
export function parseJsonTextDraft(text: string): ReportDraft {
  let value: unknown
  try {
    value = JSON.parse(jsonCandidate(text))
  } catch {
    throw new InvalidDraftOutputError('The model did not return valid JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidDraftOutputError('The model returned JSON in an unexpected shape')
  const draft = coerceDraftShape(value)
  return {
    sections: draft.sections
      .filter((section): section is { key: ReportSectionKey, title?: string, body: string } =>
        Boolean(section?.key && (REPORT_SECTION_KEYS as readonly string[]).includes(section.key) && typeof section.body === 'string'))
      .map((section) => ({ key: section.key, title: section.title?.trim() || SECTION_TITLES[section.key], body: section.body })),
    teachingSuggestions: draft.teachingSuggestions.filter((item): item is string => typeof item === 'string'),
  }
}

export interface DeepPartialDraft {
  sections?: Array<{ key?: string, title?: string, body?: string } | undefined>
  teachingSuggestions?: Array<string | undefined>
}

/** Stream a structured report draft from the model and restore placeholders. */
export async function streamReportDraft(options: StreamReportDraftOptions): Promise<ReportDraftResult> {
  const { model, prompt, map, signal, onPartial } = options
  const sectionMap = options.sectionMap ?? map
  // Cancelled before the call started: do not open a stream just to abort it.
  signal?.throwIfAborted()
  if (options.mode === 'json_text') return streamJsonTextDraft(options, sectionMap)
  // The SDK reports a failed stream as NoOutputGeneratedError without the
  // provider error; keep the original (with its HTTP status) from onError.
  let streamError: unknown
  const result = streamText({
    model,
    system: prompt.system,
    prompt: prompt.prompt,
    output: Output.object({ schema: ReportDraftSchema }),
    abortSignal: signal,
    onError: ({ error }) => { streamError ??= error },
  })

  let output: ReportDraft
  try {
    for await (const partial of result.partialOutputStream) {
      onPartial?.(restorePartial(partial, sectionMap, map))
    }
    output = await result.output
  } catch (error) {
    throw streamError ?? error
  }

  const sanitized = normalizeDraft(output)
  return { sanitized, ...restoreDraft(sanitized, sectionMap, map), usage: await result.usage }
}

/** json_text mode: plain text streaming, parsed as (partial) JSON along the way. */
async function streamJsonTextDraft(options: StreamReportDraftOptions, sectionMap: PlaceholderMap): Promise<ReportDraftResult> {
  const { model, prompt, map, signal, onPartial } = options
  let streamError: unknown
  const result = streamText({
    model,
    system: `${prompt.system}\n${JSON_TEXT_RULE}`,
    prompt: prompt.prompt,
    abortSignal: signal,
    onError: ({ error }) => { streamError ??= error },
  })

  let text = ''
  try {
    for await (const chunk of result.textStream) {
      text += chunk
      if (!onPartial) continue
      const partial = await parsePartialJson(jsonCandidate(text))
      if (partial.value && typeof partial.value === 'object') onPartial(restorePartial(partial.value, sectionMap, map))
    }
  } catch (error) {
    throw streamError ?? error
  }
  if (streamError) throw streamError

  const sanitized = normalizeDraft(parseJsonTextDraft(text))
  return { sanitized, ...restoreDraft(sanitized, sectionMap, map), usage: await result.usage }
}

/** Restore a sanitized draft: sections with `sectionMap`, teaching suggestions with `map`. */
export function restoreDraft(sanitized: ReportDraft, sectionMap: PlaceholderMap, map: PlaceholderMap): { restored: ReportDraft, unresolved: string[] } {
  const unresolved = new Set<string>()
  const restoreWith = (restoreMap: PlaceholderMap) => (text: string) => {
    const restored = restoreMap.restore(text)
    restored.unresolved.forEach((fragment) => unresolved.add(fragment))
    return restored.text
  }
  const restored: ReportDraft = {
    sections: sanitized.sections.map((section) => ({ ...section, title: restoreWith(sectionMap)(section.title), body: restoreWith(sectionMap)(section.body) })),
    teachingSuggestions: sanitized.teachingSuggestions.map(restoreWith(map)),
  }
  return { restored, unresolved: [...unresolved] }
}

/** Keep the first section per key, in canonical order, and drop empty suggestions. */
export function normalizeDraft(draft: ReportDraft): ReportDraft {
  const byKey = new Map<ReportSectionKey, ReportDraft['sections'][number]>()
  for (const section of draft.sections) {
    if (!byKey.has(section.key) && section.body.trim()) byKey.set(section.key, section)
  }
  return {
    sections: REPORT_SECTION_KEYS.flatMap((key) => byKey.get(key) ?? []),
    teachingSuggestions: draft.teachingSuggestions.map((text) => text.trim()).filter(Boolean),
  }
}

function restorePartial(raw: unknown, sectionMap: PlaceholderMap, map: PlaceholderMap): DeepPartialDraft {
  const partial = coerceDraftShape(raw)
  return {
    sections: partial.sections.map((section) => section && {
      key: section.key,
      title: section.title === undefined ? undefined : sectionMap.restoreStreaming(section.title),
      body: section.body === undefined ? undefined : sectionMap.restoreStreaming(section.body),
    }),
    teachingSuggestions: partial.teachingSuggestions.map((item) => item === undefined ? undefined : map.restoreStreaming(item)),
  }
}
