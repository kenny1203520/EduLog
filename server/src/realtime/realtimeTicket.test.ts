import { describe, expect, it } from 'vitest'
import { issueTicket, redeemTicket } from './realtimeTicket.js'

const SECRET = 'a'.repeat(32)
const ROOM = 'bbe2ea83-8e94-4197-83c5-f126cf027abc'
const OTHER_ROOM = '0d7c3c7e-6f0e-4b8e-9d0b-2f1a3c4d5e6f'

function ticketFor(overrides: Partial<Parameters<typeof issueTicket>[1]> = {}) {
  return issueTicket(SECRET, { accessToken: 'access-token', resourceId: ROOM, channelKind: 'report', ...overrides })
}

describe('realtime ticket', () => {
  it('round-trips the access token for the issued resource', () => {
    const ticket = ticketFor()
    expect(ticket).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(ticket).not.toContain('access-token')
    expect(redeemTicket(SECRET, ticket, ROOM, 'report')).toBe('access-token')
  })

  it('accepts a class-session ticket regardless of UUID letter case', () => {
    const ticket = ticketFor({ channelKind: 'class_session', resourceId: ROOM.toUpperCase() })
    expect(redeemTicket(SECRET, ticket, ROOM, 'class_session')).toBe('access-token')
  })

  it('rejects an expired ticket', () => {
    const now = Date.now()
    const ticket = ticketFor({ ttlMs: 30_000, now })
    expect(redeemTicket(SECRET, ticket, ROOM, 'report', now + 30_000)).toBeNull()
  })

  it('rejects a ticket for another room or channel kind', () => {
    expect(redeemTicket(SECRET, ticketFor(), OTHER_ROOM, 'report')).toBeNull()
    expect(redeemTicket(SECRET, ticketFor(), ROOM, 'class_session')).toBeNull()
  })

  it('rejects a reused ticket', () => {
    const ticket = ticketFor()
    expect(redeemTicket(SECRET, ticket, ROOM, 'report')).toBe('access-token')
    expect(redeemTicket(SECRET, ticket, ROOM, 'report')).toBeNull()
  })

  it('rejects a tampered, foreign-key, or malformed ticket', () => {
    const ticket = ticketFor()
    const raw = Buffer.from(ticket, 'base64url')
    raw[raw.length - 1] ^= 0x01
    expect(redeemTicket(SECRET, raw.toString('base64url'), ROOM, 'report')).toBeNull()
    expect(redeemTicket('b'.repeat(32), ticketFor(), ROOM, 'report')).toBeNull()
    expect(redeemTicket(SECRET, 'not a ticket', ROOM, 'report')).toBeNull()
    expect(redeemTicket(SECRET, 'abc', ROOM, 'report')).toBeNull()
    expect(redeemTicket(SECRET, null, ROOM, 'report')).toBeNull()
  })
})
