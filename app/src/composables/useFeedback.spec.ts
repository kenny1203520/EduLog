import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { ApiV1Error } from '@/services/api/ApiV1Client'

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('vue-toastification', () => ({ useToast: () => toast }))
vi.mock('vue-i18n', () => ({
    useI18n: () => ({
        t: (key: string) => `t:${key}`,
        te: (key: string) => key === 'errors.hints.permission_denied' || key === 'errors.hints.network',
    }),
}))

import { useFeedback } from './useFeedback'

beforeEach(() => vi.clearAllMocks())

describe('useFeedback', () => {
    it('uses per-type durations', () => {
        const feedback = useFeedback()
        feedback.success('common.saved')
        feedback.info('common.info')
        feedback.warning('common.warn')
        expect(toast.success).toHaveBeenCalledWith('t:common.saved', { timeout: 3000 })
        expect(toast.info).toHaveBeenCalledWith('t:common.info', { timeout: 4000 })
        expect(toast.warning).toHaveBeenCalledWith('t:common.warn', { timeout: 6000 })
    })

    it('shows what failed, why, what to do next and a support code', () => {
        useFeedback().reportError(new ApiV1Error(403, { error: { code: 'PERMISSION_DENIED', message: 'English', request_id: 'req-9', trace_id: 't' } }), 'student.errors.add_contact_failed')
        const [content, options] = toast.error.mock.calls[0]!
        expect(content.props).toMatchObject({
            title: 't:student.errors.add_contact_failed',
            message: 't:errors.permission_denied',
            hint: 't:errors.hints.permission_denied',
            code: 'PERMISSION_DENIED · req-9',
        })
        expect(JSON.stringify(content.props)).not.toContain('English')
        // A missing permission needs the user to act, so it stays.
        expect(options).toMatchObject({ timeout: false, closeOnClick: false })
    })

    it('lets ordinary errors close after 8 seconds', () => {
        useFeedback().errorKey('student.errors.email_invalid')
        const [content, options] = toast.error.mock.calls[0]!
        expect(content.props).toMatchObject({ title: null, message: 't:student.errors.email_invalid', hint: null, code: null })
        expect(options).toMatchObject({ timeout: 8000 })
    })

    it('can keep any error until it is closed', () => {
        useFeedback().errorKey('common.save_error', undefined, { persistent: true })
        expect(toast.error.mock.calls[0]![1]).toMatchObject({ timeout: false })
    })
})

describe('error toast entry point', () => {
    function sourceFiles(dir: string): string[] {
        return readdirSync(dir).flatMap(name => {
            const path = join(dir, name)
            if (statSync(path).isDirectory()) return sourceFiles(path)
            return /\.(vue|ts)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : []
        })
    }

    it('keeps error toasts behind useFeedback', () => {
        const root = resolve(process.cwd(), 'src')
        const allowed = new Set(['composables/useFeedback.ts', 'main.ts'])
        const offenders = sourceFiles(root)
            .map(path => [relative(root, path).replace(/\\/g, '/'), readFileSync(path, 'utf8')] as const)
            .filter(([path, source]) => !allowed.has(path) && /\btoast\.error\(/.test(source))
            .map(([path]) => path)
        expect(offenders).toEqual([])
    })
})
