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
  // ApiRealtimeChannel speaks Phoenix's JSON-object 1.0.0 wire format.
  // Override stale environment query parameters to prevent serializer drift.
  upstream.searchParams.set('vsn', '1.0.0')
  return upstream
}

/** Phoenix 1.0.0 uses text JSON frames. ws delivers both text and binary frames as Buffers. */
export function decodeUpstreamTextFrame(raw: WebSocket.RawData, isBinary: boolean): string | null {
  if (isBinary) return null
  return raw.toString()
}

function rejectUpgrade(socket: Socket, status: number, reason: string) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

function parseMessage(raw: WebSocket.RawData): Record<string, unknown> | null {
  const text = raw.toString()
  if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) return null
  try {
    const message = JSON.parse(text)
    return message && typeof message === 'object' && !Array.isArray(message) ? message : null
  } catch {
    return null
  }
}

export function normalizeClientMessage(
  raw: WebSocket.RawData,
  roomTopic: string,
  accessToken: string,
  isBinary = false,
  channelKind: 'report' | 'class_session' = 'report',
) {
  if (isBinary) return null
  const message = parseMessage(raw)
  if (!message) return null
  const { join_ref: joinRef, ref, topic, event, payload } = message
  if ((joinRef !== null && typeof joinRef !== 'string') || (ref !== null && typeof ref !== 'string')) return null
  if (typeof topic !== 'string' || typeof event !== 'string') return null
  const isHeartbeat = topic === 'phoenix' && event === 'heartbeat'
  const isRoomMessage = topic === roomTopic
  if (!isHeartbeat && !isRoomMessage) return null
  const supportedRoomEvents = channelKind === 'class_session'
    ? ['phx_join', 'phx_leave']
    : ['phx_join', 'phx_leave', 'broadcast', 'presence']
  if (!supportedRoomEvents.includes(event) && event !== 'heartbeat') return null
  if (isHeartbeat && event !== 'heartbeat') return null
  if (event === 'phx_join') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    message.payload = { ...payload, access_token: accessToken }
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
    const classSessionId = url.searchParams.get('class_session')
    const roomId = url.searchParams.get('room')
    const channelKind = classSessionId ? 'class_session' : 'report'
    const resourceId = classSessionId || roomId
    if (!token) { rejectUpgrade(socket, 401, 'Unauthorized'); return }
    if (!resourceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resourceId) || (classSessionId && roomId)) { rejectUpgrade(socket, 400, 'Bad Request'); return }
    try {
      await validateAccessToken(adminClient, token, config)
      const userClient = createUserClient(config, token)
      if (channelKind === 'class_session') {
        const [sessionRead, sessionList] = await Promise.all([
          userClient.rpc('can_access_class_session', { p_class_session_id: resourceId, p_permission_key: 'teaching.class_sessions.read' }),
          userClient.rpc('can_access_class_session', { p_class_session_id: resourceId, p_permission_key: 'teaching.class_sessions.list' }),
        ])
        if ((sessionRead.error || sessionRead.data !== true) && (sessionList.error || sessionList.data !== true)) {
          rejectUpgrade(socket, 403, 'Forbidden'); return
        }
      } else {
        const authorization = await userClient.rpc('can_access_report', { p_report_id: resourceId, p_permission_key: 'teaching.reports.read' })
        if (authorization.error || authorization.data !== true) { rejectUpgrade(socket, 403, 'Forbidden'); return }
      }
    } catch {
      rejectUpgrade(socket, 401, 'Unauthorized'); return
    }
    socketServer.handleUpgrade(request, socket, head, (client) => {
      const upstream = resolveRealtimeUrl(config)
      const upstreamSocket = new WebSocket(upstream.toString(), { maxPayload: MAX_MESSAGE_BYTES, handshakeTimeout: UPSTREAM_CONNECT_TIMEOUT_MS })
      const roomTopic = channelKind === 'class_session'
        ? `realtime:class-session:${resourceId}`
        : `realtime:room:${resourceId}`
      const pending: string[] = []
      let upstreamReady = false
      const flush = () => { while (pending.length && upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(pending.shift()!) }
      const forward = (raw: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) {
          console.warn(JSON.stringify({ event: 'realtime_protocol_error', direction: 'client', reason: 'binary_frame' }))
          if (client.readyState === WebSocket.OPEN) client.close(1003, 'Phoenix 1.0 requires text frames')
          upstreamSocket.close()
          return
        }
        const normalized = normalizeClientMessage(raw, roomTopic, token, isBinary, channelKind)
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
      upstreamSocket.on('message', (message, isBinary) => {
        if (isBinary) {
          console.warn(JSON.stringify({ event: 'realtime_protocol_error', direction: 'upstream', reason: 'binary_frame' }))
          if (client.readyState === WebSocket.OPEN) client.close(1003, 'Phoenix 1.0 requires text frames')
          upstreamSocket.close()
          return
        }
        const text = decodeUpstreamTextFrame(message, false)
        if (text !== null && client.readyState === WebSocket.OPEN) client.send(text, { binary: false })
      })
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
