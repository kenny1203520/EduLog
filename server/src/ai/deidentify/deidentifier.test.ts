import { describe, expect, it } from 'vitest'
import { Deidentifier, DeidentificationResidualError } from './deidentifier.js'
import type { DeidRule } from './customRules.js'
import type { KnownEntity } from './knownEntities.js'
import { PresidioClient, type AnalyzeRequest, type PresidioSpan, type TextAnalyzer } from './presidioClient.js'

const entities: KnownEntity[] = [
  { id: 'stu-1', kind: 'student', name: '王小明' },
  { id: 'stu-2', kind: 'student', name: '陳大文' },
  { id: 'tea-1', kind: 'teacher', name: '林雅婷' },
  { id: 'sch-1', kind: 'school', name: '仁愛國小' },
]

/** Applies ad-hoc patterns and the allow list like Presidio does, plus scripted NER spans. */
class FakeAnalyzer implements TextAnalyzer {
  readonly requests: AnalyzeRequest[] = []

  constructor(
    private readonly ner: Array<{ text: string, type: string, language?: string }> = [],
    private readonly ignoreAdHoc = false,
  ) {}

  async analyze(request: AnalyzeRequest): Promise<PresidioSpan[]> {
    this.requests.push(request)
    const spans: PresidioSpan[] = []
    if (!this.ignoreAdHoc) {
      for (const recognizer of request.adHocRecognizers) {
        if (recognizer.supported_language !== request.language) continue
        for (const pattern of recognizer.patterns) {
          for (const match of request.text.matchAll(new RegExp(pattern.regex, 'g'))) {
            spans.push({ entity_type: recognizer.supported_entity, start: match.index, end: match.index + match[0].length, score: 1 })
          }
        }
      }
    }
    for (const { text, type, language = 'zh' } of this.ner) {
      const start = request.text.indexOf(text)
      if (start >= 0 && language === request.language) spans.push({ entity_type: type, start, end: start + text.length, score: 0.85 })
    }
    return spans.filter((span) => !request.allowList?.includes(request.text.slice(span.start, span.end)))
  }
}

function rule(overrides: Partial<DeidRule>): DeidRule {
  return { name: 'rule', kind: 'deny_list', entries: [], pattern: null, placeholderKind: 'sensitive', languages: [], score: 0.85, ...overrides }
}

describe('Deidentifier', () => {
  it('replaces known people next to Chinese text and keeps one token per person', async () => {
    const result = await new Deidentifier(new FakeAnalyzer()).deidentify({
      notes: '王小明今天很快理解迴圈，小明和陳大文聊天，雅婷老師提醒後回座。',
    }, entities)

    expect(result.fields.notes).toBe('[學生A]今天很快理解迴圈，[學生A]和[學生B]聊天，[老師A]提醒後回座。')
    expect(result.map.restore(result.fields.notes).text).toBe('王小明今天很快理解迴圈，王小明和陳大文聊天，林雅婷提醒後回座。')
  })

  it('prefers known entities over overlapping NER spans and replaces NER-only finds', async () => {
    const analyzer = new FakeAnalyzer([
      { text: '雅婷', type: 'LOCATION' },
      { text: '0912-345-678', type: 'PHONE_NUMBER' },
      { text: '張志豪', type: 'PERSON' },
      { text: '下週三', type: 'DATE_TIME' },
    ])
    const result = await new Deidentifier(analyzer).deidentify({
      contact: '雅婷老師請張志豪家長回電 0912-345-678，下週三補課。',
    }, entities)

    expect(result.fields.contact).toBe('[老師A]請[人名A]家長回電 [電話A]，下週三補課。')
    expect(result.counts).toEqual({ teacher: 1, person: 1, phone: 1 })
    expect(result.map.restore(result.fields.contact).text).toBe('林雅婷請張志豪家長回電 0912-345-678，下週三補課。')
  })

  it('fails closed when a known name survives', async () => {
    const deidentifier = new Deidentifier(new FakeAnalyzer([], true))
    await expect(deidentifier.deidentify({ notes: '王小明表現很好' }, entities))
      .rejects.toBeInstanceOf(DeidentificationResidualError)
  })
})

