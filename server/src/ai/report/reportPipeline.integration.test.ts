import { describe, expect, it } from 'vitest'
import { Deidentifier } from '../deidentify/deidentifier.js'
import type { KnownEntity } from '../deidentify/knownEntities.js'
import { PresidioClient } from '../deidentify/presidioClient.js'
import { createLanguageModel } from '../providers/providerRegistry.js'
import { streamReportDraft } from './reportDraft.js'
import { buildReportPrompt } from './reportPrompt.js'

// Opt-in: PRESIDIO_ANALYZER_URL=http://127.0.0.1:5302 AI_TEST_OLLAMA_MODEL=qwen3.5:9b npx vitest run reportPipeline
const presidioUrl = process.env.PRESIDIO_ANALYZER_URL
const ollamaModel = process.env.AI_TEST_OLLAMA_MODEL

describe.skipIf(!presidioUrl || !ollamaModel)('report pipeline: Presidio → Ollama → restore', () => {
  it('never sends known names and restores them in the draft', async () => {
    const entities: KnownEntity[] = [
      { id: 's1', kind: 'student', name: '王小明' },
      { id: 's2', kind: 'student', name: '陳大文' },
      { id: 't1', kind: 'teacher', name: '林雅婷' },
    ]
    const { fields, map } = await new Deidentifier(new PresidioClient(presidioUrl!)).deidentify({
      classNotes: '小明今天很快理解重複積木，但第二關和陳大文聊天分心，雅婷老師提醒後回到座位，最後自己加了音效。',
    }, entities)
    expect(fields.classNotes).not.toMatch(/小明|陳大文|雅婷/)

    const prompt = buildReportPrompt({
      studentToken: '[學生A]',
      courseName: 'Scratch 程式設計',
      lessonTitle: '迴圈與角色移動',
      progressStart: 'C',
      progressEnd: 'E',
      isCompleted: true,
      attendance: 'present',
      participation: 4,
      behavior: 3,
      classNotes: fields.classNotes,
      previousReports: [],
    }, { tone: 'warm', length: 'short' })
    expect(`${prompt.system}\n${prompt.prompt}`).not.toMatch(/小明|陳大文|雅婷/)

    const result = await streamReportDraft({
      model: createLanguageModel({ provider: 'ollama', modelId: ollamaModel!, baseUrl: process.env.AI_TEST_OLLAMA_URL }),
      prompt,
      map,
    })
    const parentText = result.restored.sections.map((section) => section.body).join('\n')
    expect(result.restored.sections.length).toBeGreaterThan(0)
    expect(parentText).toContain('王小明')
    expect(JSON.stringify(result.sanitized)).not.toMatch(/王小明|陳大文|林雅婷/)
  }, 300_000)
})
