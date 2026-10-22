import { authService } from '@/services/auth/AuthService'
import { apiV1Client, ApiV1Error } from '@/services/api/ApiV1Client'

type Callback = (payload: any) => void
type SubscribeCallback = (status: string, detail?: string) => void
type PresenceState = Record<string, any[]>
export type ApiRealtimeChannelKind = 'report' | 'class_session'
export const REALTIME_FORBIDDEN_CLOSE_CODE = 4403
const REALTIME_PROTOCOL_ERROR_CLOSE_CODE = 4400
const REALTIME_RETRYABLE_CLOSE_CODE = 4000

const MAX_RECONNECT_DELAY_MS = 30_000
const SOCKET_OPEN_TIMEOUT_MS = 10_000
// Authorization (10s) and the upstream websocket handshake (10s) happen
// after the browser opens its socket, so leave room for both plus the reply.
const CHANNEL_JOIN_TIMEOUT_MS = 25_000
const HEARTBEAT_INTERVAL_MS = 25_000
const HEARTBEAT_TIMEOUT_MS = 10_000
const STABLE_CONNECTION_RESET_MS = 30_000

export interface PhoenixMessage {
  joinRef: string | null
  ref: string | null
  topic: string
  event: string
  payload: any
}

/** Supabase Realtime's Phoenix 1.0.0 serializer uses JSON object frames. */
export function encodePhoenixMessage(message: PhoenixMessage): string {
  return JSON.stringify({
    join_ref: message.joinRef,
    ref: message.ref,
    topic: message.topic,
    event: message.event,
    payload: message.payload
  })
}

export function decodePhoenixMessage(raw: unknown): PhoenixMessage {
  if (typeof raw !== 'string') throw new Error('Realtime sent a non-text frame while using Phoenix 1.0.0')
  const frame: unknown = JSON.parse(raw)
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
    throw new Error('Realtime sent an invalid Phoenix 1.0.0 frame')
  }
  const message = frame as Record<string, unknown>
  if (typeof message.topic !== 'string' || typeof message.event !== 'string') {
    throw new Error('Realtime sent an invalid Phoenix 1.0.0 frame')
  }
  return {
    joinRef: typeof message.join_ref === 'string' ? message.join_ref : null,
    ref: typeof message.ref === 'string' ? message.ref : null,
    topic: message.topic,
    event: message.event,
    payload: message.payload
  }
}

export class ApiRealtimeChannel {
  private socket: WebSocket | null = null
  private readonly topic: string
  private readonly presenceKey: string
  private readonly channelKind: ApiRealtimeChannelKind
  private readonly handlers: Array<{ type: string; event?: string; callback: Callback }> = []
  private readonly state: PresenceState = {}
  private ref = 0
  private joinRef: string | null = null
  private subscribedCallback: SubscribeCallback | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private socketOpenTimer: ReturnType<typeof setTimeout> | null = null
  private joinTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private closedByUser = false
  private failureHandled = false
  private retryInFlight = false
  private connectAttempt = 0
  private pendingHeartbeatRef: string | null = null
  private onlineListener: (() => void) | null = null
  private offlineListener: (() => void) | null = null

