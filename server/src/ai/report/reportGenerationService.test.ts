import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import { SecretCipher } from '../credentials/secretCipher.js'
import { Deidentifier } from '../deidentify/deidentifier.js'
import type { AnalyzeRequest, PresidioSpan, TextAnalyzer } from '../deidentify/presidioClient.js'
import type { GenerationLogRow, ReportAssistRepository, ReportFacts, ResolvedModel, StoredGeneration } from './reportAssistRepository.js'
import { adoptionSnapshot, credentialAssociatedData, parentSectionMap, ReportGenerationService } from './reportGenerationService.js'

class PatternAnalyzer implements TextAnalyzer {
  calls: AnalyzeRequest[] = []
  async analyze(request: AnalyzeRequest): Promise<PresidioSpan[]> {
    this.calls.push(request)
    return request.adHocRecognizers.flatMap((recognizer) => recognizer.patterns.flatMap((pattern) =>
      [...request.text.matchAll(new RegExp(pattern.regex, 'g'))].map((match) => ({
        entity_type: recognizer.supported_entity, start: match.index, end: match.index + match[0].length, score: 1,
      }))))
  }
}

const cipher = SecretCipher.fromBase64(Buffer.alloc(32, 7).toString('base64'))

const facts: ReportFacts = {
  reportId: 'r-now', enrollmentId: 'e1', classSessionId: 'cs1', occurrenceDate: '2026-10-20',
  studentId: 's1', studentName: '王小明', courseName: 'Scratch', subject: '程式', stage: '2',
  lessonTitle: '迴圈', progressLetter: 'C-E', isCompleted: true, attendance: 'present', absenceReason: null,
  participation: 4, behavior: 3, classNotes: '小明今天和陳大文聊天，林雅婷提醒後專心完成作品。', content: '',
  previousReports: [{ reportId: 'r-prev', date: '2026-10-13', content: '王小明完成第 4 課', participation: 5, behavior: 4 }],
}

function siteModel(overrides: Partial<ResolvedModel> = {}): ResolvedModel {
  return {
    modelRowId: 'm1', modelId: 'claude-sonnet-5-5', displayName: 'Sonnet', isDefault: true, quotaWeight: 2,
    priceInputPerMtok: 3, priceOutputPerMtok: 15, credentialId: 'c1', credentialScope: 'site', credentialLabel: 'Site',
    provider: 'anthropic', authType: 'api_key', secretCiphertext: cipher.encrypt('sk-ant-secret', credentialAssociatedData('c1')), baseUrl: null,
    ...overrides,
  }
}

class FakeRepository implements ReportAssistRepository {
  enabled = true
  acknowledged = true
  model: ResolvedModel | null = siteModel()
  ledger: Array<{ kind: 'grant' | 'consume' | 'reset', delta: number, created_at: string }> = []
  generations: Array<GenerationLogRow & { id: string }> = []
  charges: Array<{ userId: string, generationId: string, amount: number }> = []
  stored: StoredGeneration[] = []
  kept = new Map<string, number[]>()

  async getSettings() { return { enabled: this.enabled, noticeVersion: 1, defaultModelId: null } }
  async hasAcknowledgedNotice() { return this.acknowledged }
  async acknowledgeNotice() {}
  async listModelSources() { return [] }
  async resolveModel() { return this.model }
  async loadReportFacts(reportId: string) { return reportId === facts.reportId ? facts : null }
  async loadKnownEntities() {
    return [
      { id: 's1', kind: 'student' as const, name: '王小明' },
      { id: 's2', kind: 'student' as const, name: '陳大文' },
      { id: 't1', kind: 'teacher' as const, name: '林雅婷' },
    ]
  }
  async loadTemplate() { return null }
  async getActivePromptOverride() { return null }
  async loadQuotaInputs() {
    return { policies: [{ scope: 'default' as const, target_id: null, one_time_total: 3, period: 'none' as const, period_amount: null }], roleIds: [], ledger: this.ledger }
  }
  async insertGeneration(row: GenerationLogRow) {
    const id = `g${this.generations.length + 1}`
    this.generations.push({ ...row, id })
    return id
  }
  async chargeQuota(userId: string, generationId: string, amount: number) { this.charges.push({ userId, generationId, amount }) }
  async listGenerationsForReports() { return this.stored }
  async keptSuggestionIndexes() { return this.kept }
  async getGeneration() { return null }
  async setSuggestionState() {}
  async insertAdoption() { return 'a1' }
}

