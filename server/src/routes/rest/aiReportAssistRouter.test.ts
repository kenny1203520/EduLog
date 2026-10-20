import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import { errorHandler } from '../../http/errors.js'
import { Deidentifier } from '../../ai/deidentify/deidentifier.js'
import type { AnalyzeRequest, PresidioSpan } from '../../ai/deidentify/presidioClient.js'
import type { GenerationLogRow, ReportAssistRepository, ReportFacts, StoredGeneration } from '../../ai/report/reportAssistRepository.js'
import { ReportGenerationService } from '../../ai/report/reportGenerationService.js'
import { createAiReportAssistRouter } from './aiReportAssistRouter.js'

const REPORT = 'a1000000-0000-4000-8000-000000000001'
const MODEL = 'b1000000-0000-4000-8000-000000000001'
const GENERATION = 'c1000000-0000-4000-8000-000000000001'

const facts: ReportFacts = {
  reportId: REPORT, enrollmentId: 'e1', classSessionId: null, occurrenceDate: '2026-10-20', studentId: 's1', studentName: '王小明',
  courseName: 'Scratch', subject: null, stage: null, lessonTitle: '迴圈', progressLetter: null, isCompleted: true,
  attendance: 'present', absenceReason: null, participation: 4, behavior: 4, classNotes: '小明今天完成迴圈作品，表現很穩定，也會主動幫忙同學。', content: '', previousReports: [],
}

class Repo implements ReportAssistRepository {
  quotaLedger: Array<{ kind: 'consume', delta: number, created_at: string }> = []
  logs: GenerationLogRow[] = []
  adoptions: unknown[] = []
  stored: StoredGeneration = {
    id: GENERATION, userId: 'u1', occurrenceReportId: REPORT, createdAt: '2026-10-20T00:00:00Z',
    sanitizedInput: {}, sanitizedOutput: { sections: [{ key: 'today', title: '今日', body: '[學生A]很棒' }], teachingSuggestions: ['加深練習'] },
  }
  async getSettings() { return { enabled: true, noticeVersion: 2, defaultModelId: MODEL } }
  async hasAcknowledgedNotice() { return true }
  async acknowledgeNotice() {}
  async listModelSources() {
    return [{ modelRowId: MODEL, modelId: 'qwen', displayName: 'Qwen', isDefault: true, quotaWeight: 1, priceInputPerMtok: null, priceOutputPerMtok: null, credentialId: 'c1', credentialScope: 'site' as const, credentialLabel: 'Local', provider: 'ollama' as const }]
  }
  async resolveModel() { return { ...(await this.listModelSources())[0], authType: 'none' as const, secretCiphertext: null, baseUrl: null } }
  async loadReportFacts() { return facts }
  async loadKnownEntities() { return [{ id: 's1', kind: 'student' as const, name: '王小明' }] }
  async loadTemplate() { return null }
  async loadQuotaInputs() {
    return { policies: [{ scope: 'default' as const, target_id: null, one_time_total: 1, period: 'none' as const, period_amount: null }], roleIds: [], ledger: this.quotaLedger }
  }
  async insertGeneration(row: GenerationLogRow) { this.logs.push(row); return GENERATION }
  async chargeQuota() { this.quotaLedger.push({ kind: 'consume', delta: -1, created_at: '2026-10-20T00:00:00Z' }) }
  async listGenerationsForReports() { return [] }
  async keptSuggestionIndexes() { return new Map() }
  async getGeneration(id: string) { return id === GENERATION ? this.stored : null }
  async setSuggestionState() {}
  async insertAdoption(row: unknown) { this.adoptions.push(row); return 'adoption-1' }
}

const analyzer = {
  async analyze(req: AnalyzeRequest): Promise<PresidioSpan[]> {
    return req.adHocRecognizers.flatMap((rec) => rec.patterns.flatMap((p) => [...req.text.matchAll(new RegExp(p.regex, 'g'))]
      .map((m) => ({ entity_type: rec.supported_entity, start: m.index, end: m.index + m[0].length, score: 1 }))))
  },
}

