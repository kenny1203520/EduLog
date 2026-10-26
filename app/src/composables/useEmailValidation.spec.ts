import { describe, expect, it } from 'vitest'
import { useEmailValidation } from './useEmailValidation'

describe('useEmailValidation', () => {
  const { validateEmail } = useEmailValidation()

  it('accepts optional, valid addresses and rejects malformed values', () => {
    expect(validateEmail('')).toBe(true)
    expect(validateEmail('  ')).toBe(true)
    expect(validateEmail('teacher@example.org')).toBe(true)
    expect(validateEmail('teacher@@example.org')).toBe(false)
    expect(validateEmail('teacher@example')).toBe(false)
    expect(validateEmail('teacher @example.org')).toBe(false)
  })

  it('rejects addresses longer than the email length limit', () => {
    const tooLong = 'a'.repeat(243) + '@example.org'
    expect(validateEmail(tooLong)).toBe(false)
  })
})