function jsonModel(output: unknown, capture?: { prompt?: string }) {
  const json = JSON.stringify(output)
  return new MockLanguageModelV4({
    doStream: async (options) => {
      if (capture) capture.prompt = JSON.stringify(options.prompt)
      return {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: json },
          { type: 'text-end', id: 't' },
          {
            type: 'finish',
            usage: { inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 200, text: 200, reasoning: undefined } },
            finishReason: { unified: 'stop', raw: 'stop' },
          },
        ]),
      }
    },
  })
}

const output = {
  sections: [{ key: 'today', title: '今日學習', body: '[學生A]完成迴圈，[老師A]很肯定。' }],
  teachingSuggestions: ['讓[學生A]和[學生B]分開座位'],
}

function service(repository: FakeRepository, model = jsonModel(output), analyzer = new PatternAnalyzer()) {
  const targets: unknown[] = []
  const svc = new ReportGenerationService({
    repository,
    deidentifier: new Deidentifier(analyzer),
    cipher,
    createModel: (target) => { targets.push(target); return model },
    now: () => new Date('2026-10-20T08:00:00Z'),
  })
  return { svc, targets, analyzer }
}

const request = { reportId: 'r-now', userId: 'u1', modelRowId: 'm1', options: { tone: 'warm' as const, length: 'short' as const, extraInstructions: '多鼓勵小明' }, sessionSeq: 1 }

