import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readJson = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'))

describe('v1.7.1 release metadata', () => {
    it('keeps package, lockfile and both in-app changelogs aligned', () => {
        const pkg = readJson('package.json')
        const lock = readJson('package-lock.json')
        const en = readJson('src/locales/en/changelog.json')
        const zh = readJson('src/locales/zh-TW/changelog.json')
        expect(pkg.version).toBe('1.7.1')
        expect(lock.version).toBe(pkg.version)
        expect(lock.packages[''].version).toBe(pkg.version)
        expect(en.entries[0]).toMatchObject({ version: pkg.version, date: '2026-08-01' })
        expect(zh.entries[0]).toMatchObject({ version: pkg.version, date: '2026-08-01' })
    })

    it('documents the aggregate function deployment and v1.7.1 migration', () => {
        const root = readFileSync(resolve(process.cwd(), '../CHANGELOG.md'), 'utf8')
        const release = root.slice(root.indexOf('## [1.7.1]'), root.indexOf('## [1.7.0]'))
        expect(release).toContain('1000028_rbac_security_performance_and_enrollment_completion.sql')
        expect(release).toContain('1000029_strict_incomplete_report_notification_eligibility.sql')
        expect(release).toContain('aggregate-incomplete-reports')
        expect(release).toContain('private, no-store')
    })
})
