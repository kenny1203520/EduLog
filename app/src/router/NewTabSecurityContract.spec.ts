import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function vueFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        if (/_Conflict\./i.test(entry.name)) return []
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return vueFiles(path)
        return extname(path) === '.vue' ? [path] : []
    })
}

describe('external new-tab and internal navigation security contract', () => {
    it('protects every external target blank link from opener access', () => {
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

        expect(newTabLinkCount).toBeGreaterThan(5)
        expect(unsafe).toEqual([])
    })

    it('never forces an internal RouterLink into a new tab', () => {
        const root = resolve(process.cwd(), 'src')
        const forcedInternalLinks: string[] = []

        for (const file of vueFiles(root)) {
            const code = readFileSync(file, 'utf8')
            const tags = [...code.matchAll(/<router-link\b[\s\S]*?>/gi)].map(match => match[0])
            for (const tag of tags.filter(candidate => candidate.includes('target="_blank"'))) {
                forcedInternalLinks.push(`${relative(root, file)}: ${tag.replace(/\s+/g, ' ')}`)
            }
        }

        expect(forcedInternalLinks).toEqual([])
    })
})
