import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import { PlaceholderMap } from '../deidentify/placeholders.js'
import { coerceDraftShape, InvalidDraftOutputError, normalizeDraft, parseJsonTextDraft, streamReportDraft, type DeepPartialDraft } from './reportDraft.js'
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

  it('in json_text mode sends no response format, asks for JSON in the prompt and parses fenced text', async () => {
    const map = new PlaceholderMap()
    map.assign('student', 'known:s1', '王小明')
    let callOptions: { responseFormat?: unknown, prompt?: unknown } = {}
    const text = '好的，以下是報告：\n```json\n{"sections":[{"key":"today","body":"[學生A]完成迴圈。"}],"teachingSuggestions":["多練習"]}\n```'
    const model = streamingModel(text)
    const doStream = model.doStream.bind(model)
    model.doStream = async (options) => { callOptions = options; return doStream(options) }
    const partials: DeepPartialDraft[] = []

    const result = await streamReportDraft({ model, prompt, map, mode: 'json_text', onPartial: (draft) => partials.push(draft) })

    expect((callOptions.responseFormat as { type?: string } | undefined)?.type ?? 'text').toBe('text')
    expect(JSON.stringify(callOptions.prompt)).toContain('只輸出一個 JSON 物件')
    expect(result.restored.sections).toEqual([{ key: 'today', title: '今日學習', body: '王小明完成迴圈。' }])
    expect(result.restored.teachingSuggestions).toEqual(['多練習'])
    expect(partials.some((partial) => partial.sections?.[0]?.body?.startsWith('王小明'))).toBe(true)
  })
})

describe('object-shaped sections (regression: "partial.sections?.map is not a function")', () => {
  it('streams and restores a draft whose sections come as an object keyed by section', async () => {
    const map = new PlaceholderMap()
    map.assign('student', 'known:s1', '王小明')
    const text = JSON.stringify({
      sections: { today: { title: '今日學習', body: '[學生A]完成迴圈。' }, performance: '專注度佳', home: ['在家練習', '每天十分鐘'] },
      teachingSuggestions: '下次加深練習',
    })
    const partials: DeepPartialDraft[] = []

    const result = await streamReportDraft({ model: streamingModel(text, 5), prompt, map, mode: 'json_text', onPartial: (draft) => partials.push(draft) })

    expect(result.restored.sections).toEqual([
      { key: 'today', title: '今日學習', body: '王小明完成迴圈。' },
      { key: 'performance', title: '課堂表現', body: '專注度佳' },
      { key: 'home', title: '居家建議', body: '在家練習\n每天十分鐘' },
    ])
    expect(result.restored.teachingSuggestions).toEqual(['下次加深練習'])
    expect(partials.length).toBeGreaterThan(1)
  })

  it('ignores unusable partial shapes instead of throwing', () => {
    expect(coerceDraftShape({ sections: '今日', teachingSuggestions: 3 })).toEqual({ sections: [], teachingSuggestions: [] })
    expect(coerceDraftShape('not an object')).toEqual({ sections: [], teachingSuggestions: [] })
    expect(coerceDraftShape({ sections: [null, { key: 'today', body: 'x' }] }).sections).toEqual([undefined, { key: 'today', title: undefined, body: 'x' }])
  })
})

describe('parseJsonTextDraft', () => {
  it('drops unknown section keys, fills missing titles and defaults suggestions', () => {
    expect(parseJsonTextDraft('{"sections":[{"key":"home","body":"在家練習"},{"key":"secret","body":"x"}]}')).toEqual({
      sections: [{ key: 'home', title: '居家建議', body: '在家練習' }],
      teachingSuggestions: [],
    })
  })

  it('rejects text that is not JSON, and leaves an unusable shape empty (logged as empty output)', () => {
    expect(() => parseJsonTextDraft('我無法完成這個要求')).toThrow(InvalidDraftOutputError)
    expect(() => parseJsonTextDraft('["today"]')).toThrow(InvalidDraftOutputError)
    expect(parseJsonTextDraft('{"sections": "today"}')).toEqual({ sections: [], teachingSuggestions: [] })
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
