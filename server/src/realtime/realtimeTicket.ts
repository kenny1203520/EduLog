import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const NONCE_BYTES = 16
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const MAX_TICKET_LENGTH = 16 * 1024
export const REALTIME_TICKET_TTL_MS = 30_000

export type RealtimeChannelKind = 'report' | 'class_session'

interface TicketPayload { t: string; r: string; k: RealtimeChannelKind; exp: number; n: string }

const keys = new Map<string, Buffer>()
// Redeemed nonces mapped to their expiry. A ticket is single-use on this API
// instance; entries are pruned once the ticket could no longer be redeemed.
const redeemedNonces = new Map<string, number>()

function ticketKey(secret: string): Buffer {
  let key = keys.get(secret)
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', secret, 'edulog', 'realtime-ticket-v1', KEY_BYTES))
    keys.set(secret, key)
  }
  return key
}

function associatedData(resourceId: string, channelKind: RealtimeChannelKind) {
  return Buffer.from(`${channelKind}:${resourceId.toLowerCase()}`, 'utf8')
}

function pruneRedeemed(now: number) {
  for (const [nonce, expiresAt] of redeemedNonces) if (expiresAt <= now) redeemedNonces.delete(nonce)
}

/**
 * Issues a short-lived, single-use ticket that lets the realtime WebSocket
 * handshake authenticate without the `edulog_access` cookie (an extension
 * side panel frames the web app, and the browser omits SameSite cookies on
 * that handshake). The access token is sealed with AES-256-GCM under a key
 * derived from `COOKIE_SECRET`, and the ticket is bound to one resource.
 */
export function issueTicket(secret: string, input: { accessToken: string; resourceId: string; channelKind: RealtimeChannelKind; ttlMs?: number; now?: number }): string {
  const payload: TicketPayload = {
    t: input.accessToken,
    r: input.resourceId.toLowerCase(),
    k: input.channelKind,
    exp: (input.now ?? Date.now()) + (input.ttlMs ?? REALTIME_TICKET_TTL_MS),
    n: randomBytes(NONCE_BYTES).toString('base64url'),
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, ticketKey(secret), iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(associatedData(input.resourceId, input.channelKind))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

/**
 * Redeems a ticket for the access token it carries. Returns null when the
 * ticket is malformed, tampered with, expired, issued for another resource or
 * channel kind, or was already redeemed.
 */
export function redeemTicket(secret: string, ticket: string | null | undefined, resourceId: string, channelKind: RealtimeChannelKind, now = Date.now()): string | null {
  if (!ticket || ticket.length > MAX_TICKET_LENGTH || !BASE64URL_PATTERN.test(ticket)) return null
  const raw = Buffer.from(ticket, 'base64url')
  if (raw.length <= IV_BYTES + TAG_BYTES) return null
  let payload: TicketPayload
  try {
    const decipher = createDecipheriv(ALGORITHM, ticketKey(secret), raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES })
    decipher.setAAD(associatedData(resourceId, channelKind))
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload?.t !== 'string' || !payload.t || typeof payload.n !== 'string' || typeof payload.exp !== 'number') return null
  if (payload.r !== resourceId.toLowerCase() || payload.k !== channelKind) return null
  pruneRedeemed(now)
  if (payload.exp <= now || redeemedNonces.has(payload.n)) return null
  redeemedNonces.set(payload.n, payload.exp)
  return payload.t
}
