import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildOpenApi } from './openapi.js'
import { decodeUpstreamTextFrame, normalizeClientMessage, resolveRealtimeUrl } from './realtime.js'

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

  it('forces the Phoenix 1.0 JSON-object serializer even if the URL has a V2 value', () => {
    const endpoint = resolveRealtimeUrl({
      SUPABASE_URL: 'http://kong:8000',
      SUPABASE_REALTIME_URL: 'ws://realtime:4000/socket/websocket?vsn=2.0.0',
      SUPABASE_ANON_KEY: 'public-anon-key'
    } as any)
    expect(endpoint.searchParams.get('vsn')).toBe('1.0.0')
  })

  it('accepts Phoenix JSON object frames and replaces the client join token with the authenticated cookie token', () => {
    const roomTopic = 'realtime:room:c2944526-bc67-48c6-8a49-3c597b317b2a'
    const frame = JSON.stringify({ join_ref: '1', ref: '1', topic: roomTopic, event: 'phx_join', payload: {
      config: { private: true }, access_token: '',
    } })
    const normalized = normalizeClientMessage(Buffer.from(frame), roomTopic, 'verified-cookie-token')
    expect(JSON.parse(normalized!)).toEqual({ join_ref: '1', ref: '1', topic: roomTopic, event: 'phx_join', payload: {
      config: { private: true }, access_token: 'verified-cookie-token',
    } })
  })

  it('preserves Phoenix 1.0 text frames when ws supplies a Buffer and rejects actual binary frames', () => {
    const frame = JSON.stringify({ topic: 'realtime:room:r', event: 'phx_reply', payload: { status: 'ok' } })
    expect(decodeUpstreamTextFrame(Buffer.from(frame), false)).toBe(frame)
    expect(decodeUpstreamTextFrame(Buffer.from(frame), true)).toBeNull()
  })

  it('rejects array frames, unrelated topics, unsupported events, and non-heartbeat Phoenix messages', () => {
    const roomTopic = 'realtime:room:c2944526-bc67-48c6-8a49-3c597b317b2a'
    expect(normalizeClientMessage(Buffer.from(JSON.stringify([null, '1', roomTopic, 'phx_join', {}])), roomTopic, 'token')).toBeNull()
    expect(normalizeClientMessage(Buffer.from(JSON.stringify({ join_ref: null, ref: '1', topic: 'realtime:room:other', event: 'phx_join', payload: {} })), roomTopic, 'token')).toBeNull()
    expect(normalizeClientMessage(Buffer.from(JSON.stringify({ join_ref: null, ref: '1', topic: roomTopic, event: 'phx_close', payload: {} })), roomTopic, 'token')).toBeNull()
    expect(normalizeClientMessage(Buffer.from(JSON.stringify({ join_ref: null, ref: '1', topic: 'phoenix', event: 'phx_join', payload: {} })), roomTopic, 'token')).toBeNull()
    expect(normalizeClientMessage(Buffer.from(JSON.stringify({ join_ref: null, ref: '1', topic: 'phoenix', event: 'heartbeat', payload: {} })), roomTopic, 'token')).not.toBeNull()
    expect(normalizeClientMessage(Buffer.from(JSON.stringify({ join_ref: null, ref: '1', topic: roomTopic, event: 'phx_join', payload: {} })), roomTopic, 'token', true)).toBeNull()
  })
})
