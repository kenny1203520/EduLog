import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readJson = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'))

describe('v2.0.0-alpha.1 release metadata', () => {
    it('keeps package, lockfile and both in-app changelogs aligned', () => {
        const pkg = readJson('package.json')
        const lock = readJson('package-lock.json')
        const en = readJson('src/locales/en/changelog.json')
        const zh = readJson('src/locales/zh-TW/changelog.json')
        const api = readJson('../server/package.json')
        const apiLock = readJson('../server/package-lock.json')
        expect(pkg.version).toBe('2.0.0-alpha.1')
        expect(api.version).toBe(pkg.version)
        expect(apiLock.version).toBe(pkg.version)
        expect(apiLock.packages[''].version).toBe(pkg.version)
        expect(lock.version).toBe(pkg.version)
        expect(lock.packages[''].version).toBe(pkg.version)
        expect(en.entries[0]).toMatchObject({ version: pkg.version, date: '2026-10-04' })
        expect(zh.entries[0]).toMatchObject({ version: pkg.version, date: '2026-10-04' })
    })

    it('documents school fixes, alpha limitations, and migration prerequisites', () => {
        const root = readFileSync(resolve(process.cwd(), '../CHANGELOG.md'), 'utf8')
        const release = root.slice(root.indexOf('## [2.0.0-alpha.1]'), root.indexOf('## [1.8.1]'))
        expect(release).toContain('UNKNOWN_FIELD')
        expect(release).toContain('unspecified PATCH dates remain unchanged')
        expect(release).toContain('1000115_report_occurrence_authoritative_roster.sql')
        expect(release).toContain('No production deployment')
    })
})
