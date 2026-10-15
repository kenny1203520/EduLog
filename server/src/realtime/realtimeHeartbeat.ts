import type { RawData, WebSocket } from 'ws'

export const REALTIME_PING_INTERVAL_MS = 25_000
export const REALTIME_PONG_TIMEOUT_MS = 10_000

type LivenessSocket = Pick<WebSocket, 'readyState' | 'ping' | 'on' | 'off'>

/** Watch a single WebSocket for half-open connections. The caller owns pair teardown. */
export function monitorRealtimeSocket(
  socket: LivenessSocket,
  onUnresponsive: () => void,
  intervalMs = REALTIME_PING_INTERVAL_MS,
  timeoutMs = REALTIME_PONG_TIMEOUT_MS,
) {
  let stopped = false
  let awaitingPong = false
  let pongTimeout: ReturnType<typeof setTimeout> | null = null

  const clearPongTimeout = () => {
    if (pongTimeout) clearTimeout(pongTimeout)
    pongTimeout = null
  }
  const onPong = (_data: RawData) => {
    awaitingPong = false
    clearPongTimeout()
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(interval)
    clearPongTimeout()
    socket.off('pong', onPong)
  }
  const interval = setInterval(() => {
    if (stopped) return
    if (socket.readyState !== 1) return
    if (awaitingPong) {
      stop()
      onUnresponsive()
      return
    }
    awaitingPong = true
    try {
      socket.ping()
      pongTimeout = setTimeout(() => {
        if (stopped || !awaitingPong) return
        stop()
        onUnresponsive()
      }, timeoutMs)
    } catch {
      stop()
      onUnresponsive()
    }
  }, intervalMs)

  socket.on('pong', onPong)
  return stop
}