const model = () => new MockLanguageModelV4({
  doStream: async () => ({
    stream: convertArrayToReadableStream([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: '{"sections":[{"key":"today","title":"今日學習","body":"[學生A]完成' },
      { type: 'text-delta', id: 't', delta: '迴圈。"}],"teachingSuggestions":["下次挑戰巢狀迴圈"]}' },
      { type: 'text-end', id: 't' },
      { type: 'finish', usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } }, finishReason: { unified: 'stop', raw: 'stop' } },
    ]),
  }),
})

function app(repo: Repo, allow = true) {
  const instance = express()
  instance.use(express.json())
  instance.use((req, _res, next) => {
    req.user = { id: 'u1' } as never
    req.db = { rpc: async () => ({ data: allow, error: null }) } as never
    req.adminDb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ai_settings: { tone: 'warm' } }, error: null }) }) }) }) } as never
    req.auditContext = {} as never
    next()
  })
  instance.use('/api', createAiReportAssistRouter({
    repository: () => repo,
    service: (repository) => new ReportGenerationService({ repository, deidentifier: new Deidentifier(analyzer), cipher: null, createModel: model }),
  }))
  instance.use(errorHandler)
  return instance
}

const body = { model_row_id: MODEL, options: { tone: 'warm', length: 'short' }, session_seq: 1 }

describe('AI report assist router', () => {
  it('streams partial drafts and a restored final draft, then charges quota', async () => {
    const repo = new Repo()
    const response = await request(app(repo)).post(`/api/ai/report-assist/reports/${REPORT}/generations`).send(body)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    const events = response.text.trim().split('\n\n').map((chunk) => {
      const [eventLine, dataLine] = chunk.split('\n')
      return { event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) }
    })
    expect(events[0].event).toBe('start')
    expect(events.some((event) => event.event === 'partial')).toBe(true)
    const done = events.at(-1)!
    expect(done.event).toBe('done')
    expect(done.data.draft.sections[0].body).toBe('王小明完成迴圈。')
    expect(done.data.quota_remaining).toBe(0)
    expect(JSON.stringify(repo.logs)).not.toContain('王小明')
    expect(repo.quotaLedger).toHaveLength(1)
  })

  it('refuses with JSON before streaming once quota is spent', async () => {
    const repo = new Repo()
    repo.quotaLedger.push({ kind: 'consume', delta: -1, created_at: '2026-10-19T00:00:00Z' })
    const response = await request(app(repo)).post(`/api/ai/report-assist/reports/${REPORT}/generations`).send(body)
    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('AI_QUOTA_EXHAUSTED')
  })

  it('denies reports outside the caller’s AI scope', async () => {
    const response = await request(app(new Repo(), false)).post(`/api/ai/report-assist/reports/${REPORT}/generations`).send(body)
    expect(response.status).toBe(403)
  })

  it('returns a de-identified preview without calling a model', async () => {
    const response = await request(app(new Repo())).post(`/api/ai/report-assist/reports/${REPORT}/preview`).send({ options: body.options })
    expect(response.status).toBe(200)
    expect(response.body.data.fields.classNotes).toBe('[學生A]今天完成迴圈作品，表現很穩定，也會主動幫忙同學。')
    expect(response.body.data.prompt).not.toContain('小明')
  })

  it('records adoptions from the stored sanitized output and validates suggestion indexes', async () => {
    const repo = new Repo()
    const adopted = await request(app(repo)).post(`/api/ai/report-assist/generations/${GENERATION}/adoptions`).send({ section_key: 'today', action: 'insert' })
    expect(adopted.status).toBe(201)
    expect(repo.adoptions).toEqual([{ generation_id: GENERATION, section_key: 'today', action: 'insert', sanitized_snapshot: '[學生A]很棒', adopted_by: 'u1' }])

    const missing = await request(app(repo)).post(`/api/ai/report-assist/generations/${GENERATION}/adoptions`).send({ section_key: 'home', action: 'insert' })
    expect(missing.status).toBe(400)

    const badIndex = await request(app(repo)).put(`/api/ai/report-assist/generations/${GENERATION}/suggestions/5`).send({ state: 'kept' })
    expect(badIndex.status).toBe(400)
    const kept = await request(app(repo)).put(`/api/ai/report-assist/generations/${GENERATION}/suggestions/0`).send({ state: 'kept' })
    expect(kept.status).toBe(200)
  })
})
