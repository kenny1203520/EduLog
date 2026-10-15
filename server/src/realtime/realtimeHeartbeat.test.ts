import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { monitorRealtimeSocket } from './realtimeHeartbeat.js'

class MockSocket extends EventEmitter {
  readyState = 1
  ping = vi.fn()
}

describe('Realtime websocket liveness', () => {
  afterEach(() => vi.useRealTimers())

  it('pings at the configured interval and keeps a socket alive after pong', () => {
    vi.useFakeTimers()
    const socket = new MockSocket()
    const timedOut = vi.fn()
    const stop = monitorRealtimeSocket(socket as any, timedOut, 25, 10)

    vi.advanceTimersByTime(25)
    expect(socket.ping).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(8)
    socket.emit('pong', Buffer.alloc(0))
    vi.advanceTimersByTime(17)
    expect(socket.ping).toHaveBeenCalledTimes(2)
    socket.emit('pong', Buffer.alloc(0))
    vi.advanceTimersByTime(24)
    expect(timedOut).not.toHaveBeenCalled()
    stop()
    expect(socket.listenerCount('pong')).toBe(0)
  })

  it('closes recovery path after a missing pong and clears its timers/listener once', () => {
    vi.useFakeTimers()
    const socket = new MockSocket()
    const timedOut = vi.fn()
    const stop = monitorRealtimeSocket(socket as any, timedOut, 25, 10)

    vi.advanceTimersByTime(35)
    expect(timedOut).toHaveBeenCalledOnce()
    expect(socket.listenerCount('pong')).toBe(0)
    socket.emit('pong', Buffer.alloc(0))
    stop()
    expect(timedOut).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports ping failures and does not ping a closed socket', () => {
    vi.useFakeTimers()
    const socket = new MockSocket()
    socket.ping.mockImplementation(() => { throw new Error('closed') })
    const timedOut = vi.fn()
    monitorRealtimeSocket(socket as any, timedOut, 25, 10)
    vi.advanceTimersByTime(25)
    expect(timedOut).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
