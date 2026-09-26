import { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage, Server } from 'node:http'
import type { Socket } from 'node:net'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiConfig } from './config.js'
import { createUserClient, validateAccessToken } from './supabase.js'
import { resolveAllowedOrigins } from './app.js'

function cookieValue(header: string | undefined, name: string) {
  return header?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1)
}

const MAX_MESSAGE_BYTES = 1024 * 1024
const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000

export function resolveRealtimeUrl(config: ApiConfig): URL {
  const realtimeUrl = config.SUPABASE_REALTIME_URL
  const upstream = new URL(realtimeUrl || config.SUPABASE_URL)
  if (!realtimeUrl) {
    upstream.protocol = upstream.protocol === 'https:' ? 'wss:' : 'ws:'
    upstream.pathname = '/realtime/v1/websocket'
    upstream.search = ''
  }
  if (!upstream.pathname || upstream.pathname === '/') upstream.pathname = '/socket/websocket'
  if (!upstream.searchParams.has('apikey')) upstream.searchParams.set('apikey', config.SUPABASE_ANON_KEY)
  // ApiRealtimeChannel speaks Phoenix's JSON-array 1.0.0 wire format.
  // Override stale environment query parameters to prevent serializer drift.
  upstream.searchParams.set('vsn', '1.0.0')
  return upstream
}

function rejectUpgrade(socket: Socket, status: number, reason: string) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

function parseMessage(raw: WebSocket.RawData): unknown[] | null {
  const text = raw.toString()
  if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) return null
  try {
    const message = JSON.parse(text)
    return Array.isArray(message) && message.length === 5 ? message : null
  } catch {
    return null
  }
}

export function normalizeClientMessage(raw: WebSocket.RawData, roomTopic: string, accessToken: string) {
  const message = parseMessage(raw)
  if (!message) return null
  const [joinRef, ref, topic, event, payload] = message
  if ((joinRef !== null && typeof joinRef !== 'string') || (ref !== null && typeof ref !== 'string')) return null
  if (typeof topic !== 'string' || typeof event !== 'string') return null
  const isHeartbeat = topic === 'phoenix' && event === 'heartbeat'
  const isRoomMessage = topic === roomTopic
  if (!isHeartbeat && !isRoomMessage) return null
  if (!['phx_join', 'phx_leave', 'broadcast', 'presence', 'heartbeat'].includes(event)) return null
  if (isHeartbeat && event !== 'heartbeat') return null
  if (event === 'phx_join') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    message[4] = { ...payload, access_token: accessToken }
  }
  return JSON.stringify(message)
}

export function attachRealtimeProxy(server: Server, adminClient: SupabaseClient, config: ApiConfig) {
  const socketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  server.on('upgrade', async (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://edulog.local')
    if (url.pathname !== '/api/realtime') return
    const origin = request.headers.origin
    if (origin && !resolveAllowedOrigins(config).includes(origin)) { rejectUpgrade(socket, 403, 'Forbidden'); return }
    const token = cookieValue(request.headers.cookie, 'edulog_access')
    const roomId = url.searchParams.get('room')
    if (!token) { rejectUpgrade(socket, 401, 'Unauthorized'); return }
    if (!roomId || !/^[0-9a-f-]{36}$/i.test(roomId)) { rejectUpgrade(socket, 400, 'Bad Request'); return }
    try {
      await validateAccessToken(adminClient, token, config)
      const userClient = createUserClient(config, token)
      const authorization = await userClient.rpc('can_access_report', { p_report_id: roomId, p_permission_key: 'teaching.reports.read' })
      if (authorization.error || authorization.data !== true) { rejectUpgrade(socket, 403, 'Forbidden'); return }
    } catch {
      rejectUpgrade(socket, 401, 'Unauthorized'); return
    }
    socketServer.handleUpgrade(request, socket, head, (client) => {
      const upstream = resolveRealtimeUrl(config)
      const upstreamSocket = new WebSocket(upstream.toString(), { maxPayload: MAX_MESSAGE_BYTES, handshakeTimeout: UPSTREAM_CONNECT_TIMEOUT_MS })
      const roomTopic = `realtime:room:${roomId}`
      const pending: string[] = []
      let upstreamReady = false
      const flush = () => { while (pending.length && upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(pending.shift()!) }
      const forward = (raw: WebSocket.RawData) => {
        const normalized = normalizeClientMessage(raw, roomTopic, token)
        if (!normalized) return
        if (upstreamReady && upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(normalized)
        else if (pending.length < 16) pending.push(normalized)
      }
      client.on('message', forward)
      upstreamSocket.on('open', () => {
        upstreamReady = true
        console.info(JSON.stringify({ event: 'realtime_upstream_connected' }))
        flush()
      })
      upstreamSocket.on('message', (message) => { if (client.readyState === WebSocket.OPEN) client.send(message) })
      upstreamSocket.on('close', (code) => {
        const log = code === 1000 ? console.info : console.warn
        log(JSON.stringify({ event: 'realtime_upstream_closed', close_code: code }))
        if (client.readyState === WebSocket.OPEN) client.close(code === 1000 ? 1000 : 1011, 'Realtime upstream disconnected')
      })
      client.on('close', () => upstreamSocket.close())
      client.on('error', () => upstreamSocket.close())
      upstreamSocket.on('error', (error: Error) => {
        // Keep credentials and the upstream URL out of server logs.
        console.error(JSON.stringify({ event: 'realtime_upstream_error', error_type: error.name || 'Error' }))
        if (client.readyState === WebSocket.OPEN) client.close(1011, 'Realtime service unavailable')
      })
    })
  })
}