  private clearTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.heartbeatTimeoutTimer) clearTimeout(this.heartbeatTimeoutTimer)
    if (this.socketOpenTimer) clearTimeout(this.socketOpenTimer)
    if (this.joinTimeoutTimer) clearTimeout(this.joinTimeoutTimer)
    if (this.stableTimer) clearTimeout(this.stableTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.heartbeatTimer = null
    this.heartbeatTimeoutTimer = null
    this.socketOpenTimer = null
    this.joinTimeoutTimer = null
    this.stableTimer = null
    this.reconnectTimer = null
    this.pendingHeartbeatRef = null
  }

  private nextRef() { return String(++this.ref) }

  private sendFrame(socket: WebSocket, topic: string, event: string, payload: unknown, joinRef: string | null = this.joinRef) {
    const ref = this.nextRef()
    socket.send(encodePhoenixMessage({ joinRef, ref, topic, event, payload }))
    return ref
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        if (this.pendingHeartbeatRef) {
          this.failConnection('Realtime heartbeat timed out')
          return
        }
        this.pendingHeartbeatRef = this.sendFrame(this.socket, 'phoenix', 'heartbeat', {}, null)
        this.heartbeatTimeoutTimer = setTimeout(() => {
          if (this.pendingHeartbeatRef) this.failConnection('Realtime heartbeat timed out')
        }, HEARTBEAT_TIMEOUT_MS)
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private isOnline() { return typeof navigator === 'undefined' || navigator.onLine !== false }

  private async attemptReconnect() {
    if (this.closedByUser || this.retryInFlight) return
    if (!this.isOnline()) {
      this.subscribedCallback?.('OFFLINE')
      return
    }
    this.retryInFlight = true
    try {
      const { session, error } = await authService.getSession()
      if (this.closedByUser) return
      const authCode = (error as Error & { code?: string } | null)?.code
      if (!session && authCode === 'ACCOUNT_DISABLED') {
        this.closedByUser = true
        this.subscribedCallback?.('ACCOUNT_DISABLED')
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('edulog:account-disabled'))
        return
      }
      if (!session && (!error || authCode === 'AUTH_REQUIRED' || authCode === 'AUTH_INVALID')) {
        this.closedByUser = true
        this.subscribedCallback?.('AUTH_EXPIRED')
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('edulog:auth-session-expired'))
        return
      }
      if (!session && error) {
        this.scheduleReconnect()
        return
      }
      if (!this.isOnline()) {
        this.subscribedCallback?.('OFFLINE')
        return
      }
      this.connectSocket()
    } finally {
      this.retryInFlight = false
    }
  }

  private scheduleReconnect(immediate = false) {
    if (this.closedByUser || this.reconnectTimer) return
    if (!this.isOnline()) {
      this.subscribedCallback?.('OFFLINE')
      return
    }
    const baseDelay = Math.min(MAX_RECONNECT_DELAY_MS, 500 * (2 ** Math.min(this.reconnectAttempt++, 6)))
    const delay = immediate ? 0 : Math.min(MAX_RECONNECT_DELAY_MS, Math.round(baseDelay * (0.8 + Math.random() * 0.4)))
    this.subscribedCallback?.('RECONNECTING')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.attemptReconnect()
    }, delay)
  }

  private failConnection(detail: string, closeSocket = true, protocolError = false) {
    if (this.closedByUser || this.failureHandled) return
    this.failureHandled = true
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.heartbeatTimeoutTimer) clearTimeout(this.heartbeatTimeoutTimer)
    if (this.socketOpenTimer) clearTimeout(this.socketOpenTimer)
    if (this.joinTimeoutTimer) clearTimeout(this.joinTimeoutTimer)
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.heartbeatTimer = null
    this.heartbeatTimeoutTimer = null
    this.socketOpenTimer = null
    this.joinTimeoutTimer = null
    this.stableTimer = null
    this.pendingHeartbeatRef = null
    this.subscribedCallback?.('CHANNEL_ERROR', detail)
    if (closeSocket && (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING)) {
      // Browser WebSocket.close() only permits 1000 or application codes
      // (3000-4999). Protocol/transport failures still retry, so use
      // application close codes instead of throwing InvalidAccessError here.
      this.socket.close(protocolError ? REALTIME_PROTOCOL_ERROR_CLOSE_CODE : REALTIME_RETRYABLE_CLOSE_CODE, detail.slice(0, 120))
    }
    this.scheduleReconnect()
  }

  private connectSocket() {
    if (this.closedByUser || !this.isOnline()) {
      if (!this.closedByUser) this.subscribedCallback?.('OFFLINE')
      return
    }
    this.failureHandled = false
    this.subscribedCallback?.('CONNECTING')
    const attempt = ++this.connectAttempt
    const resourceId = this.topic.slice(this.channelKind === 'class_session' ? 'realtime:class-session:'.length : 'realtime:room:'.length)
    const parameter = this.channelKind === 'class_session' ? 'class_session' : 'room'
    // A side-panel frame sends the session cookie on fetch but not on the
    // WebSocket handshake, so every connection presents a one-time ticket.
    // Issuing a ticket changes no page data, so it must not empty the read cache on every reconnect.
    apiV1Client.post<{ ticket: string }>('/realtime/ticket', { [parameter]: resourceId }, { changesData: false }).then(
      (response) => {
        if (attempt !== this.connectAttempt || this.closedByUser) return
        this.openSocket(`${parameter}=${encodeURIComponent(resourceId)}&ticket=${encodeURIComponent(response.data.ticket)}`)
      },
      (error: unknown) => {
        if (attempt !== this.connectAttempt || this.closedByUser) return
        this.handleTicketFailure(error)
      }
    )
  }

  private handleTicketFailure(error: unknown) {
    const status = error instanceof ApiV1Error ? error.status : 0
    if (status === 401) {
      this.closedByUser = true
      this.subscribedCallback?.('AUTH_EXPIRED')
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('edulog:auth-session-expired'))
      return
    }
    if (status === 403 && (error as ApiV1Error).code === 'ACCOUNT_DISABLED') {
      this.closedByUser = true
      this.subscribedCallback?.('ACCOUNT_DISABLED')
      return
    }
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      this.closedByUser = true
      this.subscribedCallback?.('PERMISSION_DENIED', 'Realtime resource access denied')
      return
    }
    this.subscribedCallback?.('CHANNEL_ERROR', 'Could not prepare the realtime connection')
    if (!this.isOnline()) this.subscribedCallback?.('OFFLINE')
    else this.scheduleReconnect()
  }

  private openSocket(query: string) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime?${query}`)
    this.socket = socket
    this.socketOpenTimer = setTimeout(() => {
      if (this.socket !== socket || socket.readyState === WebSocket.OPEN || this.closedByUser) return
      this.failConnection('Timed out opening the realtime WebSocket')
    }, SOCKET_OPEN_TIMEOUT_MS)
    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.closedByUser || this.failureHandled) { socket.close(); return }
      if (this.socketOpenTimer) clearTimeout(this.socketOpenTimer)
      this.socketOpenTimer = null
      this.joinRef = this.nextRef()
      this.subscribedCallback?.('SUBSCRIBING')
      try {
        socket.send(encodePhoenixMessage({
          joinRef: this.joinRef,
          ref: this.joinRef,
          topic: this.topic,
          event: 'phx_join',
          payload: {
            config: { broadcast: { ack: false }, presence: { key: this.presenceKey }, private: true },
            access_token: ''
          }
        }))
        const expectedJoinRef = this.joinRef
        this.joinTimeoutTimer = setTimeout(() => {
          if (this.socket !== socket || this.closedByUser || this.joinRef !== expectedJoinRef) return
          this.failConnection('Timed out waiting for the realtime channel join reply')
        }, CHANNEL_JOIN_TIMEOUT_MS)
      } catch {
        this.failConnection('Failed to send the realtime channel join request')
      }
    })
    socket.addEventListener('message', (event) => this.handleMessage(event.data))
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket || this.closedByUser || this.failureHandled) return
      this.failureHandled = true
      if (this.socketOpenTimer) clearTimeout(this.socketOpenTimer)
      if (this.joinTimeoutTimer) clearTimeout(this.joinTimeoutTimer)
      this.socketOpenTimer = null
      this.joinTimeoutTimer = null
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
      if (this.heartbeatTimeoutTimer) clearTimeout(this.heartbeatTimeoutTimer)
      if (this.stableTimer) clearTimeout(this.stableTimer)
      this.heartbeatTimer = null
      this.heartbeatTimeoutTimer = null
      this.stableTimer = null
      this.pendingHeartbeatRef = null
      if (event.code === REALTIME_FORBIDDEN_CLOSE_CODE) {
        this.closedByUser = true
        this.subscribedCallback?.('PERMISSION_DENIED', event.reason || 'Realtime resource access denied')
        return
      }
      const detail = event.reason || (event.code ? `Realtime socket closed (${event.code})` : 'Realtime socket closed before joining the report room')
      this.subscribedCallback?.('CHANNEL_ERROR', detail)
      if (!this.isOnline()) this.subscribedCallback?.('OFFLINE')
      else this.scheduleReconnect()
    })
    socket.addEventListener('error', () => {
      if (this.socket !== socket || this.closedByUser || this.failureHandled) return
      this.failureHandled = true
      if (this.socketOpenTimer) clearTimeout(this.socketOpenTimer)
      if (this.joinTimeoutTimer) clearTimeout(this.joinTimeoutTimer)
      this.socketOpenTimer = null
      this.joinTimeoutTimer = null
      this.subscribedCallback?.('CHANNEL_ERROR', 'Realtime socket connection failed')
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
      this.scheduleReconnect()
    })
  }

  constructor(roomId: string, presenceKey: string, channelKind: ApiRealtimeChannelKind = 'report') {
    this.channelKind = channelKind
    this.topic = channelKind === 'class_session' ? `realtime:class-session:${roomId}` : `realtime:room:${roomId}`
    this.presenceKey = presenceKey
  }

  on(type: string, filter: { event?: string }, callback: Callback) {
    this.handlers.push({ type, event: filter.event, callback })
    return this
  }

  subscribe(callback: SubscribeCallback) {
    this.subscribedCallback = callback
    this.closedByUser = false
    this.reconnectAttempt = 0
    if (typeof window !== 'undefined') {
      this.onlineListener = () => {
        if (this.closedByUser) return
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
        this.scheduleReconnect(true)
      }
      this.offlineListener = () => {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
        this.subscribedCallback?.('OFFLINE')
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(4001, 'Browser offline')
      }
      window.addEventListener('online', this.onlineListener)
      window.addEventListener('offline', this.offlineListener)
    }
    this.connectSocket()
    return this
  }

  private handleMessage(raw: unknown) {
    let message: PhoenixMessage
    try {
      message = decodePhoenixMessage(raw)
    } catch (error) {
      this.failConnection(error instanceof Error ? error.message : 'Realtime sent an invalid frame', true, true)
      return
    }
    if (message.topic === 'phoenix' && message.event === 'phx_reply') {
      if (message.ref === this.pendingHeartbeatRef) {
        this.pendingHeartbeatRef = null
        if (this.heartbeatTimeoutTimer) clearTimeout(this.heartbeatTimeoutTimer)
        this.heartbeatTimeoutTimer = null
      }
      return
    }
    if (message.topic !== this.topic) return
    if (message.event === 'phx_reply') {
      // Only the reply to this socket's current join attempt means the room is
      // ready. Other replies can acknowledge presence/broadcast operations.
      if (!this.joinRef || message.ref !== this.joinRef) return
      if (this.joinTimeoutTimer) clearTimeout(this.joinTimeoutTimer)
      this.joinTimeoutTimer = null
      if (message.payload?.status === 'ok') {
        this.failureHandled = false
        this.startHeartbeat()
        if (this.stableTimer) clearTimeout(this.stableTimer)
        this.stableTimer = setTimeout(() => { this.reconnectAttempt = 0; this.stableTimer = null }, STABLE_CONNECTION_RESET_MS)
        this.subscribedCallback?.('SUBSCRIBED')
      } else {
        const reason = message.payload?.response?.reason
        const detail = typeof reason === 'string' && reason.length > 0
          ? `Realtime rejected the report room: ${reason.slice(0, 240)}`
          : 'Realtime rejected joining the report room'
        if (typeof reason === 'string' && /authori[sz]|permission|denied/i.test(reason)) {
          this.closedByUser = true
          this.subscribedCallback?.('PERMISSION_DENIED', detail)
          if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, 'Realtime permission denied')
          return
        }
        this.failConnection(detail)
      }
      return
    }
    if (message.event === 'broadcast') {
      const payload = message.payload?.payload ?? message.payload
      const event = message.payload?.event
      this.handlers.filter((handler) => handler.type === 'broadcast' && (!handler.event || handler.event === event)).forEach((handler) => handler.callback({ payload, event }))
      return
    }
    if (message.event === 'presence_state') {
      Object.keys(this.state).forEach((key) => { delete this.state[key] })
      Object.assign(this.state, message.payload ?? {})
      this.handlers.filter((handler) => handler.type === 'presence' && handler.event === 'sync').forEach((handler) => handler.callback({}));
      return
    }
    if (message.event === 'presence_diff') {
      for (const [key, diff] of Object.entries(message.payload ?? {})) {
        const joins = (diff as any).joins ?? {}; const leaves = (diff as any).leaves ?? {}
        if (Object.keys(joins).length) this.state[key] = Object.values(joins) as any[]
        if (Object.keys(leaves).length && !this.state[key]) this.state[key] = []
        if (Object.keys(joins).length) this.handlers.filter((handler) => handler.type === 'presence' && handler.event === 'join').forEach((handler) => handler.callback({ key, currentPresences: Object.values(joins) }))
        if (Object.keys(leaves).length) this.handlers.filter((handler) => handler.type === 'presence' && handler.event === 'leave').forEach((handler) => handler.callback({ key, leftPresences: Object.values(leaves) }))
      }
    }
  }

  presenceState() { return this.state }

  send(message: { type: string; event: string; payload: unknown }) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.resolve({ status: 'error' })
    const payload = message.type === 'broadcast'
      ? { type: 'broadcast', event: message.event, payload: message.payload }
      : { type: message.type, event: message.event, payload: message.payload }
    this.sendFrame(this.socket, this.topic, message.type === 'broadcast' ? 'broadcast' : message.type, payload)
    return Promise.resolve({ status: 'ok' })
  }

  track(payload: unknown) { return this.send({ type: 'presence', event: 'track', payload }) }
  untrack() { return this.send({ type: 'presence', event: 'untrack', payload: {} }) }
  unsubscribe() {
    this.closedByUser = true
    this.clearTimers()
    if (typeof window !== 'undefined') {
      if (this.onlineListener) window.removeEventListener('online', this.onlineListener)
      if (this.offlineListener) window.removeEventListener('offline', this.offlineListener)
    }
    this.onlineListener = null
    this.offlineListener = null
    if (this.socket?.readyState === WebSocket.OPEN && this.joinRef) {
      this.sendFrame(this.socket, this.topic, 'phx_leave', {}, this.joinRef)
    }
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) this.socket.close()
    this.socket = null
    return Promise.resolve('ok')
  }

  reconnect() {
    if (this.closedByUser) return
    this.failureHandled = true
    this.clearTimers()
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) this.socket.close(1000, 'Manual reconnect')
    this.scheduleReconnect(true)
  }
}
