import { describe, expect, it } from 'vitest'
import { externalLinkOrEmpty, optionalExternalLink } from './externalLink.js'
import { enrollmentBodySchema } from './enrollmentRouter.js'

const scriptUrls = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox', 'file:///etc/passwd']

describe('external link schemas', () => {
  it.each(scriptUrls)('rejects %s', (value) => {
    expect(optionalExternalLink.safeParse(value).success).toBe(false)
    expect(externalLinkOrEmpty.safeParse(value).success).toBe(false)
    expect(enrollmentBodySchema.safeParse({ external_link: value }).success).toBe(false)
  })

  it('accepts http(s) URLs and empty values', () => {
    expect(optionalExternalLink.parse('https://example.test/a?b=1')).toBe('https://example.test/a?b=1')
    expect(optionalExternalLink.parse('http://example.test')).toBe('http://example.test')
    expect(optionalExternalLink.parse('  ')).toBeNull()
    expect(optionalExternalLink.parse(undefined)).toBeUndefined()
    expect(externalLinkOrEmpty.parse('')).toBe('')
    expect(externalLinkOrEmpty.parse(null)).toBeNull()
  })
})
