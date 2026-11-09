import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '../../http/errors.js'
import type { ApiConfig } from '../../config/config.js'
import { PresidioRequestError, type AnalyzeRequest, type PresidioSpan } from '../../ai/deidentify/presidioClient.js'
import { createAiDeidRouter, type DeidAnalyzer } from './aiDeidRouter.js'

type Row = Record<string, unknown>

/** Just enough of the Supabase query builder for these routes; records every write. */
function memoryDb(tables: Record<string, Row[]>, writes: string[]) {
  return {
    from(table: string) {
      const rows = (tables[table] ??= [])
      const filters: Array<(row: Row) => boolean> = []
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let payload: Row = {}
      const run = () => {
        if (op !== 'select') writes.push(`${op}:${table}`)
        if (op === 'insert') {
          const row = { id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`, created_at: new Date().toISOString(), ...payload }
          rows.push(row)
          return [row]
        }
        const matched = rows.filter((row) => filters.every((f) => f(row)))
        if (op === 'update') matched.forEach((row) => Object.assign(row, payload))
        if (op === 'delete') tables[table] = rows.filter((row) => !matched.includes(row))
        return matched
      }
      const builder = {
        select() { return builder },
        insert(value: Row) { op = 'insert'; payload = value; return builder },
        update(value: Row) { op = 'update'; payload = value; return builder },
        delete() { op = 'delete'; return builder },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder },
        neq(column: string, value: unknown) { filters.push((row) => row[column] !== value); return builder },
        order() { return builder },
        async single() { return { data: run()[0] ?? null, error: null } },
        async maybeSingle() { return { data: run()[0] ?? null, error: null } },
        then(resolve: (value: { data: Row[], error: null }) => void, reject?: (error: unknown) => void) {
          try { resolve({ data: run(), error: null }) } catch (error) { reject?.(error) }
        },
      }
      return builder
    },
  }
}

/** Applies ad-hoc patterns like Presidio; refuses patterns JavaScript cannot compile, like Presidio refuses bad Python regexes. */
class FakePresidio implements DeidAnalyzer {
  readonly requests: AnalyzeRequest[] = []
  constructor(private readonly installed = ['zh', 'en'], private readonly ner: Array<{ text: string, type: string }> = []) {}

  async supportedLanguages() { return this.installed }

  async analyze(request: AnalyzeRequest): Promise<PresidioSpan[]> {
    this.requests.push(request)
    const spans: PresidioSpan[] = []
    for (const recognizer of request.adHocRecognizers) {
      for (const pattern of recognizer.patterns) {
        let regex: RegExp
        try { regex = new RegExp(pattern.regex, 'g') } catch (error) { throw new PresidioRequestError(500, (error as Error).message) }
        for (const match of request.text.matchAll(regex)) {
          spans.push({ entity_type: recognizer.supported_entity, start: match.index, end: match.index + match[0].length, score: 1 })
        }
      }
    }
    for (const { text, type } of this.ner) {
      const start = request.text.indexOf(text)
      if (start >= 0) spans.push({ entity_type: type, start, end: start + text.length, score: 0.85 })
    }
    return spans.filter((span) => !request.allowList?.includes(request.text.slice(span.start, span.end)))
  }
}

function app(tables: Record<string, Row[]>, analyzer: DeidAnalyzer | null, options: { allowed?: boolean, writes?: string[] } = {}) {
  const writes = options.writes ?? []
  const instance = express()
  instance.use(express.json())
  instance.use((req, _res, next) => {
    req.user = { id: 'admin-1' } as never
    req.db = { rpc: async () => ({ data: options.allowed ?? true, error: null }) } as never
    req.adminDb = memoryDb(tables, writes) as never
    req.auditContext = {} as never
    req.log = { error() {}, warn() {}, info() {} } as never
    next()
  })
  instance.use('/api', createAiDeidRouter(analyzer))
  instance.use(errorHandler)
  return instance
}

const baseTables = () => ({ ai_settings: [{ id: true, deid_languages: ['zh'] }], ai_deid_rules: [] as Row[] })

describe('de-identification admin routes', () => {
  it('requires system.ai.manage', async () => {
    const response = await request(app(baseTables(), new FakePresidio(), { allowed: false })).get('/api/ai/admin/deid')
    expect(response.status).toBe(403)
  })

  it('reports connection, installed and enabled languages, rules and exceptions', async () => {
    const tables = baseTables()
    tables.ai_deid_rules.push(
      { id: 'r1', name: 'Clubs', kind: 'deny_list', entries: ['火箭社'], pattern: null, placeholder_kind: 'organization', languages: [], enabled: true, score: 0.85 },
      { id: 'r2', name: 'Exceptions', kind: 'allow_list', entries: ['仁愛'], pattern: null, placeholder_kind: null, languages: [], enabled: true, score: 0.85 },
    )
    const response = await request(app(tables, new FakePresidio(['zh', 'en']))).get('/api/ai/admin/deid')
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      connection: 'ok', installed_languages: ['zh', 'en'], enabled_languages: ['zh'], allow_list: ['仁愛'],
      available_languages: ['zh', 'en', 'ja', 'ko'],
    })
    expect(response.body.data.rules.map((rule: Row) => rule.id)).toEqual(['r1'])

    const offline = await request(app(tables, null)).get('/api/ai/admin/deid')
    expect(offline.body.data.connection).toBe('not_configured')
  })

  it('enables only installed languages', async () => {
    const tables = baseTables()
    const refused = await request(app(tables, new FakePresidio(['zh', 'en']))).put('/api/ai/admin/deid/languages').send({ languages: ['zh', 'ja'] })
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe('AI_DEID_LANGUAGE_NOT_INSTALLED')

    const saved = await request(app(tables, new FakePresidio(['zh', 'en']))).put('/api/ai/admin/deid/languages').send({ languages: ['zh', 'en'] })
    expect(saved.status).toBe(200)
    expect(tables.ai_settings[0].deid_languages).toEqual(['zh', 'en'])
  })

  it('creates, edits, toggles and deletes rules after running them through Presidio', async () => {
    const tables = baseTables()
    const analyzer = new FakePresidio()
    const created = await request(app(tables, analyzer)).post('/api/ai/admin/deid/rules')
      .send({ name: 'Student number', kind: 'regex', pattern: 'S\\d{6}', placeholder_kind: 'sensitive', languages: ['zh'] })
    expect(created.status).toBe(201)
    expect(analyzer.requests).toHaveLength(1)
    expect(analyzer.requests[0].adHocRecognizers[0].patterns[0].regex).toBe('S\\d{6}')
    const id = created.body.data.id as string

    const edited = await request(app(tables, analyzer)).patch(`/api/ai/admin/deid/rules/${id}`).send({ kind: 'deny_list', entries: ['火箭社', '機器人社'] })
    expect(edited.status).toBe(200)
    expect(tables.ai_deid_rules[0]).toMatchObject({ kind: 'deny_list', entries: ['火箭社', '機器人社'], pattern: null })

    // Toggling does not need Presidio.
    const toggled = await request(app(tables, null)).patch(`/api/ai/admin/deid/rules/${id}`).send({ enabled: false })
    expect(toggled.status).toBe(200)
    expect(tables.ai_deid_rules[0].enabled).toBe(false)

    const deleted = await request(app(tables, analyzer)).delete(`/api/ai/admin/deid/rules/${id}`)
    expect(deleted.status).toBe(200)
    expect(tables.ai_deid_rules).toHaveLength(0)
  })

  it('refuses a rule whose pattern Presidio cannot compile, with the message', async () => {
    const tables = baseTables()
    const response = await request(app(tables, new FakePresidio())).post('/api/ai/admin/deid/rules')
      .send({ name: 'Broken', kind: 'regex', pattern: '(unclosed', placeholder_kind: 'sensitive' })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('AI_DEID_RULE_INVALID')
    expect(response.body.error.fields.pattern[0]).toMatch(/unclosed|Unterminated/i)
    expect(tables.ai_deid_rules).toHaveLength(0)
  })

  it('refuses rules of the wrong shape', async () => {
    const response = await request(app(baseTables(), new FakePresidio())).post('/api/ai/admin/deid/rules')
      .send({ name: 'Empty', kind: 'deny_list', entries: [], placeholder_kind: 'person' })
    expect(response.status).toBe(422)
    expect(response.body.error.fields.entries).toBeDefined()
  })

  it('replaces the exception words', async () => {
    const tables = baseTables()
    await request(app(tables, null)).put('/api/ai/admin/deid/allow-list').send({ entries: ['仁愛', '信義', '仁愛'] })
    expect(tables.ai_deid_rules).toEqual([expect.objectContaining({ kind: 'allow_list', entries: ['仁愛', '信義'] })])
    await request(app(tables, null)).put('/api/ai/admin/deid/allow-list').send({ entries: [] })
    expect(tables.ai_deid_rules).toHaveLength(0)
  })

  it('tests saved and draft rules with simulated names and writes nothing', async () => {
    const tables = baseTables()
    tables.ai_deid_rules.push(
      { id: 'r1', name: 'Clubs', kind: 'deny_list', entries: ['火箭社'], pattern: null, placeholder_kind: 'organization', languages: [], enabled: true, score: 0.85 },
      { id: 'r2', name: 'Exceptions', kind: 'allow_list', entries: ['仁愛'], pattern: null, placeholder_kind: null, languages: [], enabled: true, score: 0.85 },
    )
    const writes: string[] = []
    const analyzer = new FakePresidio(['zh', 'en'], [{ text: '仁愛', type: 'LOCATION' }, { text: '張志豪', type: 'PERSON' }])
    const saved = await request(app(tables, analyzer, { writes })).post('/api/ai/admin/deid/test').send({
      text: '王小明在仁愛路的火箭社遇到張志豪。',
      names: [{ kind: 'student', name: '王小明' }],
    })
    expect(saved.status).toBe(200)
    expect(saved.body.data.sanitized).toBe('[學生A]在仁愛路的[機構A]遇到[人名A]。')
    expect(saved.body.data.spans).toEqual([
      expect.objectContaining({ start: 0, end: 3, text: '王小明', source: 'known', token: '[學生A]' }),
      expect.objectContaining({ text: '火箭社', source: 'rule', rule_name: 'Clubs', kind: 'organization' }),
      expect.objectContaining({ text: '張志豪', source: 'ner', entity_type: 'PERSON' }),
    ])

    const draft = await request(app(tables, analyzer, { writes })).post('/api/ai/admin/deid/test').send({
      text: '學號 S123456 的同學',
      rules: [{ name: 'Draft', kind: 'regex', pattern: 'S\\d{6}', placeholder_kind: 'sensitive' }],
      allow_list: [],
      languages: ['en'],
    })
    expect(draft.body.data).toMatchObject({ sanitized: '學號 [敏感A] 的同學', languages: ['en'] })
    expect(writes).toEqual([])
  })

  it('reports a broken draft pattern instead of failing', async () => {
    const response = await request(app(baseTables(), new FakePresidio())).post('/api/ai/admin/deid/test').send({
      text: '測試', rules: [{ name: 'Draft', kind: 'regex', pattern: '[', placeholder_kind: 'sensitive' }],
    })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('AI_DEID_RULE_INVALID')
  })
})
