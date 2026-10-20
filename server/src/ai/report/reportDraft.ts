import { Output, streamText, type LanguageModel, type LanguageModelUsage } from 'ai'
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
      onPartial?.(restorePartial(partial as DeepPartialDraft, sectionMap, map))
    }
    output = await result.output
  } catch (error) {
    throw streamError ?? error
  }

  const sanitized = normalizeDraft(output)
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

function restorePartial(partial: DeepPartialDraft, sectionMap: PlaceholderMap, map: PlaceholderMap): DeepPartialDraft {
  return {
    sections: partial.sections?.map((section) => section && {
      key: section.key,
      title: section.title === undefined ? undefined : sectionMap.restoreStreaming(section.title),
      body: section.body === undefined ? undefined : sectionMap.restoreStreaming(section.body),
    }),
    teachingSuggestions: partial.teachingSuggestions?.map((text) => text === undefined ? undefined : map.restoreStreaming(text)),
  }
}