describe('ReportGenerationService', () => {
  it('sends only de-identified text, logs it, restores the draft and charges site quota', async () => {
    const repository = new FakeRepository()
    const capture: { prompt?: string } = {}
    const { svc, targets } = service(repository, jsonModel(output, capture))

    const prepared = await svc.prepare(request)
    const outcome = await svc.run(prepared)

    expect(targets).toEqual([{ provider: 'anthropic', modelId: 'claude-sonnet-5-5', apiKey: 'sk-ant-secret', baseUrl: undefined }])
    expect(capture.prompt).not.toMatch(/王小明|小明|陳大文|林雅婷/)
    expect(capture.prompt).toContain('多鼓勵[學生A]')
    expect(outcome.draft.sections[0].body).toBe('王小明完成迴圈，林雅婷很肯定。')
    expect(outcome.draft.teachingSuggestions).toEqual(['讓王小明和陳大文分開座位'])

    const [log] = repository.generations
    expect(log.status).toBe('succeeded')
    expect(JSON.stringify(log)).not.toMatch(/王小明|小明|陳大文|林雅婷|sk-ant-secret/)
    expect(log.sanitized_input.known_refs).toEqual({ '[學生A]': 's1', '[學生B]': 's2', '[老師A]': 't1' })
    expect(log.tokens_in).toBe(1000)
    expect(log.est_cost).toBe(0.006)
    expect(log.quota_charged).toBe(2)
    expect(repository.charges).toEqual([{ userId: 'u1', generationId: 'g1', amount: 2 }])
    expect(outcome.quotaRemaining).toBe(1)
  })

  it('refuses before calling the model when quota is short, the switch is off or the notice is pending', async () => {
    const repository = new FakeRepository()
    repository.ledger = [{ kind: 'consume', delta: -2, created_at: '2026-10-19T00:00:00Z' }]
    await expect(service(repository).svc.prepare(request)).rejects.toMatchObject({ code: 'AI_QUOTA_EXHAUSTED' })

    repository.enabled = false
    await expect(service(repository).svc.prepare(request)).rejects.toMatchObject({ code: 'AI_DISABLED' })

    repository.enabled = true
    repository.acknowledged = false
    await expect(service(repository).svc.prepare(request)).rejects.toMatchObject({ code: 'AI_NOTICE_REQUIRED' })
    expect(repository.generations).toEqual([])
  })

  it('does not charge personal credentials', async () => {
    const repository = new FakeRepository()
    repository.ledger = [{ kind: 'consume', delta: -3, created_at: '2026-10-19T00:00:00Z' }]
    repository.model = siteModel({ credentialScope: 'user', quotaWeight: 2 })
    const { svc } = service(repository)
    const outcome = await svc.run(await svc.prepare(request))
    expect(outcome.quotaCharged).toBe(0)
    expect(repository.charges).toEqual([])
  })

  it('logs failures and cancellations without charging', async () => {
    const repository = new FakeRepository()
    const failing = new MockLanguageModelV4({ doStream: async () => { throw new Error('upstream 500') } })
    const { svc } = service(repository, failing)
    await expect(svc.run(await svc.prepare(request))).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })

    const controller = new AbortController()
    const prepared = await svc.prepare(request)
    controller.abort()
    await expect(svc.run(prepared, { signal: controller.signal })).rejects.toMatchObject({ code: 'AI_GENERATION_CANCELLED' })

    expect(repository.generations.map((row) => [row.status, row.quota_charged])).toEqual([['failed', 0], ['cancelled', 0]])
    expect(repository.charges).toEqual([])
  })

  it('fails closed when de-identification is unavailable', async () => {
    const repository = new FakeRepository()
    const broken: TextAnalyzer = { analyze: async () => { const { DeidentificationUnavailableError } = await import('../deidentify/presidioClient.js'); throw new DeidentificationUnavailableError('down') } }
    await expect(service(repository, jsonModel(output), broken as PatternAnalyzer).svc.prepare(request))
      .rejects.toMatchObject({ code: 'AI_DEIDENTIFICATION_UNAVAILABLE' })
  })

  it('restores kept suggestions from earlier reports with current names', async () => {
    const repository = new FakeRepository()
    repository.stored = [{
      id: 'g-old', userId: 'u1', occurrenceReportId: 'r-prev', createdAt: '2026-10-13T08:00:00Z',
      sanitizedInput: { known_refs: { '[學生A]': 's1', '[學生B]': 's2' } },
      sanitizedOutput: { sections: [], teachingSuggestions: ['[學生A]需要多練習', '換座位', '[人名A]的家長來電'] },
    }]
    repository.kept = new Map([['g-old', [0, 2]]])
    const { svc } = service(repository)
    const entities = await repository.loadKnownEntities()
    expect(await svc.keptSuggestions(facts, entities, 'u1')).toEqual([
      { generationId: 'g-old', date: '2026-10-13', suggestions: ['王小明需要多練習', '[人名A]的家長來電'] },
    ])
  })
})

describe('adoptionSnapshot', () => {
  it('takes sanitized text from the stored output by section key', () => {
    const stored = { sections: [{ key: 'today', title: '今日', body: '[學生A]好' }, { key: 'home', title: '居家', body: '練習' }], teachingSuggestions: [] }
    expect(adoptionSnapshot(stored, 'today')).toBe('[學生A]好')
    expect(adoptionSnapshot(stored, 'all')).toBe('今日\n[學生A]好\n\n居家\n練習')
    expect(adoptionSnapshot(stored, 'teachingSuggestions')).toBeNull()
  })
})

describe('parentSectionMap', () => {
  it('shows classmates as 同學 and keeps contact details as tokens in parent-facing text', async () => {
    const { PlaceholderMap } = await import('../deidentify/placeholders.js')
    const map = new PlaceholderMap()
    map.assign('student', 'known:s1', '王小明')
    map.assign('student', 'known:s2', '陳大文')
    map.assign('teacher', 'known:t1', '林雅婷')
    map.assign('phone', '0912-345-678', '0912-345-678')
    const parent = parentSectionMap({ map, facts: { ...facts, studentId: 's1' } })
    expect(parent.restore('[學生A]和[學生B]聊天，[老師A]提醒；電話 [電話A]').text).toBe('王小明和同學聊天，林雅婷提醒；電話 [電話A]')
    expect(map.restore('[學生B] [電話A]').text).toBe('陳大文 0912-345-678')
  })
})
