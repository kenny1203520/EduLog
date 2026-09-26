import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildOpenApi } from './openapi.js'
import { resolveRealtimeUrl } from './realtime.js'

describe('realtime proxy security contract', () => {
  it('requires a report room and evaluates access with the user JWT client', () => {
    const source = readFileSync(new URL('./realtime.ts', import.meta.url), 'utf8')
    expect(source).toContain("url.pathname !== '/api/realtime'")
    expect(source).toContain("url.searchParams.get('room')")
    expect(source).toContain('createUserClient(config, token)')
    expect(source).toContain("rpc('can_access_report'")
    expect(source).toContain("'teaching.reports.read'")
    expect(source).toContain('resolveRealtimeUrl(config)')
  })

  it('publishes the websocket upgrade with the report permission metadata', () => {
    const document = buildOpenApi() as { paths: Record<string, Record<string, any>> }
    const operation = document.paths['/api/realtime'].get
    expect(operation['x-websocket']).toBe(true)
    expect(operation['x-permission']).toBe('teaching.reports.read')
    expect(operation.security).toEqual([{ cookieAuth: [] }])
    expect(operation.parameters).toEqual([{ name: 'room', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }])
  })

  it('derives the realtime websocket endpoint from the configured Supabase URL when no override is set', () => {
    const endpoint = resolveRealtimeUrl({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'public-anon-key'
    } as any)
    expect(endpoint.protocol).toBe('wss:')
    expect(endpoint.pathname).toBe('/realtime/v1/websocket')
    expect(endpoint.searchParams.get('apikey')).toBe('public-anon-key')
    expect(endpoint.searchParams.get('vsn')).toBe('1.0.0')
  })

  it('keeps explicit self-hosted websocket paths', () => {
    const endpoint = resolveRealtimeUrl({
      SUPABASE_URL: 'http://kong:8000',
      SUPABASE_REALTIME_URL: 'ws://realtime:4000/socket/websocket?custom=1',
      SUPABASE_ANON_KEY: 'public-anon-key'
    } as any)
    expect(endpoint.protocol).toBe('ws:')
    expect(endpoint.host).toBe('realtime:4000')
    expect(endpoint.pathname).toBe('/socket/websocket')
    expect(endpoint.searchParams.get('custom')).toBe('1')
  })
})
