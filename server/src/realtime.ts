import { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage, Server } from 'node:http'
import type { Socket } from 'node:net'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiConfig } from './config.js'
import { createUserClient, validateAccessToken } from './supabase.js'

function cookieValue(header: string | undefined, name: string) {
  return header?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1)
}

export function attachRealtimeProxy(server: Server, adminClient: SupabaseClient, config: ApiConfig) {
  const socketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  server.on('upgrade', async (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://edulog.local')
    if (url.pathname !== '/api/realtime') return
    const token = cookieValue(request.headers.cookie, 'edulog_access')
    const roomId = url.searchParams.get('room')
    if (!token) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
    if (!roomId || !/^[0-9a-f-]{36}$/i.test(roomId)) { socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
    try {
      const user = await validateAccessToken(adminClient, token)
      const userClient = createUserClient(config, token)
      const authorization = await userClient.rpc('can_access_report', { p_report_id: roomId, p_permission_key: 'teaching.reports.read' })
      if (authorization.error || authorization.data !== true) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
      void user
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return
    }
    if (!config.SUPABASE_REALTIME_URL) { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
    socketServer.handleUpgrade(request, socket, head, (client) => {
      const upstream = new URL(config.SUPABASE_REALTIME_URL!)
      if (!upstream.pathname || upstream.pathname === '/') upstream.pathname = '/socket/websocket'
      upstream.searchParams.set('access_token', token)
      const upstreamSocket = new WebSocket(upstream.toString(), { maxPayload: 1024 * 1024 })
      upstreamSocket.on('open', () => client.on('message', (message) => { if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(message) }))
      upstreamSocket.on('message', (message) => { if (client.readyState === WebSocket.OPEN) client.send(message) })
      upstreamSocket.on('close', () => client.close())
      client.on('close', () => upstreamSocket.close())
      client.on('error', () => upstreamSocket.close())
      upstreamSocket.on('error', () => client.close())
    })
  })
}

