import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import { PlaceholderMap } from '../deidentify/placeholders.js'
import { normalizeDraft, streamReportDraft, type DeepPartialDraft } from './reportDraft.js'
import { buildReportPrompt } from './reportPrompt.js'

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 80, text: 80, reasoning: undefined },
}

function streamingModel(json: string, chunkSize = 7): MockLanguageModelV4 {
  const deltas: string[] = []
  for (let i = 0; i < json.length; i += chunkSize) deltas.push(json.slice(i, i + chunkSize))
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't' },
        ...deltas.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
        { type: 'text-end', id: 't' },
        { type: 'finish', usage, finishReason: { unified: 'stop' as const, raw: 'stop' } },
      ]),
    }),
  })
}

const prompt = buildReportPrompt({
  studentToken: '[學生A]',
  courseName: 'Scratch',
  attendance: 'present',
  classNotes: '[學生A] 理解迴圈',
  previousReports: [],
}, { tone: 'warm', length: 'short' })

describe('streamReportDraft', () => {
  it('restores placeholders in partial and final output and keeps the sanitized copy', async () => {
    const map = new PlaceholderMap()
    map.assign('student', 'known:s1', '王小明')
    const output = {
      sections: [
        { key: 'today', title: '今日學習', body: '[學生A]今天學會了迴圈。' },
        { key: 'performance', title: '課堂表現', body: '[學生 A]專注度佳，[學生C]也很好。' },
      ],
      teachingSuggestions: ['下次讓[學生A]挑戰巢狀迴圈。'],
    }
    const partials: DeepPartialDraft[] = []

    const result = await streamReportDraft({
      model: streamingModel(JSON.stringify(output)),
      prompt,
      map,
      onPartial: (draft) => partials.push(draft),
    })

    expect(result.sanitized.sections[0].body).toBe('[學生A]今天學會了迴圈。')
    expect(result.restored.sections.map((section) => section.body)).toEqual([
      '王小明今天學會了迴圈。',
      '王小明專注度佳，[學生C]也很好。',
    ])
    expect(result.restored.teachingSuggestions).toEqual(['下次讓王小明挑戰巢狀迴圈。'])
    expect(result.unresolved).toEqual(['[學生C]'])
    expect(result.usage.inputTokens).toBe(120)
    expect(partials.length).toBeGreaterThan(1)
    for (const partial of partials) {
      for (const section of partial.sections ?? []) expect(section?.body ?? '').not.toMatch(/\[學生?$|\[$/)
    }
  })

  it('rejects output that puts internal suggestions into an unknown section key', async () => {
    const output = {
      sections: [{ key: 'teachingSuggestions', title: '內部建議', body: '調整座位' }],
      teachingSuggestions: [],
    }
    await expect(streamReportDraft({ model: streamingModel(JSON.stringify(output)), prompt, map: new PlaceholderMap() }))
      .rejects.toThrow()
  })
})

describe('normalizeDraft', () => {
  it('orders sections canonically, drops duplicates and empty bodies', () => {
    expect(normalizeDraft({
      sections: [
        { key: 'home', title: 'H', body: 'h' },
        { key: 'today', title: 'T', body: ' ' },
        { key: 'today', title: 'T2', body: 't' },
        { key: 'home', title: 'H2', body: 'h2' },
      ],
      teachingSuggestions: [' a ', ''],
    })).toEqual({
      sections: [{ key: 'today', title: 'T2', body: 't' }, { key: 'home', title: 'H', body: 'h' }],
      teachingSuggestions: ['a'],
    })
  })
})
