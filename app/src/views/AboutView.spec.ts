import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AboutView Docker image link', () => {
    it('links to EduLog releases for the verified GHCR pull instructions', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/views/AboutView.vue'), 'utf8')

        expect(source).toContain('https://github.com/kenny1203520/EduLog/releases')
        expect(source).not.toContain('hub.docker.com')
    })
})
