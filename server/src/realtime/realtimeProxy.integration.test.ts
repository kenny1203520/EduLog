import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import type { ApiConfig } from '../config/config.js'

const supabaseMocks = vi.hoisted(() => ({
  createUserClient: vi.fn(),
  validateAccessToken: vi.fn(),
}))

vi.mock('../infra/supabase.js', () => supabaseMocks)

import { attachRealtimeProxy } from './realtime.js'
import { issueTicket } from './realtimeTicket.js'

const RESOURCE_ID = 'bbe2ea83-8e94-4197-83c5-f126cf027abc'
const AUTHORIZED = { data: true, error: null }
const COOKIE_SECRET = 'a'.repeat(32)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function listen(server: Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as AddressInfo).port
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    if (!server.listening) { resolve(); return }
    server.close((error) => error ? reject(error) : resolve())
  })
}

describe('realtime proxy upgrade-to-join flow', () => {
  let apiServer: Server
  let upstreamServer: Server
  let upstreamWss: WebSocketServer
  let client: WebSocket | null = null
  let upstreamConnections = 0
  let upstreamJoinFrames: string[] = []

  beforeEach(() => {
    upstreamConnections = 0
    upstreamJoinFrames = []
    supabaseMocks.validateAccessToken.mockResolvedValue(undefined)
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(async () => {
    client?.terminate()
    client = null
    for (const upstream of upstreamWss?.clients ?? []) upstream.terminate()
    await Promise.all([
      upstreamWss ? new Promise<void>((resolve) => upstreamWss.close(() => resolve())) : Promise.resolve(),
      apiServer ? closeServer(apiServer) : Promise.resolve(),
      upstreamServer ? closeServer(upstreamServer) : Promise.resolve(),
    ])
    vi.restoreAllMocks()
  })

  async function startProxy(options: {
    upstreamHandshakeDelayMs?: number
    onUpstreamUpgrade?: () => void
    proxyTimeouts?: { authorizationMs?: number; upstreamConnectMs?: number }
  } = {}) {
    upstreamServer = createServer()
    const upstreamPort = await listen(upstreamServer)
    upstreamWss = new WebSocketServer({ noServer: true })
    upstreamServer.on('upgrade', (request, socket, head) => {
      options.onUpstreamUpgrade?.()
      const accept = () => {
        if (socket.destroyed) return
        upstreamWss.handleUpgrade(request, socket, head, (upstream) => upstreamWss.emit('connection', upstream, request))
      }
      if (options.upstreamHandshakeDelayMs) setTimeout(accept, options.upstreamHandshakeDelayMs)
      else accept()
    })
    upstreamWss.on('connection', (upstream) => {
      upstreamConnections += 1
      upstream.on('message', (raw) => {
        const text = raw.toString()
        const frame = JSON.parse(text)
        if (frame.event === 'phx_join') {
          upstreamJoinFrames.push(text)
          upstream.send(JSON.stringify({
            join_ref: frame.join_ref,
            ref: frame.ref,
            topic: frame.topic,
            event: 'phx_reply',
            payload: { status: 'ok', response: {} },
          }))
        }
      })
    })

    apiServer = createServer()
    const config = {
      NODE_ENV: 'test',
      EDULOG_WEB_BASE_URL: 'http://localhost:4173',
      API_ALLOWED_ORIGINS: '',
      API_EXTENSION_ALLOWED_ORIGINS: '',
      SUPABASE_REALTIME_URL: `ws://127.0.0.1:${upstreamPort}/socket/websocket`,
      SUPABASE_ANON_KEY: 'test-anon-key',
      COOKIE_SECRET,
    } as ApiConfig
    attachRealtimeProxy(apiServer, {} as never, config, options.proxyTimeouts)
    const apiPort = await listen(apiServer)
    return `ws://127.0.0.1:${apiPort}/api/realtime`
  }

  function connect(url: string, parameter: 'class_session' | 'room') {
    client = new WebSocket(`${url}?${parameter}=${RESOURCE_ID}`, {
      headers: { Cookie: 'edulog_access=test-access-token', Origin: 'http://localhost:5173' },
    })
    return client
  }

  function connectWithTicket(url: string, parameter: 'class_session' | 'room', ticket: string) {
    client = new WebSocket(`${url}?${parameter}=${RESOURCE_ID}&ticket=${encodeURIComponent(ticket)}`, {
      headers: { Origin: 'http://localhost:5173' },
    })
    return client
  }

  function upgradeStatus(socket: WebSocket) {
    return new Promise<number>((resolve, reject) => {
      socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
      socket.once('open', () => reject(new Error('Upgrade unexpectedly succeeded')))
      socket.once('error', () => {})
    })
  }

  function sendJoin(socket: WebSocket, topic: string) {
    socket.send(JSON.stringify({
      join_ref: 'join-1',
      ref: 'join-1',
      topic,
      event: 'phx_join',
      payload: { config: { private: true }, access_token: '' },
    }))
  }

  it.each([
    ['class-session', 'class_session', 'realtime:class-session:'],
    ['report', 'room', 'realtime:room:'],
  ] as const)('buffers the immediate %s phx_join until delayed authorization succeeds', async (_label, parameter, topicPrefix) => {
    const authorization = deferred<typeof AUTHORIZED>()
    const rpc = vi.fn(() => authorization.promise)
    supabaseMocks.createUserClient.mockReturnValue({ rpc })
    const url = await startProxy()
    const socket = connect(url, parameter)
    await once(socket, 'open')
    const topic = `${topicPrefix}${RESOURCE_ID}`
    const reply = once(socket, 'message').then(([raw]) => JSON.parse(raw.toString()))
    sendJoin(socket, topic)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(upstreamConnections).toBe(0)

    authorization.resolve(AUTHORIZED)
    const joined = await reply
    expect(joined).toMatchObject({ topic, event: 'phx_reply', ref: 'join-1', payload: { status: 'ok' } })
    expect(upstreamConnections).toBe(1)
    expect(upstreamJoinFrames).toHaveLength(1)
    expect(JSON.parse(upstreamJoinFrames[0]!).payload.access_token).toBe('test-access-token')
  })

  it('accepts a one-time ticket in place of the session cookie', async () => {
    supabaseMocks.createUserClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue(AUTHORIZED) })
    const url = await startProxy()
    const ticket = issueTicket(COOKIE_SECRET, { accessToken: 'ticket-access-token', resourceId: RESOURCE_ID, channelKind: 'report' })
    const socket = connectWithTicket(url, 'room', ticket)
    await once(socket, 'open')
    const topic = `realtime:room:${RESOURCE_ID}`
    const reply = once(socket, 'message').then(([raw]) => JSON.parse(raw.toString()))
    sendJoin(socket, topic)

    expect(await reply).toMatchObject({ topic, event: 'phx_reply', payload: { status: 'ok' } })
    expect(supabaseMocks.validateAccessToken).toHaveBeenCalledWith(expect.anything(), 'ticket-access-token', expect.anything())
    expect(supabaseMocks.createUserClient).toHaveBeenCalledWith(expect.anything(), 'ticket-access-token')
    expect(JSON.parse(upstreamJoinFrames[0]!).payload.access_token).toBe('ticket-access-token')
  })

  it('rejects a ticket issued for another channel kind, and a reused ticket', async () => {
    supabaseMocks.createUserClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue(AUTHORIZED) })
    const url = await startProxy()
    const reportTicket = issueTicket(COOKIE_SECRET, { accessToken: 'ticket-access-token', resourceId: RESOURCE_ID, channelKind: 'report' })
    expect(await upgradeStatus(connectWithTicket(url, 'class_session', reportTicket))).toBe(401)

    const ticket = issueTicket(COOKIE_SECRET, { accessToken: 'ticket-access-token', resourceId: RESOURCE_ID, channelKind: 'class_session' })
    const first = connectWithTicket(url, 'class_session', ticket)
    await once(first, 'open')
    first.terminate()
    expect(await upgradeStatus(connectWithTicket(url, 'class_session', ticket))).toBe(401)
    expect(await upgradeStatus(connectWithTicket(url, 'class_session', 'tampered-ticket'))).toBe(401)
  })

  it('does not open an upstream connection when delayed authorization denies access', async () => {
    const authorization = deferred<typeof AUTHORIZED>()
    supabaseMocks.createUserClient.mockReturnValue({ rpc: vi.fn(() => authorization.promise) })
    const url = await startProxy()
    const socket = connect(url, 'class_session')
    await once(socket, 'open')
    sendJoin(socket, `realtime:class-session:${RESOURCE_ID}`)
    const closed = once(socket, 'close').then(([code]) => code)

    authorization.resolve({ data: false, error: null })
    expect(await closed).toBe(4403)
    expect(upstreamConnections).toBe(0)
  })

  it('keeps the join queued while the authorized upstream handshake is delayed', async () => {
    supabaseMocks.createUserClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue(AUTHORIZED) })
    const url = await startProxy({ upstreamHandshakeDelayMs: 80 })
    const socket = connect(url, 'class_session')
    await once(socket, 'open')
    const topic = `realtime:class-session:${RESOURCE_ID}`
    const reply = once(socket, 'message').then(([raw]) => JSON.parse(raw.toString()))
    sendJoin(socket, topic)

    expect(await reply).toMatchObject({ topic, event: 'phx_reply', ref: 'join-1', payload: { status: 'ok' } })
    expect(upstreamConnections).toBe(1)
    expect(upstreamJoinFrames).toHaveLength(1)
  })

  it('closes retryably when the upstream websocket handshake times out', async () => {
    let signalUpgradeStarted!: () => void
    const upgradeStarted = new Promise<void>((resolve) => { signalUpgradeStarted = resolve })
    supabaseMocks.createUserClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue(AUTHORIZED) })
    const url = await startProxy({
      upstreamHandshakeDelayMs: 150,
      onUpstreamUpgrade: signalUpgradeStarted,
      proxyTimeouts: { upstreamConnectMs: 25 },
    })
    const socket = connect(url, 'room')
    await once(socket, 'open')
    sendJoin(socket, `realtime:room:${RESOURCE_ID}`)
    const closed = once(socket, 'close')
    await upgradeStarted

    const [code] = await closed
    expect(code).toBe(1012)
    await new Promise((resolve) => setTimeout(resolve, 175))
    expect(apiServer.listening).toBe(true)
    expect(upstreamConnections).toBe(0)
  })

  it('closes retryably when the authorization service fails', async () => {
    const authorization = deferred<typeof AUTHORIZED>()
    supabaseMocks.createUserClient.mockReturnValue({ rpc: vi.fn(() => authorization.promise) })
    const url = await startProxy()
    const socket = connect(url, 'room')
    await once(socket, 'open')
    sendJoin(socket, `realtime:room:${RESOURCE_ID}`)
    const closed = once(socket, 'close').then(([code]) => code)

    authorization.reject(new Error('authorization unavailable'))
    expect(await closed).toBe(1012)
    expect(upstreamConnections).toBe(0)
  })

  it('times out a stalled authorization check and ignores its late success', async () => {
    const authorization = deferred<typeof AUTHORIZED>()
    supabaseMocks.createUserClient.mockReturnValue({ rpc: vi.fn(() => authorization.promise) })
    const url = await startProxy({ proxyTimeouts: { authorizationMs: 30 } })
    const socket = connect(url, 'class_session')
    await once(socket, 'open')
    sendJoin(socket, `realtime:class-session:${RESOURCE_ID}`)

    const [code] = await once(socket, 'close')
    expect(code).toBe(1012)
    authorization.resolve(AUTHORIZED)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(upstreamConnections).toBe(0)
  })

  it('keeps the proxy alive when the browser disconnects during an upstream handshake', async () => {
    let signalUpgradeStarted!: () => void
    const upgradeStarted = new Promise<void>((resolve) => { signalUpgradeStarted = resolve })
    supabaseMocks.createUserClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue(AUTHORIZED) })
    const url = await startProxy({ upstreamHandshakeDelayMs: 80, onUpstreamUpgrade: signalUpgradeStarted })
    const first = connect(url, 'class_session')
    await once(first, 'open')
    sendJoin(first, `realtime:class-session:${RESOURCE_ID}`)
    await upgradeStarted

    const firstClosed = once(first, 'close')
    first.close(4000, 'Timed out waiting for the realtime channel join reply')
    await firstClosed
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(apiServer.listening).toBe(true)
    expect(upstreamConnections).toBe(0)

    const second = connect(url, 'class_session')
    await once(second, 'open')
    const reply = once(second, 'message').then(([raw]) => JSON.parse(raw.toString()))
    sendJoin(second, `realtime:class-session:${RESOURCE_ID}`)
    expect(await reply).toMatchObject({ event: 'phx_reply', payload: { status: 'ok' } })
    expect(upstreamConnections).toBe(1)
  })

  it('closes explicitly when the pre-authorization message queue is full', async () => {
    const authorization = deferred<typeof AUTHORIZED>()
    supabaseMocks.createUserClient.mockReturnValue({ rpc: vi.fn(() => authorization.promise) })
    const url = await startProxy()
    const socket = connect(url, 'room')
    await once(socket, 'open')
    const topic = `realtime:room:${RESOURCE_ID}`
    const closed = once(socket, 'close').then(([code]) => code)
    for (let index = 1; index <= 17; index += 1) {
      socket.send(JSON.stringify({ join_ref: 'join-1', ref: String(index), topic, event: 'phx_leave', payload: {} }))
    }

    expect(await closed).toBe(1013)
    authorization.resolve(AUTHORIZED)
    expect(upstreamConnections).toBe(0)
  })

  it('stops the delayed authorization flow if the browser disconnects before it completes', async () => {
    const authorization = deferred<typeof AUTHORIZED>()
    supabaseMocks.createUserClient.mockReturnValue({ rpc: vi.fn(() => authorization.promise) })
    const url = await startProxy()
    const socket = connect(url, 'class_session')
    await once(socket, 'open')
    sendJoin(socket, `realtime:class-session:${RESOURCE_ID}`)
    const serverClosed = new Promise<void>((resolve) => {
      // The browser close waits for the server's close listener and cleanup.
      socket.once('close', () => resolve())
    })
    socket.close()
    await serverClosed
    authorization.resolve(AUTHORIZED)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(upstreamConnections).toBe(0)
  })
})
