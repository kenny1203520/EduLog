import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readJson = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'))

describe('v1.7.0 release metadata', () => {
    it('keeps package, lockfile and both in-app changelogs aligned', () => {
        const pkg = readJson('package.json')
        const lock = readJson('package-lock.json')
        const en = readJson('src/locales/en/changelog.json')
        const zh = readJson('src/locales/zh-TW/changelog.json')
        expect(pkg.version).toBe('1.7.0')
        expect(lock.version).toBe(pkg.version)
        expect(lock.packages[''].version).toBe(pkg.version)
        expect(en.entries[0]).toMatchObject({ version: pkg.version, date: '2026-07-30' })
        expect(zh.entries[0]).toMatchObject({ version: pkg.version, date: '2026-07-30' })
    })

    it('documents both RBAC migrations and aggregate function deployment', () => {
        const root = readFileSync(resolve(process.cwd(), '../CHANGELOG.md'), 'utf8')
        expect(root).toContain('1000026_teacher_roles_and_incomplete_report_notifications.sql')
        expect(root).toContain('1000027_rbac_foundation_and_scoped_permissions.sql')
        expect(root).toContain('aggregate-incomplete-reports')
    })
})
