import { decodeJwt } from 'jose'
import type { SupabaseClient } from '@supabase/supabase-js'

/** A browser session ends after this long without user activity. */
export const SESSION_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000
/** A browser session ends this long after sign-in, however active it is. */
export const SESSION_ABSOLUTE_MAX_MS = 30 * 24 * 60 * 60 * 1000
/** Activity is written at most this often per session. */
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000
/**
 * The web app sends this header on requests the user did not cause (polling
 * while nobody has touched the page), so they do not keep an idle session alive.
 */
export const BACKGROUND_REQUEST_HEADER = 'x-edulog-background'

export type SessionPolicyState = {
  ok: boolean
  reason?: 'idle' | 'absolute'
  idleExpiresAt: string
  absoluteExpiresAt: string
}

type ActivityRow = { session_id: string; user_id: string; started_at: string; last_activity_at: string }
const TABLE = 'api_session_activity'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The GoTrue session id carried by an access token, or null when it has none. */
export function sessionIdOf(accessToken: string | undefined): string | null {
  if (!accessToken) return null
  try {
    const claim = decodeJwt(accessToken).session_id
    return typeof claim === 'string' && UUID.test(claim) ? claim : null
  } catch { return null }
}

/** Expiry deadlines for a session with the given start and last activity. */
export function evaluateSession(startedAt: number, lastActivityAt: number, now = Date.now()): SessionPolicyState {
  const idleExpiresAt = lastActivityAt + SESSION_IDLE_TIMEOUT_MS
  const absoluteExpiresAt = startedAt + SESSION_ABSOLUTE_MAX_MS
  const reason = now >= absoluteExpiresAt ? 'absolute' : now >= idleExpiresAt ? 'idle' : undefined
  return { ok: !reason, ...(reason ? { reason } : {}), idleExpiresAt: new Date(idleExpiresAt).toISOString(), absoluteExpiresAt: new Date(absoluteExpiresAt).toISOString() }
}

/**
 * Server-side record of when each browser session started and when its user
 * was last active. GoTrue alone would let a refresh token live as long as it is
 * used, so the refresh route consults this record before issuing new tokens.
 */
export class SessionActivityStore {
  private readonly lastWrite = new Map<string, number>()

  constructor(private readonly admin: SupabaseClient) {}

  /**
   * Records a sign-in. A session id seen before (an MFA step-up on the same
   * session) keeps its original start, so stepping up never extends the cap.
   */
  async start(sessionId: string, userId: string, now = Date.now()) {
    const at = new Date(now).toISOString()
    const inserted = await this.admin.from(TABLE).upsert({ session_id: sessionId, user_id: userId, started_at: at, last_activity_at: at }, { onConflict: 'session_id', ignoreDuplicates: true })
    if (inserted.error) throw new Error('SESSION_ACTIVITY_UNAVAILABLE')
    const touched = await this.admin.from(TABLE).update({ last_activity_at: at }).eq('session_id', sessionId).eq('user_id', userId)
    if (touched.error) throw new Error('SESSION_ACTIVITY_UNAVAILABLE')
    this.lastWrite.set(sessionId, now)
    // Rows for sessions that can no longer be refreshed are of no further use.
    await this.admin.from(TABLE).delete().lt('last_activity_at', new Date(now - SESSION_ABSOLUTE_MAX_MS).toISOString())
  }

  /** Marks user activity, writing at most once a minute per session. */
  async touch(sessionId: string, userId: string, now = Date.now()) {
    const previous = this.lastWrite.get(sessionId)
    if (previous !== undefined && now - previous < ACTIVITY_WRITE_INTERVAL_MS) return
    this.lastWrite.set(sessionId, now)
    if (this.lastWrite.size > 10_000) this.lastWrite.clear()
    const updated = await this.admin.from(TABLE).update({ last_activity_at: new Date(now).toISOString() }).eq('session_id', sessionId).eq('user_id', userId).select('session_id').maybeSingle()
    if (updated.error) { this.lastWrite.delete(sessionId); throw new Error('SESSION_ACTIVITY_UNAVAILABLE') }
    // A session signed in before this record existed starts counting now.
    if (!updated.data) await this.start(sessionId, userId, now)
  }

  /**
   * Whether the session may still be refreshed. A session signed in before the
   * record existed is adopted with both clocks starting now. Read errors fail closed.
   */
  async check(sessionId: string, userId: string, now = Date.now()): Promise<SessionPolicyState> {
    const result = await this.admin.from(TABLE).select('session_id,user_id,started_at,last_activity_at').eq('session_id', sessionId).maybeSingle()
    if (result.error) throw new Error('SESSION_ACTIVITY_UNAVAILABLE')
    const row = result.data as ActivityRow | null
    if (!row) {
      await this.start(sessionId, userId, now)
      return evaluateSession(now, now, now)
    }
    if (row.user_id !== userId) return { ...evaluateSession(now, now, now), ok: false, reason: 'absolute' }
    return evaluateSession(Date.parse(row.started_at), Date.parse(row.last_activity_at), now)
  }

  /** Forgets a session after sign-out. */
  async end(sessionId: string) {
    this.lastWrite.delete(sessionId)
    await this.admin.from(TABLE).delete().eq('session_id', sessionId)
  }
}

const stores = new WeakMap<SupabaseClient, SessionActivityStore>()
/** One store per service-role client, shared by the auth router and requireAuth. */
export function sessionActivity(admin: SupabaseClient) {
  let store = stores.get(admin)
  if (!store) { store = new SessionActivityStore(admin); stores.set(admin, store) }
  return store
}
