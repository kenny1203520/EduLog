import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const ENVELOPE_VERSION = 'v1'
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/
const VENDOR_PREFIX_PATTERN = /^[A-Za-z]{2,8}-(?:[A-Za-z]{2,8}-)?/
const MASK_TAIL = 4
const MIN_MASKABLE_LENGTH = 12

/** Raised when a key or an encrypted envelope is malformed or fails authentication. */
export class SecretCipherError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretCipherError'
  }
}

/**
 * Decodes a base64 AES-256 key, returning null unless it is canonical base64
 * of exactly 32 bytes.
 */
export function decodeSecretKey(value: string): Buffer | null {
  if (!BASE64_PATTERN.test(value) || value.length % 4 !== 0) return null
  const key = Buffer.from(value, 'base64')
  if (key.length !== KEY_BYTES || key.toString('base64') !== value) return null
  return key
}

/**
 * Encrypts provider credential secrets with AES-256-GCM using Node's built-in
 * crypto. Each call uses a fresh random IV. The envelope is
 * `v1.<iv>.<tag>.<ciphertext>` (base64url parts) and is what
 * `ai_credentials.secret_ciphertext` stores.
 *
 * An optional associated-data string (for example the credential id) binds a
 * ciphertext to its row: decrypting it with different associated data fails,
 * so ciphertexts cannot be swapped between credentials.
 */
export class SecretCipher {
  private constructor(private readonly key: Buffer) {}

  /**
   * Creates a cipher from a base64-encoded 32-byte key (`AI_SECRET_KEY`).
   * @throws SecretCipherError when the key is not 32 bytes of canonical base64.
   */
  static fromBase64(value: string): SecretCipher {
    const key = decodeSecretKey(value)
    if (!key) throw new SecretCipherError('AI secret key must be 32 bytes encoded as base64')
    return new SecretCipher(key)
  }

  /** Encrypts a secret into a versioned envelope. */
  encrypt(plaintext: string, associatedData?: string): string {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES })
    if (associatedData !== undefined) cipher.setAAD(Buffer.from(associatedData, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [ENVELOPE_VERSION, iv, tag, ciphertext].map((part) => typeof part === 'string' ? part : part.toString('base64url')).join('.')
  }

  /**
   * Decrypts an envelope produced by {@link encrypt}.
   * @throws SecretCipherError when the envelope is malformed, was encrypted
   *   with another key or associated data, or has been tampered with.
   */
  decrypt(envelope: string, associatedData?: string): string {
    const parts = envelope.split('.')
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION || !parts.slice(1).every((part) => BASE64URL_PATTERN.test(part))) {
      throw new SecretCipherError('Unsupported secret envelope')
    }
    const [, ivPart, tagPart, ciphertextPart] = parts
    const iv = Buffer.from(ivPart, 'base64url')
    const tag = Buffer.from(tagPart, 'base64url')
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretCipherError('Unsupported secret envelope')
    const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES })
    if (associatedData !== undefined) decipher.setAAD(Buffer.from(associatedData, 'utf8'))
    decipher.setAuthTag(tag)
    try {
      return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64url')), decipher.final()]).toString('utf8')
    } catch {
      throw new SecretCipherError('Secret could not be decrypted')
    }
  }
}

/**
 * Masks a secret for display (`ai_credentials.secret_hint`): a vendor prefix
 * such as `sk-` or `sk-ant-` is kept, followed by `…` and the last four
 * characters, e.g. `sk-…abcd`. Secrets shorter than 12 characters reveal
 * nothing and mask to `…`.
 */
export function maskSecret(secret: string): string {
  const value = secret.trim()
  if (value.length < MIN_MASKABLE_LENGTH) return '…'
  const prefix = value.match(VENDOR_PREFIX_PATTERN)?.[0] ?? ''
  return `${prefix}…${value.slice(-MASK_TAIL)}`
}
