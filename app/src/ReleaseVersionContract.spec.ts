import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readJson = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'))

describe('v1.8.0 release metadata', () => {
    it('keeps package, lockfile and both in-app changelogs aligned', () => {
        const pkg = readJson('package.json')
        const lock = readJson('package-lock.json')
        const en = readJson('src/locales/en/changelog.json')
        const zh = readJson('src/locales/zh-TW/changelog.json')
        expect(pkg.version).toBe('1.8.0')
        expect(lock.version).toBe(pkg.version)
        expect(lock.packages[''].version).toBe(pkg.version)
        expect(en.entries[0]).toMatchObject({ version: pkg.version, date: '2026-08-16' })
        expect(zh.entries[0]).toMatchObject({ version: pkg.version, date: '2026-08-16' })
    })

    it('documents the feedback, i18n, and payload-reduction release and deployment', () => {
        const root = readFileSync(resolve(process.cwd(), '../CHANGELOG.md'), 'utf8')
        const release = root.slice(root.indexOf('## [1.8.0]'), root.indexOf('## [1.7.5]'))
        expect(release).toContain('useFeedback')
        expect(release).toContain('datetimeFormats')
        expect(release).toContain('1000037_editor_security_hardening.sql')
        expect(release).toContain('1000038_editor_rbac_boundary_hardening.sql')
    })
})
