import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRealtimeChannel, decodePhoenixMessage, encodePhoenixMessage } from './ApiRealtimeChannel'

class MockWebSocket {
  static OPEN = 1
  readyState = MockWebSocket.OPEN
  sent: string[] = []
  listeners = new Map<string, Array<(event: any) => void>>()
  constructor(public url: string) { MockWebSocket.latest = this }
  static latest: MockWebSocket | null = null
  addEventListener(name: string, callback: (event: any) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), callback])
  }
  send(message: string) { this.sent.push(message) }
  close(code = 1000) {
    this.readyState = 3
    this.emit('close', { code })
  }
  emit(name: string, event: any = {}) { this.listeners.get(name)?.forEach((listener) => listener(event)) }
}

describe('ApiRealtimeChannel Phoenix 1.0 protocol', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    MockWebSocket.latest = null
  })

  it('encodes and decodes five-element Phoenix JSON-array frames', () => {
    const frame = encodePhoenixMessage({ joinRef: '7', ref: '7', topic: 'realtime:room:r', event: 'phx_join', payload: {} })
    expect(JSON.parse(frame)).toEqual(['7', '7', 'realtime:room:r', 'phx_join', {}])
    expect(decodePhoenixMessage(frame)).toEqual({ joinRef: '7', ref: '7', topic: 'realtime:room:r', event: 'phx_join', payload: {} })
    expect(() => decodePhoenixMessage(new ArrayBuffer(4))).toThrow(/non-text frame/)
  })

  it('joins with array frames, reports rejection detail, and retries with backoff', () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } })
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const socket = MockWebSocket.latest!
    socket.emit('open')
    expect(JSON.parse(socket.sent[0])).toMatchObject([expect.any(String), expect.any(String), 'realtime:room:report-id', 'phx_join', {
      access_token: '',
      config: { private: true }
    }])

    const [joinRef, ref, topic] = JSON.parse(socket.sent[0])
    socket.emit('message', { data: JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'error', response: { reason: 'private channel authorization failed' } }]) })
    expect(callback).toHaveBeenCalledWith('CHANNEL_ERROR', 'Realtime rejected the report room: private channel authorization failed')
    expect(socket.readyState).toBe(3)

    vi.advanceTimersByTime(500)
    expect(MockWebSocket.latest).not.toBe(socket)
    channel.unsubscribe()
  })

  it('sends heartbeat, broadcast, and presence frames as Phoenix arrays', () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } })
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(vi.fn())
    const socket = MockWebSocket.latest!
    socket.emit('open')
    const [joinRef, ref, topic] = JSON.parse(socket.sent[0])
    socket.emit('message', { data: JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]) })

    channel.send({ type: 'broadcast', event: 'sync-update', payload: { update: 'abc' } })
    expect(JSON.parse(socket.sent[1])).toEqual([joinRef, expect.any(String), topic, 'broadcast', {
      type: 'broadcast', event: 'sync-update', payload: { update: 'abc' }
    }])
    channel.track({ clientId: 42 })
    expect(JSON.parse(socket.sent[2])).toEqual([joinRef, expect.any(String), topic, 'presence', {
      type: 'presence', event: 'track', payload: { clientId: 42 }
    }])

    vi.advanceTimersByTime(25_000)
    expect(JSON.parse(socket.sent[3])).toEqual([null, expect.any(String), 'phoenix', 'heartbeat', {}])
    channel.unsubscribe()
  })

  it('dispatches broadcast and presence replies decoded from Phoenix arrays', () => {
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } })
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    const broadcast = vi.fn()
    const presenceSync = vi.fn()
    channel.on('broadcast', { event: 'sync-update' }, broadcast)
    channel.on('presence', { event: 'sync' }, presenceSync)
    channel.subscribe(vi.fn())
    const socket = MockWebSocket.latest!
    socket.emit('open')
    const [joinRef, ref, topic] = JSON.parse(socket.sent[0])
    socket.emit('message', { data: JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]) })
    socket.emit('message', { data: JSON.stringify([joinRef, '2', topic, 'broadcast', {
      type: 'broadcast', event: 'sync-update', payload: { update: 'encoded-yjs-update' }
    }]) })
    socket.emit('message', { data: JSON.stringify([joinRef, '3', topic, 'presence_state', { key: [{ clientId: 12 }] }]) })

    expect(broadcast).toHaveBeenCalledWith({ payload: { update: 'encoded-yjs-update' }, event: 'sync-update' })
    expect(presenceSync).toHaveBeenCalledOnce()
    expect(channel.presenceState()).toEqual({ key: [{ clientId: 12 }] })
    channel.unsubscribe()
  })
})
