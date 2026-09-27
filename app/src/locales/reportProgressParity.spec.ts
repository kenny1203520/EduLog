import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('report progress-check translations', () => {
    it('has matching English and Traditional Chinese keys', () => {
        const english = JSON.parse(readFileSync(resolve(process.cwd(), 'src/locales/en/report.json'), 'utf8'))
        const chinese = JSON.parse(readFileSync(resolve(process.cwd(), 'src/locales/zh-TW/report.json'), 'utf8'))
        expect(Object.keys(chinese.editor.progress_check).sort()).toEqual(Object.keys(english.editor.progress_check).sort())
    })
})
