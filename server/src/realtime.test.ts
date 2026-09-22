import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildOpenApi } from './openapi.js'

describe('realtime proxy security contract', () => {
  it('requires a report room and evaluates access with the user JWT client', () => {
    const source = readFileSync(new URL('./realtime.ts', import.meta.url), 'utf8')
    expect(source).toContain("url.pathname !== '/api/realtime'")
    expect(source).toContain("url.searchParams.get('room')")
    expect(source).toContain('createUserClient(config, token)')
    expect(source).toContain("rpc('can_access_report'")
    expect(source).toContain("'teaching.reports.read'")
    expect(source).toContain("config.SUPABASE_REALTIME_URL")
  })

  it('publishes the websocket upgrade with the report permission metadata', () => {
    const document = buildOpenApi() as { paths: Record<string, Record<string, any>> }
    const operation = document.paths['/api/realtime'].get
    expect(operation['x-websocket']).toBe(true)
    expect(operation['x-permission']).toBe('teaching.reports.read')
    expect(operation.security).toEqual([{ cookieAuth: [] }])
    expect(operation.parameters).toEqual([{ name: 'room', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }])
  })
})