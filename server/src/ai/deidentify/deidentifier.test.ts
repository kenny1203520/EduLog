import { describe, expect, it } from 'vitest'
import { Deidentifier, DeidentificationResidualError } from './deidentifier.js'
import type { KnownEntity } from './knownEntities.js'
import { PresidioClient, type AnalyzeRequest, type PresidioSpan, type TextAnalyzer } from './presidioClient.js'

const entities: KnownEntity[] = [
  { id: 'stu-1', kind: 'student', name: '王小明' },
  { id: 'stu-2', kind: 'student', name: '陳大文' },
  { id: 'tea-1', kind: 'teacher', name: '林雅婷' },
  { id: 'sch-1', kind: 'school', name: '仁愛國小' },
]

/** Applies ad-hoc patterns like Presidio does, plus scripted NER spans. */
class FakeAnalyzer implements TextAnalyzer {
  constructor(private readonly ner: Array<{ text: string, type: string }> = [], private readonly ignoreAdHoc = false) {}

  async analyze(request: AnalyzeRequest): Promise<PresidioSpan[]> {
    const spans: PresidioSpan[] = []
    if (!this.ignoreAdHoc) {
      for (const recognizer of request.adHocRecognizers) {
        for (const pattern of recognizer.patterns) {
          for (const match of request.text.matchAll(new RegExp(pattern.regex, 'g'))) {
            spans.push({ entity_type: recognizer.supported_entity, start: match.index, end: match.index + match[0].length, score: 1 })
          }
        }
      }
    }
    for (const { text, type } of this.ner) {
      const start = request.text.indexOf(text)
      if (start >= 0) spans.push({ entity_type: type, start, end: start + text.length, score: 0.85 })
    }
    return spans
  }
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
})
