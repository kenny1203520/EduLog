import { describe, expect, it } from 'vitest'
import { safeExternalHref } from './safeExternalHref'

describe('safeExternalHref', () => {
    it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '//evil.example/x', 'file:///tmp/x', 'https://'])('rejects unsafe URL %s', value => {
        expect(safeExternalHref(value)).toBeNull()
    })

    it('allows absolute http and https links', () => {
        expect(safeExternalHref(' https://example.com/report ')).toBe('https://example.com/report')
        expect(safeExternalHref('http://example.com')).toBe('http://example.com/')
    })

    it('rejects oversized values', () => {
        expect(safeExternalHref('https://example.com/' + 'a'.repeat(4096))).toBeNull()
    })
})