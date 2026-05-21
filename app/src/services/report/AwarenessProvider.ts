import { CollabService } from './CollabService'
import * as Y from 'yjs'

type UpdateCallback = (changedClients: number[]) => void

function hashToInt(s: string): number {
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
    }
    return h
}

export function createAwarenessProvider(options: {
    reportId: string
    sessionId: string
    userId?: string
    ydoc?: Y.Doc | null
}) {
    const { reportId, sessionId, userId } = options

    // states keyed by numeric client id (derived from sessionId)
    const states: Map<number, any> = new Map()
    const localState: Record<string, any> = {}
    const listeners: Map<string, Set<UpdateCallback>> = new Map()

    const clientId = hashToInt(sessionId)

    // helper to emit update events
    function emitUpdate(changed: number[]) {
        const set = listeners.get('update')
        if (!set) return
        for (const cb of set) {
            try {
                cb(changed)
            } catch (e) {
                // swallow
            }
        }
    }

    // initialise local state entry
    states.set(clientId, { user: { id: userId || sessionId }, cursor: null, raw: null })

    // subscribe to CollabService awareness rows
    const unsub = CollabService.onAwareness(reportId, (payload: any) => {
        // payload should include sessionId and userId
        try {
            if (!payload) return
            const sid = payload.sessionId || payload.origin_session_id || payload.originSessionId || payload.session_id
            const uid = payload.userId || payload.origin_user_id || payload.user_id
            if (!sid) return
            const cid = hashToInt(sid)
            // Build state object for cursor display. We keep raw payload for consumers.
            const state = {
                user: {
                    id: uid || sid,
                    name: payload.displayName || payload.name || undefined,
                    color: payload.color || undefined
                },
                cursor: (payload.caret != null || payload.selectionEnd != null) ? { anchor: payload.caret ?? null, head: payload.selectionEnd ?? null } : null,
                raw: payload
            }
            states.set(cid, state)
            emitUpdate([cid])
        } catch (e) {
            console.error('[awareness] failed to handle payload', e)
        }
    })

    return {
        awareness: {
            // states map expected by some consumers
            states,
            // setLocalStateField called by tiptap's CollaborationCursor extension
            setLocalStateField(field: string, value: any) {
                // update local state and broadcast
                localState[field] = value
                const composed = { ...(localState || {}), sessionId, userId }
                // send to server via CollabService
                void CollabService.sendAwareness(reportId, sessionId, userId, composed)
                // update in-memory states and notify
                const s = states.get(clientId) || {}
                s[field] = value
                states.set(clientId, s)
                emitUpdate([clientId])
            },
            getStates() {
                return states
            },
            setLocalState(state: any) {
                // replace local state
                Object.assign(localState, state)
                const composed = { ...(localState || {}), sessionId, userId }
                void CollabService.sendAwareness(reportId, sessionId, userId, composed)
                const s = states.get(clientId) || {}
                Object.assign(s, state)
                states.set(clientId, s)
                emitUpdate([clientId])
            },
            // event helpers
            on(event: 'update', cb: UpdateCallback) {
                if (!listeners.has(event)) listeners.set(event, new Set())
                listeners.get(event)!.add(cb)
            },
            off(event: 'update', cb: UpdateCallback) {
                listeners.get(event)?.delete(cb)
            },
            getLocalState() {
                return localState
            }
        },
        destroy() {
            try {
                if (unsub) unsub()
            } catch (_) {}
        }
    }
}

export default createAwarenessProvider
