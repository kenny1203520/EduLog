import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function loadLocale(locale: 'en' | 'zh-TW') {
    return JSON.parse(readFileSync(resolve(process.cwd(), `src/locales/${locale}/rbac.json`), 'utf8')) as Record<string, Record<string, unknown>>
}

describe('RBAC locale contract', () => {
    const english = loadLocale('en')
    const traditionalChinese = loadLocale('zh-TW')

    it('keeps built-in role, resource and action keys in parity', () => {
        expect(Object.keys(traditionalChinese.roles).sort()).toEqual(Object.keys(english.roles).sort())
        expect(Object.keys(traditionalChinese.resources).sort()).toEqual(Object.keys(english.resources).sort())
        expect(Object.keys(traditionalChinese.actions).sort()).toEqual(Object.keys(english.actions).sort())
    })

    it('provides localized names and descriptions for every RBAC label', () => {
        for (const section of ['roles', 'resources', 'actions'] as const) {
            for (const value of Object.values(english[section])) {
                expect(value).toMatchObject({ name: expect.any(String), description: expect.any(String) })
            }
            for (const value of Object.values(traditionalChinese[section])) {
                expect(value).toMatchObject({ name: expect.any(String), description: expect.any(String) })
            }
        }
    })
})
