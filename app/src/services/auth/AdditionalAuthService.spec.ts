import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }))
vi.mock('@/services/api/ApiV1Client', () => ({ apiV1Client: api }))

import { additionalAuth } from './AdditionalAuthService'

const credentialJson = { id: 'browser-key', type: 'public-key', response: { clientDataJSON: 'YQ' } }
class BrowserCredential {
    toJSON() { return credentialJson }
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('PublicKeyCredential', BrowserCredential)
})
afterEach(() => vi.unstubAllGlobals())

describe('additional authentication browser operations', () => {
    it('registers the browser credential with the server-issued registration challenge', async () => {
        const create = vi.fn().mockResolvedValue(new BrowserCredential())
        vi.stubGlobal('navigator', { credentials: { create } })
        api.post.mockResolvedValueOnce({ data: {
            challenge_id: 'registration-challenge',
            options: {
                challenge: 'YQ', rp: { name: 'EduLog', id: 'edulog.example.test' },
                user: { id: 'Yg', name: 'teacher', displayName: 'Teacher' },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                excludeCredentials: [{ type: 'public-key', id: 'Yw' }],
            },
        } }).mockResolvedValueOnce({ data: {} })

        await additionalAuth.addPasskey()

        expect(create).toHaveBeenCalledWith({ publicKey: expect.objectContaining({
            challenge: new Uint8Array([97]),
            user: expect.objectContaining({ id: new Uint8Array([98]) }),
            excludeCredentials: [{ type: 'public-key', id: new Uint8Array([99]) }],
        }) })
        expect(api.post).toHaveBeenLastCalledWith('/auth/me/passkeys/registration/verify', {
            challenge_id: 'registration-challenge', credential: credentialJson,
        }, { changesData: false })
    })

    it('returns the verification continuation for a passkey sign-in', async () => {
        const get = vi.fn().mockResolvedValue(new BrowserCredential())
        vi.stubGlobal('navigator', { credentials: { get } })
        api.post.mockResolvedValueOnce({ data: {
            challenge_id: 'sign-in-challenge', options: { challenge: 'YQ', rpId: 'edulog.example.test' },
        } }).mockResolvedValueOnce({ data: { redirect: '/login?mfa=1' } })

        await expect(additionalAuth.signInWithPasskey()).resolves.toEqual({ redirect: '/login?mfa=1' })
        expect(get).toHaveBeenCalledWith({ publicKey: expect.objectContaining({ rpId: 'edulog.example.test' }) })
        expect(api.post).toHaveBeenLastCalledWith('/auth/session/passkey/verify', {
            challenge_id: 'sign-in-challenge', credential: credentialJson,
        }, { changesData: false })
    })

    it('does not submit a verification when the browser cancels registration', async () => {
        vi.stubGlobal('navigator', { credentials: { create: vi.fn().mockResolvedValue(null) } })
        api.post.mockResolvedValueOnce({ data: {
            challenge_id: 'cancelled', options: {
                challenge: 'YQ', rp: { name: 'EduLog' },
                user: { id: 'Yg', name: 'teacher', displayName: 'Teacher' }, pubKeyCredParams: [],
            },
        } })

        await expect(additionalAuth.addPasskey()).rejects.toThrow('cancelled')
        expect(api.post).toHaveBeenCalledTimes(1)
    })

    it('submits a security-key assertion with its factor challenge and returns the redirect', async () => {
        vi.stubGlobal('navigator', { credentials: { get: vi.fn().mockResolvedValue(new BrowserCredential()) } })
        api.post.mockResolvedValue({ data: { redirect: '/dashboard' } })

        await expect(additionalAuth.verifyFactor('factor/key', {
            id: 'factor-challenge',
            webauthn: { type: 'request', credential_options: { publicKey: { challenge: 'YQ' } } },
        })).resolves.toEqual({ redirect: '/dashboard' })
        expect(api.post).toHaveBeenCalledWith('/auth/me/factors/factor%2Fkey/verify', {
            challenge_id: 'factor-challenge', webauthn: { type: 'request', credential_response: credentialJson },
        }, { changesData: false })
    })

    it('propagates a rejected factor verification without reporting a session', async () => {
        const denied = new Error('Invalid verification code')
        api.post.mockRejectedValue(denied)
        await expect(additionalAuth.verifyFactor('totp', { id: 'challenge' }, '123456')).rejects.toBe(denied)
    })
})
