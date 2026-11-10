import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PolicyScope } from '@/models/Rbac'
import { DOMAIN_ERROR_CODES } from '@/services/errors/mapDomainError'
import { RBAC_BUILT_IN_ROLE_CODES } from '@/utils/roleDisplay'
import en from './en'
import zhTW from './zh-TW'

const LOCALES = { en, 'zh-TW': zhTW } as Record<string, Record<string, unknown>>

function message(messages: Record<string, unknown>, key: string): unknown {
    return key.split('.').reduce<unknown>((node, part) => (
        node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    ), messages)
}

function sourceFiles(directory: string, extensions: string[]): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path, extensions)
        if (/\.(spec|test)\.ts$/.test(entry.name)) return []
        return extensions.some(extension => entry.name.endsWith(extension)) ? [path] : []
    })
}

/** Keys missing as a string in either locale, as `locale: key`. */
function missing(keys: Iterable<string>): string[] {
    const out: string[] = []
    for (const key of keys) {
        for (const [locale, messages] of Object.entries(LOCALES)) {
            if (typeof message(messages, key) !== 'string') out.push(`${locale}: ${key}`)
        }
    }
    return out.sort()
}

/** For each value, the first candidate key that exists in every locale; values with none are returned. */
function unlabelled(values: Iterable<string>, candidates: (value: string) => string[]): string[] {
    return [...values].filter(value => !candidates(value).some(key => missing([key]).length === 0)).sort()
}

describe('i18n usage contract', () => {
    it('defines every translation key the app asks for by name', () => {
        // t('a.b') and $t('a.b') with a literal key; keys built at run time are covered below.
        const call = /(?<![\w.$])\$?t\(\s*(['"])([\w-]+(?:\.[\w-]+)+)\1\s*[,)]/g
        const used = new Set<string>()
        for (const file of sourceFiles(resolve(process.cwd(), 'src'), ['.vue', '.ts'])) {
            for (const match of readFileSync(file, 'utf8').matchAll(call)) used.add(match[2]!)
        }
        expect(used.size).toBeGreaterThan(500)
        expect(missing(used)).toEqual([])
    })

    it('names and describes every built-in role', () => {
        const keys = [...RBAC_BUILT_IN_ROLE_CODES].flatMap(code => [`rbac.roles.${code}.name`, `rbac.roles.${code}.description`])
        expect(missing(keys)).toEqual([])
    })

    it('names every policy scope a permission can be inherited from', () => {
        const scopes = ['system', 'classroom', 'class_session'] satisfies PolicyScope[]
        expect(missing(scopes.map(scope => `rbac.scope.${scope}`))).toEqual([])
    })

    it('translates every domain error code', () => {
        expect(missing(DOMAIN_ERROR_CODES.map(code => `errors.domain.${code}`))).toEqual([])
    })

    it('labels every action and resource the API writes to the audit log', () => {
        const actions = new Set<string>()
        const resources = new Set<string>()
        for (const file of sourceFiles(resolve(process.cwd(), '../server/src'), ['.ts'])) {
            for (const context of readFileSync(file, 'utf8').matchAll(/setAuditContext\(req, \{[^}]*\}/g)) {
                const action = context[0].match(/\baction: '([\w-]+)'/)?.[1]
                const resource = context[0].match(/\bresource: '([\w-]+)'/)?.[1]
                if (action) actions.add(action)
                if (resource) resources.add(resource)
            }
        }
        expect(actions.size).toBeGreaterThan(10)
        expect(resources.size).toBeGreaterThan(10)
        expect(unlabelled(actions, action => [`rbac.audit_actions.${action}`, `rbac.actions.${action}.name`])).toEqual([])
        expect(unlabelled(resources, resource => [`rbac.resources.${resource}.name`, `rbac.audit_resources.${resource}`])).toEqual([])
    })
})
