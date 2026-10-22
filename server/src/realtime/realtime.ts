import { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage, Server } from 'node:http'
import type { Socket } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiConfig } from '../config/config.js'
import { createUserClient, validateAccessToken } from '../infra/supabase.js'
import { resolveAllowedOrigins } from '../app.js'
import { monitorRealtimeSocket } from './realtimeHeartbeat.js'
import { redeemTicket } from './realtimeTicket.js'

function cookieValue(header: string | undefined, name: string) {
  return header?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1)
}

const MAX_MESSAGE_BYTES = 1024 * 1024
const AUTHORIZATION_TIMEOUT_MS = 10_000
const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000
export const REALTIME_CLOSE_RETRYABLE = 1012
export const REALTIME_CLOSE_FORBIDDEN = 4403

export function classifyRealtimeClientCloseReason(reason: string): string {
  if (/timed out opening the realtime websocket/i.test(reason)) return 'websocket_open_timeout'
  if (/timed out waiting for the realtime channel join reply/i.test(reason)) return 'channel_join_timeout'
  if (/realtime heartbeat timed out/i.test(reason)) return 'heartbeat_timeout'
  if (/phoenix 1\.0/i.test(reason)) return 'protocol_error'
  if (/permission|authori[sz]|denied/i.test(reason)) return 'permission_denied'
  return 'other'
}

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

