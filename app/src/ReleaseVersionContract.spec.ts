import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readJson = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'))

describe('v1.7.4 release metadata', () => {
    it('keeps package, lockfile and both in-app changelogs aligned', () => {
        const pkg = readJson('package.json')
        const lock = readJson('package-lock.json')
        const en = readJson('src/locales/en/changelog.json')
        const zh = readJson('src/locales/zh-TW/changelog.json')
        expect(pkg.version).toBe('1.7.4')
        expect(lock.version).toBe(pkg.version)
        expect(lock.packages[''].version).toBe(pkg.version)
        expect(en.entries[0]).toMatchObject({ version: pkg.version, date: '2026-08-08' })
        expect(zh.entries[0]).toMatchObject({ version: pkg.version, date: '2026-08-08' })
    })

    it('documents the Docker runtime hotfix and deployment', () => {
        const root = readFileSync(resolve(process.cwd(), '../CHANGELOG.md'), 'utf8')
        const release = root.slice(root.indexOf('## [1.7.4]'), root.indexOf('## [1.7.3]'))
        expect(release).toContain('single-lesson transfer')
        expect(release).toContain('missing reports')
        expect(release).toContain('1000034_repair_effective_single_lesson_transfer_reports.sql')
    })
})