describe('Deidentifier with languages and rules', () => {
  it('analyzes each language separately and merges the spans', async () => {
    const analyzer = new FakeAnalyzer([
      { text: '張志豪', type: 'PERSON', language: 'zh' },
      { text: 'Kevin Chen', type: 'PERSON', language: 'en' },
      { text: 'Kevin', type: 'PERSON', language: 'zh' },
    ])
    const result = await new Deidentifier(analyzer).deidentify({
      notes: '王小明和張志豪、Kevin Chen 一起做專題。',
    }, entities, { languages: ['zh', 'en'] })

    expect(analyzer.requests.map((request) => request.language)).toEqual(['zh', 'en'])
    expect(analyzer.requests[1].adHocRecognizers.every((recognizer) => recognizer.supported_language === 'en')).toBe(true)
    // The longer English span wins over the overlapping Chinese one; letters have no gaps.
    expect(result.fields.notes).toBe('[學生A]和[人名A]、[人名B] 一起做專題。')
    expect(result.spans.notes.map((span) => [span.source, span.language])).toEqual([['known', 'zh'], ['ner', 'zh'], ['ner', 'en']])
  })

  it('replaces custom rule matches with the rule’s placeholder and restores [敏感A]', async () => {
    const rules = [
      rule({ name: 'Club', entries: ['火箭社'], placeholderKind: 'organization' }),
      rule({ name: 'Student number', kind: 'regex', pattern: String.raw`S\d{6}`, placeholderKind: 'sensitive' }),
      rule({ name: 'English only', entries: ['火箭'], languages: ['en'] }),
    ]
    const result = await new Deidentifier(new FakeAnalyzer()).deidentify({
      notes: '王小明參加火箭社，學號 S123456。',
    }, entities, { rules })

    expect(result.fields.notes).toBe('[學生A]參加[機構A]，學號 [敏感A]。')
    expect(result.spans.notes.filter((span) => span.source === 'rule').map((span) => span.ruleIndex)).toEqual([0, 1])
    expect(result.counts).toMatchObject({ organization: 1, sensitive: 1 })
    expect(result.map.restore('[敏感 A] 已記錄').text).toBe('S123456 已記錄')
  })

  it('lets known names win over overlapping rule matches', async () => {
    const result = await new Deidentifier(new FakeAnalyzer()).deidentify({
      notes: '王小明同學',
    }, entities, { rules: [rule({ kind: 'regex', pattern: '小明同學', placeholderKind: 'person' })] })

    expect(result.fields.notes).toBe('[學生A]同學')
  })

  it('applies exception words to NER only and never to known names', async () => {
    const analyzer = new FakeAnalyzer([
      { text: '仁愛', type: 'LOCATION' },
      { text: '張志豪', type: 'PERSON' },
    ])
    const rules = [rule({ kind: 'allow_list', placeholderKind: null, entries: ['仁愛', '王小明', '小明哥', '張志豪'] })]
    const result = await new Deidentifier(analyzer).deidentify({
      notes: '仁愛路上，王小明遇到張志豪。',
    }, entities, { rules })

    expect(analyzer.requests[0].allowList).toEqual(['仁愛', '張志豪'])
    expect(result.ignoredExceptions).toEqual(['王小明', '小明哥'])
    expect(result.fields.notes).toBe('仁愛路上，[學生A]遇到張志豪。')
  })

  it('still fails closed when an exception would expose a known name', async () => {
    // An analyzer that wrongly honours the allow list for known names must not leak them.
    const analyzer: TextAnalyzer = { analyze: async () => [] }
    await expect(new Deidentifier(analyzer).deidentify({ notes: '小明表現很好' }, entities, {
      rules: [rule({ kind: 'allow_list', placeholderKind: null, entries: ['小明'] })],
    })).rejects.toBeInstanceOf(DeidentificationResidualError)
  })
})

const presidioUrl = process.env.PRESIDIO_ANALYZER_URL
describe.skipIf(!presidioUrl)('Deidentifier against Presidio (docker/presidio)', () => {
  it('removes known names, phone, email and national id from Chinese notes', async () => {
    const result = await new Deidentifier(new PresidioClient(presidioUrl!)).deidentify({
      notes: '王小明今天和陳大文聊天，雅婷老師提醒。家長電話 0912-345-678，信箱 mom.wang@example.com，身分證 A123456789。',
    }, entities)

    expect(result.fields.notes).not.toMatch(/王小明|小明|陳大文|雅婷|0912|example\.com|A123456789/)
    expect(result.fields.notes).toContain('[學生A]')
    expect(result.fields.notes).toContain('[學生B]')
    expect(result.fields.notes).toContain('[老師A]')
  })

  it('analyzes mixed Chinese and English with custom rules and exception words', async () => {
    const client = new PresidioClient(presidioUrl!)
    expect(await client.supportedLanguages()).toEqual(expect.arrayContaining(['zh', 'en']))
    const result = await new Deidentifier(client).deidentify({
      notes: '王小明和 Kevin Chen 一起參加火箭社，學號 S123456。Ms. Linda Wu called from Taipei, phone 0912-345-678.',
    }, entities, {
      languages: ['zh', 'en'],
      rules: [
        { name: 'Club', kind: 'deny_list', entries: ['火箭社'], pattern: null, placeholderKind: 'organization', languages: [], score: 0.85 },
        { name: 'Student number', kind: 'regex', entries: [], pattern: String.raw`S\d{6}`, placeholderKind: 'sensitive', languages: [], score: 0.9 },
        { name: 'Exceptions', kind: 'allow_list', entries: ['Taipei', '王小明'], pattern: null, placeholderKind: null, languages: [], score: 1 },
      ],
    })

    const notes = result.fields.notes
    expect(notes).not.toMatch(/王小明|火箭社|S123456|0912|Linda Wu/)
    expect(notes).toContain('[學生A]')
    expect(notes).toContain('[機構A]')
    expect(notes).toContain('[敏感A]')
    expect(notes).toContain('Taipei')
    expect(result.ignoredExceptions).toEqual(['王小明'])
    expect(result.spans.notes.some((span) => span.language === 'en' && span.source === 'ner')).toBe(true)
  })

  it('reports a pattern Presidio cannot compile', async () => {
    await expect(new PresidioClient(presidioUrl!).analyze({
      text: 'abc', language: 'zh', scoreThreshold: 0,
      adHocRecognizers: [{ name: 'r', supported_language: 'zh', supported_entity: 'EDULOG_RULE_0', patterns: [{ name: 'x', regex: '(unclosed', score: 0.8 }] }],
    })).rejects.toMatchObject({ name: 'PresidioRequestError', detail: expect.stringMatching(/missing \)/) })
  })
})
