type Callback = (payload: any) => void
type SubscribeCallback = (status: string, detail?: string) => void
type PresenceState = Record<string, any[]>

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
  private readonly handlers: Array<{ type: string; event?: string; callback: Callback }> = []
  private readonly state: PresenceState = {}
  private ref = 0
  private joinRef: string | null = null
  private subscribedCallback: SubscribeCallback | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private closedByUser = false
  private failureHandled = false

  private clearTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.heartbeatTimer = null
    this.reconnectTimer = null
  }

  private nextRef() { return String(++this.ref) }

  private sendFrame(socket: WebSocket, topic: string, event: string, payload: unknown, joinRef: string | null = this.joinRef) {
    socket.send(encodePhoenixMessage({ joinRef, ref: this.nextRef(), topic, event, payload }))
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.sendFrame(this.socket, 'phoenix', 'heartbeat', {}, null)
      }
    }, 25_000)
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.reconnectTimer) return
    const delay = Math.min(30_000, 500 * (2 ** Math.min(this.reconnectAttempt++, 6)))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connectSocket()
    }, delay)
  }

  private failConnection(detail: string, closeSocket = true, protocolError = false) {
    if (this.closedByUser || this.failureHandled) return
    this.failureHandled = true
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.subscribedCallback?.('CHANNEL_ERROR', detail)
    if (closeSocket && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.close(protocolError ? 1003 : 1011, protocolError ? 'Phoenix 1.0 requires text frames' : 'Realtime channel failed')
    }
    this.scheduleReconnect()
  }

  private connectSocket() {
    if (this.closedByUser) return
    this.failureHandled = false
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const room = this.topic.slice('realtime:room:'.length)
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime?room=${encodeURIComponent(room)}`)
    this.socket = socket
    socket.addEventListener('open', () => {
      this.joinRef = this.nextRef()
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
    })
    socket.addEventListener('message', (event) => this.handleMessage(event.data))
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket || this.closedByUser || this.failureHandled) return
      this.failureHandled = true
      const detail = event.reason || (event.code ? `Realtime socket closed (${event.code})` : 'Realtime socket closed before joining the report room')
      this.subscribedCallback?.('CHANNEL_ERROR', detail)
      this.scheduleReconnect()
    })
    socket.addEventListener('error', () => {
      if (this.socket !== socket || this.closedByUser || this.failureHandled) return
      this.failureHandled = true
      this.subscribedCallback?.('CHANNEL_ERROR', 'Realtime socket connection failed')
      this.scheduleReconnect()
    })
  }

  constructor(roomId: string, presenceKey: string) {
    this.topic = `realtime:room:${roomId}`
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
    if (message.topic !== this.topic) return
    if (message.event === 'phx_reply') {
      if (message.payload?.status === 'ok') {
        this.failureHandled = false
        this.reconnectAttempt = 0
        this.joinRef = message.joinRef || this.joinRef
        this.startHeartbeat()
        this.subscribedCallback?.('SUBSCRIBED')
      } else {
        const reason = message.payload?.response?.reason
        const detail = typeof reason === 'string' && reason.length > 0
          ? `Realtime rejected the report room: ${reason.slice(0, 240)}`
          : 'Realtime rejected joining the report room'
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
    if (this.socket?.readyState === WebSocket.OPEN && this.joinRef) {
      this.sendFrame(this.socket, this.topic, 'phx_leave', {}, this.joinRef)
    }
    this.socket?.close()
    this.socket = null
    return Promise.resolve('ok')
  }
}
