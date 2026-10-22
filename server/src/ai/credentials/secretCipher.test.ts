import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SecretCipher, SecretCipherError, decodeSecretKey, maskSecret } from './secretCipher.js'

const key = randomBytes(32).toString('base64')

describe('SecretCipher', () => {
  it('round-trips a secret', () => {
    const cipher = SecretCipher.fromBase64(key)
    const envelope = cipher.encrypt('sk-ant-api03-secret-value')
    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(envelope).not.toContain('secret-value')
    expect(cipher.decrypt(envelope)).toBe('sk-ant-api03-secret-value')
  })

  it('uses a fresh IV for every encryption', () => {
    const cipher = SecretCipher.fromBase64(key)
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'))
  })

  it('round-trips unicode and empty secrets', () => {
    const cipher = SecretCipher.fromBase64(key)
    expect(cipher.decrypt(cipher.encrypt('金鑰🔑'))).toBe('金鑰🔑')
    expect(cipher.decrypt(cipher.encrypt(''))).toBe('')
  })

  it('binds a ciphertext to its associated data', () => {
    const cipher = SecretCipher.fromBase64(key)
    const envelope = cipher.encrypt('secret', 'credential-a')
    expect(cipher.decrypt(envelope, 'credential-a')).toBe('secret')
    expect(() => cipher.decrypt(envelope, 'credential-b')).toThrow(SecretCipherError)
    expect(() => cipher.decrypt(envelope)).toThrow(SecretCipherError)
  })

  it('rejects a ciphertext encrypted with another key', () => {
    const envelope = SecretCipher.fromBase64(key).encrypt('secret')
    const other = SecretCipher.fromBase64(randomBytes(32).toString('base64'))
    expect(() => other.decrypt(envelope)).toThrow(SecretCipherError)
  })

  it('rejects tampered envelopes', () => {
    const cipher = SecretCipher.fromBase64(key)
    const [version, iv, tag, ciphertext] = cipher.encrypt('secret value').split('.')
    const flipped = Buffer.from(ciphertext, 'base64url')
    flipped[0] ^= 1
    expect(() => cipher.decrypt([version, iv, tag, flipped.toString('base64url')].join('.'))).toThrow(SecretCipherError)
    const badTag = Buffer.from(tag, 'base64url')
    badTag[0] ^= 1
    expect(() => cipher.decrypt([version, iv, badTag.toString('base64url'), ciphertext].join('.'))).toThrow(SecretCipherError)
  })

  it('rejects malformed envelopes', () => {
    const cipher = SecretCipher.fromBase64(key)
    for (const envelope of ['', 'plaintext', 'v2.a.b.c', 'v1.a.b', 'v1.!!.b.c', `v1.${Buffer.alloc(8).toString('base64url')}.${Buffer.alloc(16).toString('base64url')}.AA`]) {
      expect(() => cipher.decrypt(envelope)).toThrow(SecretCipherError)
    }
  })

  it('rejects keys that are not 32 bytes of canonical base64', () => {
    expect(() => SecretCipher.fromBase64(randomBytes(16).toString('base64'))).toThrow(SecretCipherError)
    expect(() => SecretCipher.fromBase64('not base64!')).toThrow(SecretCipherError)
  })
})

describe('decodeSecretKey', () => {
  it('accepts exactly 32 bytes of base64', () => {
    expect(decodeSecretKey(key)?.length).toBe(32)
  })

  it('rejects other lengths, base64url and non-canonical padding', () => {
    expect(decodeSecretKey(randomBytes(31).toString('base64'))).toBeNull()
    expect(decodeSecretKey(randomBytes(33).toString('base64'))).toBeNull()
    expect(decodeSecretKey(Buffer.alloc(32, 0xff).toString('base64url'))).toBeNull()
    expect(decodeSecretKey(key.replace(/=$/, ''))).toBeNull()
    expect(decodeSecretKey('')).toBeNull()
  })
})

describe('maskSecret', () => {
  it('keeps a vendor prefix and the last four characters', () => {
    expect(maskSecret('sk-1234567890abcd')).toBe('sk-…abcd')
    expect(maskSecret('sk-ant-api03-xxxxxxxxxxxxwxyz')).toBe('sk-ant-…wxyz')
    expect(maskSecret('sk-or-v1-0123456789abcdef')).toBe('sk-or-…cdef')
  })

  it('shows only the tail when there is no vendor prefix', () => {
    expect(maskSecret('AIzaSyD0123456789abcd')).toBe('…abcd')
  })

  it('reveals nothing for short secrets', () => {
    expect(maskSecret('short')).toBe('…')
    expect(maskSecret('  ')).toBe('…')
  })

  it('stays within the secret_hint column limit', () => {
    expect(maskSecret(`abcdefgh-ijklmnop-${'x'.repeat(200)}`).length).toBeLessThanOrEqual(32)
  })
})
