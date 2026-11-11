import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AboutView Docker image link', () => {
    it('links to the EduLog package in GitHub Container Registry', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/views/AboutView.vue'), 'utf8')

        expect(source).toContain('https://github.com/users/kenny1203520/packages/container/package/edulog')
        expect(source).not.toContain('hub.docker.com')
    })
})
