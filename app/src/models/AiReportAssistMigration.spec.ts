import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_PERMISSIONS } from './Rbac'

const migration = readFileSync(resolve(process.cwd(), '../supabase/migrations/1000149_ai_report_assist.sql'), 'utf8')
const locale = (name: 'en' | 'zh-TW') => JSON.parse(readFileSync(resolve(process.cwd(), `src/locales/${name}/rbac.json`), 'utf8')) as {
    resources: Record<string, unknown>
    actions: Record<string, unknown>
}

describe('AI report assistant migration contract', () => {
    it('seeds every AI permission the app refers to', () => {
        for (const key of Object.values(AI_PERMISSIONS)) expect(migration).toContain(`('${key}',`)
    })

    it('allows teachers to generate by default', () => {
        expect(migration).toContain("permission.key = 'teaching.ai.generate'")
        expect(migration).toMatch(/role\.code IN \('teaching_owner', 'teaching_manager', 'teacher'\)/)
    })

    it('never grants the credential ciphertext to authenticated users', () => {
        const grant = migration.match(/GRANT SELECT \(([^)]*)\)\s+ON public\.ai_credentials TO authenticated/)
        expect(grant).not.toBeNull()
        expect(grant![1]).not.toContain('secret_ciphertext')
        expect(grant![1]).toContain('secret_hint')
    })

    it('limits generation reads to the owner or system.ai.logs.view_all', () => {
        expect(migration).toMatch(/CREATE POLICY ai_generations_read[\s\S]*user_id = \(select auth\.uid\(\)\)[\s\S]*'system\.ai\.logs\.view_all'/)
    })

    it('labels the AI resource and actions in the permission editor', () => {
        for (const name of ['en', 'zh-TW'] as const) {
            const messages = locale(name)
            expect(messages.resources.ai).toMatchObject({ name: expect.any(String), description: expect.any(String) })
            for (const action of ['generate', 'manage', 'logs_view_all']) {
                expect(messages.actions[action]).toMatchObject({ name: expect.any(String), description: expect.any(String) })
            }
        }
    })
})
