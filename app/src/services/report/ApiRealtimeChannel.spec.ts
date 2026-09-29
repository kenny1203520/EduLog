import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRealtimeChannel, decodePhoenixMessage, encodePhoenixMessage } from './ApiRealtimeChannel'
import { authService } from '@/services/auth/AuthService'

vi.mock('@/services/auth/AuthService', () => ({ authService: { getSession: vi.fn() } }))

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = MockWebSocket.CONNECTING
  sent: string[] = []
  closeCalls: Array<{ code: number; reason: string }> = []
  listeners = new Map<string, Array<(event: any) => void>>()
  constructor(public url: string) { MockWebSocket.latest = this }
  static latest: MockWebSocket | null = null
  addEventListener(name: string, callback: (event: any) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), callback])
  }
  send(message: string) { this.sent.push(message) }
  close(code = 1000, reason = '') {
    this.closeCalls.push({ code, reason })
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', { code, reason })
  }
  emit(name: string, event: any = {}) {
    if (name === 'open') this.readyState = MockWebSocket.OPEN
    if (name === 'close') this.readyState = MockWebSocket.CLOSED
    this.listeners.get(name)?.forEach((listener) => listener(event))
  }
}

function stubWindow(protocol = 'http:', host = 'localhost:5173') {
  const listeners = new Map<string, () => void>()
  const fakeWindow = {
    location: { protocol, host },
    addEventListener: vi.fn((name: string, callback: () => void) => listeners.set(name, callback)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
    dispatchEvent: vi.fn((event: Event) => { listeners.get(event.type)?.(); return true })
  }
  vi.stubGlobal('window', fakeWindow)
  return fakeWindow
}

describe('ApiRealtimeChannel Phoenix 1.0 protocol', () => {
  beforeEach(() => {
    vi.mocked(authService.getSession).mockClear()
    vi.mocked(authService.getSession).mockResolvedValue({ session: { user: { id: 'u' } } as any, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    MockWebSocket.latest = null
    vi.mocked(authService.getSession).mockReset()
  })

  it('encodes and decodes Phoenix 1.0 JSON object frames', () => {
    const frame = encodePhoenixMessage({ joinRef: '7', ref: '7', topic: 'realtime:room:r', event: 'phx_join', payload: {} })
    expect(JSON.parse(frame)).toEqual({ join_ref: '7', ref: '7', topic: 'realtime:room:r', event: 'phx_join', payload: {} })
    expect(decodePhoenixMessage(frame)).toEqual({ joinRef: '7', ref: '7', topic: 'realtime:room:r', event: 'phx_join', payload: {} })
    expect(() => decodePhoenixMessage(new ArrayBuffer(4))).toThrow(/non-text frame/)
    expect(() => decodePhoenixMessage(JSON.stringify(['7', '7', 'realtime:room:r', 'phx_join', {}]))).toThrow(/invalid Phoenix/)
  })

  it('joins with JSON object frames, reports a temporary join failure, and retries with backoff', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow()
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const socket = MockWebSocket.latest!
    socket.emit('open')
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      join_ref: expect.any(String),
      ref: expect.any(String),
      topic: 'realtime:room:report-id',
      event: 'phx_join',
      payload: { access_token: '', config: { private: true } }
    })

    const { join_ref: joinRef, ref, topic } = JSON.parse(socket.sent[0])
    socket.emit('message', { data: JSON.stringify({ join_ref: joinRef, ref, topic, event: 'phx_reply', payload: { status: 'error', response: { reason: 'temporary upstream failure' } } }) })
    expect(callback).toHaveBeenCalledWith('CHANNEL_ERROR', 'Realtime rejected the report room: temporary upstream failure')
    expect(socket.readyState).toBe(3)

    await vi.advanceTimersByTimeAsync(700)
    expect(MockWebSocket.latest).not.toBe(socket)
    channel.unsubscribe()
  })

  it('opens a private class-session invalidation channel using the scoped endpoint', () => {
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow('https:', 'edulog.example')
    const callback = vi.fn()
    const invalidate = vi.fn()
    const channel = new ApiRealtimeChannel('session-id', 'session-presence', 'class_session')
    channel.on('broadcast', { event: 'class_session_invalidated' }, invalidate)
    channel.subscribe(callback)
    const socket = MockWebSocket.latest!
    expect(socket.url).toBe('wss://edulog.example/api/realtime?class_session=session-id')
    socket.emit('open')
    const { join_ref: joinRef, ref, topic } = JSON.parse(socket.sent[0])
    expect(topic).toBe('realtime:class-session:session-id')
    socket.emit('message', { data: JSON.stringify({ join_ref: joinRef, ref, topic, event: 'phx_reply', payload: { status: 'ok', response: {} } }) })
    socket.emit('message', { data: JSON.stringify({ join_ref: joinRef, ref: '2', topic, event: 'broadcast', payload: {
      type: 'broadcast', event: 'class_session_invalidated', payload: { resource: 'class_session', change: 'report' }
    } }) })
    expect(callback).toHaveBeenCalledWith('SUBSCRIBED')
    expect(invalidate).toHaveBeenCalledWith({ payload: { resource: 'class_session', change: 'report' }, event: 'class_session_invalidated' })
    channel.unsubscribe()
  })

  it('times out a socket that never opens, closes it, and retries automatically', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow()
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const firstSocket = MockWebSocket.latest!

    await vi.advanceTimersByTimeAsync(10_800)

    expect(callback).toHaveBeenCalledWith('CHANNEL_ERROR', 'Timed out opening the realtime WebSocket')
    expect(firstSocket.readyState).toBe(MockWebSocket.CLOSED)
    expect(authService.getSession).toHaveBeenCalledOnce()
    expect(MockWebSocket.latest).not.toBe(firstSocket)
    channel.unsubscribe()
  })

  it('times out a missing Phoenix join reply and reconnects instead of staying stuck', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow()
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key', 'class_session')
    channel.subscribe(callback)
    const firstSocket = MockWebSocket.latest!
    firstSocket.emit('open')

    await vi.advanceTimersByTimeAsync(25_800)

    expect(callback).toHaveBeenCalledWith('CHANNEL_ERROR', 'Timed out waiting for the realtime channel join reply')
    expect(firstSocket.readyState).toBe(MockWebSocket.CLOSED)
    expect(firstSocket.closeCalls[0]?.code).toBe(4000)
    expect(authService.getSession).toHaveBeenCalledOnce()
    expect(MockWebSocket.latest).not.toBe(firstSocket)
    channel.unsubscribe()
  })

  it('reports unexpected binary frames and retries with backoff', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow()
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const socket = MockWebSocket.latest!
    socket.emit('open')
    socket.emit('message', { data: new ArrayBuffer(4) })

    expect(callback).toHaveBeenCalledWith('CHANNEL_ERROR', 'Realtime sent a non-text frame while using Phoenix 1.0.0')
    expect(socket.closeCalls[0]?.code).toBe(4400)
    await vi.advanceTimersByTimeAsync(700)
    expect(MockWebSocket.latest).not.toBe(socket)
    channel.unsubscribe()
  })

  it('sends heartbeat, broadcast, and presence frames as Phoenix JSON objects', () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(vi.fn())
    const socket = MockWebSocket.latest!
    socket.emit('open')
    const { join_ref: joinRef, ref, topic } = JSON.parse(socket.sent[0])
    socket.emit('message', { data: JSON.stringify({ join_ref: joinRef, ref, topic, event: 'phx_reply', payload: { status: 'ok', response: {} } }) })

    channel.send({ type: 'broadcast', event: 'sync-update', payload: { update: 'abc' } })
    expect(JSON.parse(socket.sent[1])).toEqual({ join_ref: joinRef, ref: expect.any(String), topic, event: 'broadcast', payload: {
      type: 'broadcast', event: 'sync-update', payload: { update: 'abc' }
    } })
    channel.track({ clientId: 42 })
    expect(JSON.parse(socket.sent[2])).toEqual({ join_ref: joinRef, ref: expect.any(String), topic, event: 'presence', payload: {
      type: 'presence', event: 'track', payload: { clientId: 42 }
    } })

    vi.advanceTimersByTime(25_000)
    expect(JSON.parse(socket.sent[3])).toEqual({ join_ref: null, ref: expect.any(String), topic: 'phoenix', event: 'heartbeat', payload: {} })
    channel.unsubscribe()
  })

  it('only treats the matching join reply as subscribed', () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow()
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const socket = MockWebSocket.latest!
    socket.emit('open')
    const { join_ref: joinRef, topic } = JSON.parse(socket.sent[0])

    socket.emit('message', { data: JSON.stringify({ join_ref: joinRef, ref: '2', topic, event: 'phx_reply', payload: { status: 'ok', response: {} } }) })
    expect(callback).not.toHaveBeenCalledWith('SUBSCRIBED')

    socket.emit('message', { data: JSON.stringify({ join_ref: joinRef, ref: joinRef, topic, event: 'phx_reply', payload: { status: 'ok', response: {} } }) })
    expect(callback.mock.calls.filter(([status]) => status === 'SUBSCRIBED')).toHaveLength(1)
    channel.unsubscribe()
  })

  it('dispatches broadcast and presence replies decoded from Phoenix JSON objects', () => {
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    const broadcast = vi.fn()
    const presenceSync = vi.fn()
    channel.on('broadcast', { event: 'sync-update' }, broadcast)
    channel.on('presence', { event: 'sync' }, presenceSync)
    channel.subscribe(vi.fn())
    const socket = MockWebSocket.latest!
    socket.emit('open')
    const { join_ref: joinRef, ref, topic } = JSON.parse(socket.sent[0])
    socket.emit('message', { data: JSON.stringify({ join_ref: joinRef, ref, topic, event: 'phx_reply', payload: { status: 'ok', response: {} } }) })
    socket.emit('message', { data: JSON.stringify({ join_ref: joinRef, ref: '2', topic, event: 'broadcast', payload: {
      type: 'broadcast', event: 'sync-update', payload: { update: 'encoded-yjs-update' }
    } }) })
    socket.emit('message', { data: JSON.stringify({ join_ref: joinRef, ref: '3', topic, event: 'presence_state', payload: { key: [{ clientId: 12 }] } }) })
    socket.emit('message', { data: JSON.stringify({ join_ref: joinRef, ref: '4', topic, event: 'presence_state', payload: { key: [{ clientId: 13 }] } }) })

    expect(broadcast).toHaveBeenCalledWith({ payload: { update: 'encoded-yjs-update' }, event: 'sync-update' })
    expect(presenceSync).toHaveBeenCalledTimes(2)
    expect(channel.presenceState()).toEqual({ key: [{ clientId: 13 }] })
    channel.unsubscribe()
  })

  it('uses jittered exponential backoff and renews the session before rebuilding the socket', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow('https:', 'edulog.example')
    vi.stubGlobal('navigator', { onLine: true })
    vi.mocked(authService.getSession).mockResolvedValue({ session: { user: { id: 'u' } } as any, error: null })
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const firstSocket = MockWebSocket.latest!
    firstSocket.emit('close', { code: 1012, reason: 'upstream disconnected' })

    vi.advanceTimersByTime(449)
    expect(MockWebSocket.latest).toBe(firstSocket)
    await vi.advanceTimersByTimeAsync(1)
    expect(authService.getSession).toHaveBeenCalledOnce()
    expect(MockWebSocket.latest).not.toBe(firstSocket)
    expect(callback).toHaveBeenCalledWith('RECONNECTING')
    channel.unsubscribe()
  })

  it('pauses retry while offline and reconnects immediately when online returns', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    const online = { onLine: true }
    vi.stubGlobal('navigator', online)
    const fakeWindow = stubWindow()
    vi.mocked(authService.getSession).mockResolvedValue({ session: { user: { id: 'u' } } as any, error: null })
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const firstSocket = MockWebSocket.latest!
    firstSocket.emit('open')
    online.onLine = false
    fakeWindow.dispatchEvent(new Event('offline'))
    expect(firstSocket.closeCalls[0]?.code).toBe(4001)
    firstSocket.emit('close', { code: 4001, reason: 'Browser offline' })
    expect(callback).toHaveBeenCalledWith('OFFLINE')
    vi.advanceTimersByTime(60_000)
    expect(MockWebSocket.latest).toBe(firstSocket)

    online.onLine = true
    fakeWindow.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(authService.getSession).toHaveBeenCalledOnce()
    expect(MockWebSocket.latest).not.toBe(firstSocket)
    channel.unsubscribe()
  })

  it('stops and expires the browser session when the refresh flow cannot recover authentication', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    const fakeWindow = stubWindow()
    vi.stubGlobal('navigator', { onLine: true })
    vi.mocked(authService.getSession).mockResolvedValue({ session: null, error: null })
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const firstSocket = MockWebSocket.latest!
    firstSocket.emit('close', { code: 1012 })
    await vi.advanceTimersByTimeAsync(700)
    expect(callback).toHaveBeenCalledWith('AUTH_EXPIRED')
    expect(fakeWindow.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'edulog:auth-session-expired' }))
    expect(MockWebSocket.latest).toBe(firstSocket)
    vi.advanceTimersByTime(60_000)
    expect(MockWebSocket.latest).toBe(firstSocket)
  })

  it('stops reconnecting when authentication reports a disabled account', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    const fakeWindow = stubWindow()
    vi.stubGlobal('navigator', { onLine: true })
    vi.mocked(authService.getSession).mockResolvedValue({ session: null, error: Object.assign(new Error('Account disabled'), { code: 'ACCOUNT_DISABLED' }) })
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const firstSocket = MockWebSocket.latest!
    firstSocket.emit('close', { code: 1012 })
    await vi.advanceTimersByTimeAsync(700)

    expect(callback).toHaveBeenCalledWith('ACCOUNT_DISABLED')
    expect(fakeWindow.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'edulog:account-disabled' }))
    expect(MockWebSocket.latest).toBe(firstSocket)
  })

  it('does not retry a forbidden resource or after explicit unsubscribe', () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow()
    vi.stubGlobal('navigator', { onLine: true })
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const forbiddenSocket = MockWebSocket.latest!
    forbiddenSocket.emit('close', { code: 4403, reason: 'access denied' })
    expect(callback).toHaveBeenCalledWith('PERMISSION_DENIED', 'access denied')
    vi.advanceTimersByTime(60_000)
    expect(MockWebSocket.latest).toBe(forbiddenSocket)

    channel.unsubscribe()
    forbiddenSocket.emit('close', { code: 1012 })
    vi.advanceTimersByTime(60_000)
    expect(MockWebSocket.latest).toBe(forbiddenSocket)
  })

  it('reconnects when the Phoenix heartbeat acknowledgement times out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow()
    vi.stubGlobal('navigator', { onLine: true })
    const callback = vi.fn()
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(callback)
    const socket = MockWebSocket.latest!
    socket.emit('open')
    const join = JSON.parse(socket.sent[0])
    socket.emit('message', { data: JSON.stringify({ join_ref: join.join_ref, ref: join.ref, topic: join.topic, event: 'phx_reply', payload: { status: 'ok' } }) })

    vi.advanceTimersByTime(25_000)
    expect(JSON.parse(socket.sent[1])).toMatchObject({ topic: 'phoenix', event: 'heartbeat' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(callback).toHaveBeenCalledWith('CHANNEL_ERROR', 'Realtime heartbeat timed out')
    await vi.advanceTimersByTimeAsync(700)
    expect(MockWebSocket.latest).not.toBe(socket)
    channel.unsubscribe()
  })

  it('resets the backoff only after a connection remains stable for 30 seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    stubWindow()
    vi.stubGlobal('navigator', { onLine: true })
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const channel = new ApiRealtimeChannel('report-id', 'presence-key')
    channel.subscribe(vi.fn())
    const firstSocket = MockWebSocket.latest!
    firstSocket.emit('close', { code: 1012 })
    await vi.advanceTimersByTimeAsync(500)
    const secondSocket = MockWebSocket.latest!
    expect(secondSocket).not.toBe(firstSocket)
    secondSocket.emit('open')
    const join = JSON.parse(secondSocket.sent[0])
    secondSocket.emit('message', { data: JSON.stringify({ join_ref: join.join_ref, ref: join.ref, topic: join.topic, event: 'phx_reply', payload: { status: 'ok' } }) })

    vi.advanceTimersByTime(25_000)
    const heartbeat = JSON.parse(secondSocket.sent[1])
    secondSocket.emit('message', { data: JSON.stringify({ join_ref: null, ref: heartbeat.ref, topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok' } }) })
    vi.advanceTimersByTime(5_000)
    secondSocket.emit('close', { code: 1012 })
    await vi.advanceTimersByTimeAsync(500)
    expect(MockWebSocket.latest).not.toBe(secondSocket)
    channel.unsubscribe()
  })
})
