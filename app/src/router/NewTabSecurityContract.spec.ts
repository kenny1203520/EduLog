import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function vueFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return vueFiles(path)
        return extname(path) === '.vue' ? [path] : []
    })
}

describe('new-tab link security contract', () => {
    it('protects every target blank anchor and router link from opener access', () => {
        const root = resolve(process.cwd(), 'src')
        const unsafe: string[] = []
        let newTabLinkCount = 0

        for (const file of vueFiles(root)) {
            const code = readFileSync(file, 'utf8')
            const tags = [...code.matchAll(/<(?:a|router-link)\b[\s\S]*?>/gi)].map(match => match[0])
            for (const tag of tags.filter(candidate => candidate.includes('target="_blank"'))) {
                newTabLinkCount += 1
                if (!/rel="[^"]*\bnoopener\b[^"]*\bnoreferrer\b[^"]*"/.test(tag)) {
                    unsafe.push(`${relative(root, file)}: ${tag.replace(/\s+/g, ' ')}`)
                }
            }
        }

        expect(newTabLinkCount).toBeGreaterThan(10)
        expect(unsafe).toEqual([])
    })
})
