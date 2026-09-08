type Callback = (payload: any) => void

type PresenceState = Record<string, any[]>

export class ApiRealtimeChannel {
  private socket: WebSocket | null = null
  private readonly topic: string
  private readonly presenceKey: string
  private readonly handlers: Array<{ type: string; event?: string; callback: Callback }> = []
  private readonly state: PresenceState = {}
  private ref = 0
  private subscribedCallback: ((status: string) => void) | null = null

  constructor(roomId: string, presenceKey: string) {
    this.topic = `realtime:room:${roomId}`
    this.presenceKey = presenceKey
  }

  on(type: string, filter: { event?: string }, callback: Callback) {
    this.handlers.push({ type, event: filter.event, callback })
    return this
  }

  subscribe(callback: (status: string) => void) {
    this.subscribedCallback = callback
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const room = this.topic.slice('realtime:room:'.length)
    this.socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime?room=${encodeURIComponent(room)}`)
    this.socket.addEventListener('open', () => {
      this.socket?.send(JSON.stringify({ topic: this.topic, event: 'phx_join', payload: { config: { broadcast: { ack: false }, presence: { key: this.presenceKey }, private: true }, access_token: '' }, ref: String(++this.ref) }))
    })
    this.socket.addEventListener('message', (event) => this.handleMessage(event.data))
    this.socket.addEventListener('close', () => { if (this.subscribedCallback) this.subscribedCallback('CLOSED') })
    this.socket.addEventListener('error', () => { if (this.subscribedCallback) this.subscribedCallback('CHANNEL_ERROR') })
    return this
  }

  private handleMessage(raw: unknown) {
    let message: any
    try { message = JSON.parse(String(raw)) } catch { return }
    if (message.topic !== this.topic) return
    if (message.event === 'phx_reply' && message.payload?.status === 'ok') { this.subscribedCallback?.('SUBSCRIBED'); return }
    if (message.event === 'broadcast') {
      const payload = message.payload?.payload ?? message.payload
      const event = message.payload?.event
      this.handlers.filter((handler) => handler.type === 'broadcast' && (!handler.event || handler.event === event)).forEach((handler) => handler.callback({ payload, event }))
      return
    }
    if (message.event === 'presence_state') {
      Object.assign(this.state, message.payload ?? {})
      this.handlers.filter((handler) => handler.type === 'presence' && handler.event === 'sync').forEach((handler) => handler.callback({}))
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
      return
    }
  }

  presenceState() { return this.state }

  send(message: { type: string; event: string; payload: unknown }) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.resolve({ status: 'error' })
    this.socket.send(JSON.stringify({ topic: this.topic, event: message.type === 'broadcast' ? 'broadcast' : message.type, payload: message, ref: String(++this.ref) }))
    return Promise.resolve({ status: 'ok' })
  }

  track(payload: unknown) { return this.send({ type: 'presence', event: 'track', payload }) }
  untrack() { return this.send({ type: 'presence', event: 'untrack', payload: {} }) }
  unsubscribe() { this.socket?.close(); this.socket = null; return Promise.resolve('ok') }
}
