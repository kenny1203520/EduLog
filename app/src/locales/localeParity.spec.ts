import { describe, expect, it } from 'vitest'
import en from './en'
import zhTW from './zh-TW'

// changelog is release-log content (its own entries are asserted to stay
// aligned per-release by ReleaseVersion.contract.spec.ts), not a fixed set of
// UI keys -- comparing its key shape here would be noise, not signal.
const NAMESPACES_TO_SKIP = new Set(['changelog'])

function collectKeyPaths(value: unknown, prefix: string, out: Set<string>): void {
    if (Array.isArray(value)) return
    if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            collectKeyPaths(child, prefix ? `${prefix}.${key}` : key, out)
        }
        return
    }
    out.add(prefix)
}

function keyPaths(messages: Record<string, unknown>): Set<string> {
    const out = new Set<string>()
    for (const [namespace, value] of Object.entries(messages)) {
        if (NAMESPACES_TO_SKIP.has(namespace)) continue
        collectKeyPaths(value, namespace, out)
    }
    return out
}

describe('locale key parity', () => {
    it('keeps every translation key present in both en and zh-TW', () => {
        const enKeys = keyPaths(en)
        const zhKeys = keyPaths(zhTW)

        const missingFromZh = [...enKeys].filter(key => !zhKeys.has(key)).sort()
        const missingFromEn = [...zhKeys].filter(key => !enKeys.has(key)).sort()

        expect(missingFromZh, `keys present in en but missing from zh-TW`).toEqual([])
        expect(missingFromEn, `keys present in zh-TW but missing from en`).toEqual([])
    })
})
