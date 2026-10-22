import { Router } from 'express'
import { z } from 'zod'
import type { ApiConfig } from '../../config/config.js'
import { ApiError } from '../../http/errors.js'
import { issueTicket, REALTIME_TICKET_TTL_MS } from '../../realtime/realtimeTicket.js'

const ticketInput = z.union([
  z.object({ room: z.string().uuid() }).strict(),
  z.object({ class_session: z.string().uuid() }).strict(),
])

/**
 * Issues a one-time ticket for the `/api/realtime` WebSocket handshake. The
 * side-panel frame sends cookies on fetch but not on the WebSocket upgrade, so
 * the client asks for a ticket here and appends it to the socket URL.
 * Resource access is still checked by the proxy after the upgrade.
 */
export function createRealtimeTicketRouter(config: Pick<ApiConfig, 'COOKIE_SECRET'>) {
  const router = Router()
  router.post('/realtime/ticket', (req, res) => {
    if (!req.accessToken) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const input = ticketInput.parse(req.body)
    const [channelKind, resourceId] = 'room' in input ? ['report', input.room] as const : ['class_session', input.class_session] as const
    const ticket = issueTicket(config.COOKIE_SECRET, { accessToken: req.accessToken, resourceId, channelKind })
    res.json({ data: { ticket, expires_in: REALTIME_TICKET_TTL_MS / 1000 }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
  })
  return router
}