export function attachRealtimeProxy(
  server: Server,
  adminClient: SupabaseClient,
  config: ApiConfig,
  timeouts: { authorizationMs?: number; upstreamConnectMs?: number } = {},
) {
  const authorizationTimeoutMs = timeouts.authorizationMs ?? AUTHORIZATION_TIMEOUT_MS
  const upstreamConnectTimeoutMs = timeouts.upstreamConnectMs ?? UPSTREAM_CONNECT_TIMEOUT_MS
  const socketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  server.on('upgrade', async (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://edulog.local')
    if (url.pathname !== '/api/realtime') return
    const connectionId = randomUUID()
    const requestStartedAt = Date.now()
    const log = (event: string, fields: Record<string, unknown> = {}) => console.info(JSON.stringify({
      event,
      connection_id: connectionId,
      elapsed_ms: Date.now() - requestStartedAt,
      ...fields,
    }))
    const origin = request.headers.origin
    if (origin && !resolveAllowedOrigins(config).includes(origin)) { log('realtime_upgrade_rejected', { phase: 'origin', outcome: 'denied' }); rejectUpgrade(socket, 403, 'Forbidden'); return }
    const cookieToken = cookieValue(request.headers.cookie, 'edulog_access')
    const ticket = url.searchParams.get('ticket')
    const classSessionId = url.searchParams.get('class_session')
    const roomId = url.searchParams.get('room')
    const channelKind = classSessionId ? 'class_session' : 'report'
    const resourceId = classSessionId || roomId
    if (!cookieToken && !ticket) { log('realtime_upgrade_rejected', { phase: 'authentication', outcome: 'missing_cookie' }); rejectUpgrade(socket, 401, 'Unauthorized'); return }
    if (!resourceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resourceId) || (classSessionId && roomId)) { log('realtime_upgrade_rejected', { phase: 'request_validation', outcome: 'invalid_resource' }); rejectUpgrade(socket, 400, 'Bad Request'); return }
    const resourceFingerprint = createHash('sha256').update(resourceId).digest('hex').slice(0, 12)
    // An extension side panel frames the web app; the browser omits the
    // SameSite cookie on that frame's WebSocket handshake, so the client
    // presents a one-time ticket from POST /api/realtime/ticket instead.
    const token = cookieToken || redeemTicket(config.COOKIE_SECRET, ticket, resourceId, channelKind)
    if (!token) { log('realtime_upgrade_rejected', { phase: 'authentication', outcome: 'invalid_ticket', channel_kind: channelKind, resource_fingerprint: resourceFingerprint }); rejectUpgrade(socket, 401, 'Unauthorized'); return }
    if (!cookieToken) log('realtime_authentication', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, outcome: 'ticket' })
    const authenticationStartedAt = Date.now()
    try {
      await validateAccessToken(adminClient, token, config)
      log('realtime_authentication', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, outcome: 'allowed', duration_ms: Date.now() - authenticationStartedAt })
    } catch {
      log('realtime_upgrade_rejected', { phase: 'authentication', outcome: cookieToken ? 'invalid_cookie' : 'invalid_ticket_token', channel_kind: channelKind, resource_fingerprint: resourceFingerprint, duration_ms: Date.now() - authenticationStartedAt })
      rejectUpgrade(socket, 401, 'Unauthorized'); return
    }
    socketServer.handleUpgrade(request, socket, head, (client) => {
      log('realtime_downstream_upgraded', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint })
      const roomTopic = channelKind === 'class_session'
        ? `realtime:class-session:${resourceId}`
        : `realtime:room:${resourceId}`
      const pending: string[] = []
      let authorized = false
      let upstreamReady = false
      let closed = false
      let upstreamSocket: WebSocket | null = null
      let joinRef: string | null = null
      let joinRequestedAt: number | null = null
      let stopClientLiveness = () => {}
      let stopUpstreamLiveness = () => {}
      let authorizationTimer: ReturnType<typeof setTimeout> | null = null
      let cancelAuthorization: ((error: Error) => void) | null = null
      let upstreamListenersDisposed = false

      const disposeUpstreamListeners = () => {
        if (!upstreamSocket || upstreamListenersDisposed || upstreamSocket.readyState !== WebSocket.CLOSED) return
        upstreamListenersDisposed = true
        upstreamSocket.off('close', onUpstreamClose)
        upstreamSocket.off('error', onUpstreamError)
        upstreamSocket.off('message', onUpstreamMessage)
      }
      const stopUpstream = () => {
        if (!upstreamSocket) return
        if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.close()
        else if (upstreamSocket.readyState === WebSocket.CONNECTING) {
          try {
            // ws may emit an asynchronous error when a connecting socket is
            // terminated. Keep its error listener until the close event.
            upstreamSocket.terminate()
          } catch {
            // The socket can reach CLOSED between the state check and terminate.
            disposeUpstreamListeners()
          }
        } else disposeUpstreamListeners()
      }

      const cleanup = () => {
        pending.length = 0
        if (authorizationTimer) clearTimeout(authorizationTimer)
        authorizationTimer = null
        cancelAuthorization?.(new Error('Realtime connection closed'))
        cancelAuthorization = null
        stopClientLiveness()
        stopUpstreamLiveness()
        client.off('message', forward)
        client.off('close', onClientClose)
        client.off('error', onClientError)
        disposeUpstreamListeners()
      }
      const closePair = (code: number, reason: string) => {
        if (closed) return
        closed = true
        log('realtime_connection_ended', {
          channel_kind: channelKind,
          resource_fingerprint: resourceFingerprint,
          close_code: code,
          reason_category: code === REALTIME_CLOSE_FORBIDDEN ? 'permission_denied' : code === 1003 ? 'protocol_error' : code === 1013 ? 'initialization_queue_full' : code === REALTIME_CLOSE_RETRYABLE ? 'retryable_transport_failure' : 'closed',
        })
        cleanup()
        if (client.readyState === WebSocket.OPEN) client.close(code, reason)
        if (upstreamSocket?.readyState === WebSocket.OPEN && code === 1003) upstreamSocket.close(code, reason)
        else stopUpstream()
      }
      const onClientClose = (code: number, reason: Buffer) => {
        if (closed) return
        log('realtime_socket_closed', { side: 'client', channel_kind: channelKind, resource_fingerprint: resourceFingerprint, close_code: code, reason_category: classifyRealtimeClientCloseReason(reason.toString()) })
        closed = true
        cleanup()
        stopUpstream()
      }
      const onClientError = () => closePair(REALTIME_CLOSE_RETRYABLE, 'Browser connection lost')
      const onUpstreamClose = (code: number) => {
        disposeUpstreamListeners()
        if (closed) return
        log('realtime_upstream_closed', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, close_code: code, outcome: code === 1000 ? 'normal' : 'retryable' })
        closePair(REALTIME_CLOSE_RETRYABLE, 'Realtime upstream disconnected')
      }
      const onUpstreamError = (error: Error) => {
        if (closed) {
          log('realtime_upstream_error', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, outcome: 'during_cleanup', error_type: error.name || 'Error', error_code: (error as NodeJS.ErrnoException).code || null })
          return
        }
        log('realtime_upstream_error', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, error_type: error.name || 'Error', error_code: (error as NodeJS.ErrnoException).code || null })
        closePair(REALTIME_CLOSE_RETRYABLE, 'Realtime service unavailable')
      }
      const forwardUpstreamMessage = (message: WebSocket.RawData, isBinary: boolean) => {
        if (closed) return
        if (isBinary) {
          console.warn(JSON.stringify({ event: 'realtime_protocol_error', direction: 'upstream', reason: 'binary_frame' }))
          closePair(1003, 'Phoenix 1.0 requires text frames')
          return
        }
        const text = decodeUpstreamTextFrame(message, false)
        if (text !== null) {
          try {
            const frame = JSON.parse(text) as Record<string, any>
            if (frame.topic === roomTopic && frame.event === 'phx_reply' && frame.ref === joinRef && (frame.payload?.status === 'ok' || frame.payload?.status === 'error')) {
              log('realtime_channel_join_result', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, outcome: frame.payload.status, duration_ms: joinRequestedAt === null ? null : Date.now() - joinRequestedAt, reason_category: frame.payload.status === 'error' ? (typeof frame.payload?.response?.reason === 'string' && /authori[sz]|permission|denied/i.test(frame.payload.response.reason) ? 'permission' : 'upstream_rejected') : undefined })
              joinRequestedAt = null
            }
          } catch { /* Forward invalid text as-is; the browser will report a protocol failure. */ }
        }
        if (text !== null && client.readyState === WebSocket.OPEN) client.send(text, { binary: false })
      }
      const onUpstreamMessage = (message: WebSocket.RawData, isBinary: boolean) => forwardUpstreamMessage(message, isBinary)
      const flush = () => {
        if (closed || !authorized || !upstreamSocket || !upstreamReady || upstreamSocket.readyState !== WebSocket.OPEN) return
        while (pending.length && upstreamSocket.readyState === WebSocket.OPEN && client.readyState === WebSocket.OPEN) {
          const normalized = pending.shift()!
          const frame = parseMessage(Buffer.from(normalized))
          if (frame?.event === 'phx_join' && frame.topic === roomTopic) {
            log('realtime_channel_join_forwarded', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, queued: true })
          }
          upstreamSocket.send(normalized)
        }
      }
      const forward = (raw: WebSocket.RawData, isBinary: boolean) => {
        if (closed) return
        if (isBinary) {
          console.warn(JSON.stringify({ event: 'realtime_protocol_error', direction: 'client', reason: 'binary_frame' }))
          closePair(1003, 'Phoenix 1.0 requires text frames')
          return
        }
        const normalized = normalizeClientMessage(raw, roomTopic, token, isBinary, channelKind)
        if (!normalized) return
        const frame = parseMessage(Buffer.from(normalized))
        if (!frame) return
        if (frame.event === 'phx_join' && frame.topic === roomTopic && typeof frame.ref === 'string') {
          joinRef = frame.ref
          joinRequestedAt = Date.now()
          log('realtime_channel_join_requested', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint })
        }
        if (authorized && upstreamReady && upstreamSocket?.readyState === WebSocket.OPEN) {
          if (frame.event === 'phx_join' && frame.topic === roomTopic) {
            log('realtime_channel_join_forwarded', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, queued: false })
          }
          upstreamSocket.send(normalized)
          return
        }
        if (pending.length >= 16) {
          closePair(1013, 'Realtime initialization queue exceeded')
          return
        }
        pending.push(normalized)
      }
      const onClientLivenessTimeout = () => {
        log('realtime_liveness_timeout', { side: 'client', channel_kind: channelKind, resource_fingerprint: resourceFingerprint })
        closePair(REALTIME_CLOSE_RETRYABLE, 'Browser did not respond')
      }

      // Register before starting async authorization: clients can send phx_join
      // immediately after the HTTP upgrade response reaches the browser.
      client.on('message', forward)
      client.on('close', onClientClose)
      client.on('error', onClientError)
      stopClientLiveness = monitorRealtimeSocket(client, onClientLivenessTimeout)

      const authorizationStartedAt = Date.now()
      void (async () => {
        try {
          const authorizationChecks = async () => {
            const userClient = createUserClient(config, token)
            if (channelKind === 'class_session') {
              const [sessionRead, sessionList] = await Promise.all([
                userClient.rpc('can_access_class_session', { p_class_session_id: resourceId, p_permission_key: 'teaching.class_sessions.read' }),
                userClient.rpc('can_access_class_session', { p_class_session_id: resourceId, p_permission_key: 'teaching.class_sessions.list' }),
              ])
              if (sessionRead.error || sessionList.error) throw new Error('Realtime authorization check failed')
              return sessionRead.data === true || sessionList.data === true
            }
            const authorization = await userClient.rpc('can_access_report', { p_report_id: resourceId, p_permission_key: 'teaching.reports.read' })
            if (authorization.error) throw new Error('Realtime authorization check failed')
            return authorization.data === true
          }
          const authorizedResult = await Promise.race([
            authorizationChecks(),
            new Promise<never>((_resolve, reject) => {
              cancelAuthorization = reject
              authorizationTimer = setTimeout(() => reject(new Error('Realtime authorization timed out')), authorizationTimeoutMs)
            }),
          ])
          if (authorizationTimer) clearTimeout(authorizationTimer)
          authorizationTimer = null
          cancelAuthorization = null
          if (!authorizedResult) {
            log('realtime_authorization', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, outcome: 'denied', duration_ms: Date.now() - authorizationStartedAt })
            closePair(REALTIME_CLOSE_FORBIDDEN, 'Realtime resource access denied')
            return
          }
        } catch (error) {
          if (authorizationTimer) clearTimeout(authorizationTimer)
          authorizationTimer = null
          cancelAuthorization = null
          if (!closed) {
            const authorizationTimedOut = error instanceof Error && error.message === 'Realtime authorization timed out'
            log('realtime_authorization', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, outcome: 'error', reason_category: authorizationTimedOut ? 'authorization_timeout' : 'authorization_unavailable', error_type: error instanceof Error ? error.name : 'Error', duration_ms: Date.now() - authorizationStartedAt })
            closePair(REALTIME_CLOSE_RETRYABLE, 'Realtime authorization service unavailable')
          }
          return
        }
        if (closed || client.readyState !== WebSocket.OPEN) return
        authorized = true
        log('realtime_authorization', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, outcome: 'allowed', duration_ms: Date.now() - authorizationStartedAt })

        const upstream = resolveRealtimeUrl(config)
        log('realtime_upstream_connecting', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint })
        const upstreamStartedAt = Date.now()
        upstreamSocket = new WebSocket(upstream.toString(), { maxPayload: MAX_MESSAGE_BYTES, handshakeTimeout: upstreamConnectTimeoutMs })
        // Attach lifecycle guards synchronously after construction, before the
        // browser can close and trigger cleanup while this socket is CONNECTING.
        upstreamSocket.on('error', onUpstreamError)
        upstreamSocket.on('close', onUpstreamClose)
        upstreamSocket.on('message', onUpstreamMessage)
        upstreamSocket.on('unexpected-response', (_responseRequest, response) => {
          log('realtime_upstream_handshake_rejected', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, status_code: response.statusCode ?? null, duration_ms: Date.now() - upstreamStartedAt })
          closePair(REALTIME_CLOSE_RETRYABLE, 'Realtime service rejected the connection')
        })
        upstreamSocket.on('open', () => {
          if (closed) { upstreamSocket?.terminate(); return }
          upstreamReady = true
          stopUpstreamLiveness = monitorRealtimeSocket(upstreamSocket!, () => {
            log('realtime_liveness_timeout', { side: 'upstream', channel_kind: channelKind, resource_fingerprint: resourceFingerprint })
            closePair(REALTIME_CLOSE_RETRYABLE, 'Realtime upstream did not respond')
          })
          log('realtime_upstream_connected', { channel_kind: channelKind, resource_fingerprint: resourceFingerprint, duration_ms: Date.now() - upstreamStartedAt })
          flush()
        })
      })()
    })
  })
}
